import * as THREE from 'three/webgpu';
import { MapControls } from 'three/addons/controls/MapControls.js';
import {
  BUILDING_DEFS,
  GRID_SIZE,
  RESOURCES,
  TICK_RATE,
  getBuildingProduction,
  getTrainees,
  getWorkers,
  isAreaFree,
  isOperational,
  type Building,
  type BuildingType,
} from '@cow/shared';
import type { GameController } from '../game/GameController';
import type { UiStore } from '../ui/UiStore';
import { ERROR_MESSAGES, RESOURCE_ICONS, fmtNum } from '../ui/format';
import type { Assets } from './assets';
import {
  createBuildingVisual,
  createGhost,
  createRangeRing,
  createSelectionFrame,
  disposeVisual,
  setGhostValid,
  type BuildingVisual,
} from './buildings';
import { cellToWorld, worldToCell } from './coords';
import { Environment } from './environment';
import { clamp01, ease, hopScale, popScale } from './fx';
import { Overlays, type OverlayItem } from './overlays';
import { Particles } from './particles';
import { PostFX, type Quality } from './postfx';
import { VillagerAgents } from './villagers';

interface BuildingView {
  key: string;
  visual: BuildingVisual;
  anim: { kind: 'pop' | 'hop'; t: number; duration: number } | null;
  smokeClock: number;
  produced: Record<string, number>;
  popupClock: number;
}

interface Snapshot {
  level: number;
  building: boolean;
  x: number;
  y: number;
  stage: number;
}

const CLICK_TOLERANCE_PX = 6;
const HOME_CAMERA = new THREE.Vector3(0, 15.5, 14.5);
const POPUP_EVERY = 6;

export class World {
  renderer!: THREE.WebGPURenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 600);
  private controls!: MapControls;
  private post!: PostFX;
  private env: Environment;
  private particles = new Particles();
  private villagers: VillagerAgents;
  private buildingsRoot = new THREE.Group();
  private views = new Map<number, BuildingView>();
  private snapshots = new Map<number, Snapshot>();
  private overlays: Overlays;
  private ghost: { key: string; group: THREE.Group } | null = null;
  private selection: { id: number; frame: THREE.Group; ring: THREE.Mesh | null } | null = null;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerInside = false;
  private down: { x: number; y: number; button: number } | null = null;
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private lastTime = performance.now();
  private elapsed = 0;
  private intro = { t: 0, duration: 3.2, from: new THREE.Vector3(-38, 58, 70) };
  private firstSync = true;
  private perf = { time: 0, frames: 0 };

  constructor(
    private container: HTMLElement,
    overlayRoot: HTMLElement,
    private game: GameController,
    private ui: UiStore,
    private assets: Assets,
  ) {
    this.camera.position.copy(this.intro.from);
    this.camera.lookAt(0, 0, 0);
    this.env = new Environment(this.scene, assets);
    this.villagers = new VillagerAgents(assets, this.particles);
    this.scene.add(this.buildingsRoot, this.villagers.group, this.particles.group);
    this.overlays = new Overlays(overlayRoot, this.camera, container);
  }

  async init(quality: Quality): Promise<void> {
    const forceWebGL = new URLSearchParams(location.search).get('renderer') === 'webgl' || sessionStorage.getItem('cow:webgl') === '1';
    let renderer = await createRenderer(forceWebGL);
    this.syncBuildings();
    if (isWebGPU(renderer) && !(await probe(renderer, this.scene, this.camera))) {
      // Algunos navegadores exponen WebGPU con una implementación incompatible.
      console.warn('WebGPU falló en el frame de prueba; usando WebGL 2.');
      renderer.dispose();
      renderer = await createRenderer(true);
    }
    if (isWebGPU(renderer)) {
      // Si la GPU se reinicia a mitad de partida, recargamos con WebGL 2 en vez de quedarnos en negro.
      renderer.onDeviceLost = (info: unknown) => {
        console.error('Dispositivo WebGPU perdido', info);
        sessionStorage.setItem('cow:webgl', '1');
        location.reload();
      };
    }
    this.renderer = renderer;
    this.container.appendChild(renderer.domElement);
    this.ui.backend = isWebGPU(renderer) ? 'WebGPU' : 'WebGL 2';
    this.ui.notify();

    this.post = new PostFX(renderer, this.scene, this.camera);
    this.post.setQuality(quality);

    this.controls = new MapControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 60;
    this.controls.maxPolarAngle = 1.18;
    this.controls.minPolarAngle = 0.3;
    this.controls.zoomToCursor = true;
    this.controls.keys = { LEFT: 'KeyA', UP: 'KeyW', RIGHT: 'KeyD', BOTTOM: 'KeyS' };
    this.controls.keyPanSpeed = 25;
    this.controls.listenToKeyEvents(window);
    this.controls.enabled = false;

    this.bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.lastTime = performance.now();
    renderer.setAnimationLoop(() => this.frame());
  }

  setQuality(q: Quality): void {
    this.post?.setQuality(q);
  }

  // ---------------------------------------------------------------------------
  // Bucle
  // ---------------------------------------------------------------------------

  private frame(): void {
    const now = performance.now();
    const dtMs = now - this.lastTime;
    this.lastTime = now;
    const dt = Math.min(dtMs, 100) / 1000;
    this.elapsed += dt;

    this.game.update(dtMs);
    this.syncBuildings();
    this.animateBuildings(dt);
    this.syncSelection(dt);
    this.syncGhost();
    this.villagers.update(this.game.state, dt * this.game.speed ** 0.5);
    this.particles.update(dt);
    this.updateCamera(dt);
    this.env.update(dt, this.controls.target);
    this.post.render();
    this.updateOverlays(dt);
    this.autoQuality(dtMs);
  }

  /** En modo automático, baja la calidad si la media de FPS es baja. */
  private autoQuality(dtMs: number): void {
    if (!this.ui.qualityAuto || this.intro.t < this.intro.duration) return;
    this.perf.time += dtMs;
    this.perf.frames++;
    if (this.perf.time < 4000) return;
    const fps = (this.perf.frames * 1000) / this.perf.time;
    this.perf = { time: 0, frames: 0 };
    if (fps >= 25) return;
    const next = this.ui.quality === 'high' ? 'medium' : this.ui.quality === 'medium' ? 'low' : null;
    if (!next) return;
    this.ui.setQuality(next, true);
    this.ui.toast(`Calidad ajustada a ${next === 'medium' ? 'Media' : 'Baja'} para mantener la fluidez.`);
  }

  private updateCamera(dt: number): void {
    if (this.intro.t < this.intro.duration) {
      this.intro.t += dt;
      const k = ease.inOutCubic(clamp01(this.intro.t / this.intro.duration));
      this.camera.position.lerpVectors(this.intro.from, HOME_CAMERA, k);
      this.camera.lookAt(0, 0, 0);
      if (this.intro.t >= this.intro.duration) this.controls.enabled = true;
      return;
    }
    this.controls.update();
    this.clampCamera();
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private clampCamera(): void {
    const t = this.controls.target;
    const lim = GRID_SIZE / 2 + 6;
    const cx = THREE.MathUtils.clamp(t.x, -lim, lim);
    const cz = THREE.MathUtils.clamp(t.z, -lim, lim);
    if (cx !== t.x || cz !== t.z) {
      this.camera.position.x += cx - t.x;
      this.camera.position.z += cz - t.z;
      t.set(cx, 0, cz);
    }
  }

  // ---------------------------------------------------------------------------
  // Sincronización estado → escena
  // ---------------------------------------------------------------------------

  private stageOf(b: Building): number {
    if (b.level !== 0 || !b.construction) return 0;
    const p = 1 - b.construction.remainingTicks / b.construction.totalTicks;
    return Math.min(2, Math.floor(p * 3));
  }

  private syncBuildings(): void {
    const state = this.game.state;
    const walls = new Set(state.buildings.filter((b) => b.type === 'wall').map((b) => `${b.x},${b.y}`));
    const seen = new Set<number>();
    for (const b of state.buildings) {
      seen.add(b.id);
      const size = BUILDING_DEFS[b.type].size;
      const stage = this.stageOf(b);
      let mask = 0;
      if (b.type === 'wall') {
        if (walls.has(`${b.x + 1},${b.y}`)) mask |= 1;
        if (walls.has(`${b.x - 1},${b.y}`)) mask |= 2;
        if (walls.has(`${b.x},${b.y + 1}`)) mask |= 4;
        if (walls.has(`${b.x},${b.y - 1}`)) mask |= 8;
      }
      const key = `${b.type}:${b.level}:${b.construction ? 'c' : ''}:${stage}:${mask}`;
      let view = this.views.get(b.id);
      if (!view || view.key !== key) {
        if (view) {
          this.buildingsRoot.remove(view.visual.root);
          disposeVisual(view.visual);
        }
        const visual = createBuildingVisual(this.assets, b, mask, stage);
        const fresh: BuildingView = {
          key,
          visual,
          anim: view ? view.anim : null,
          smokeClock: Math.random(),
          produced: view?.produced ?? {},
          popupClock: view?.popupClock ?? Math.random() * POPUP_EVERY,
        };
        this.views.set(b.id, fresh);
        this.buildingsRoot.add(visual.root);
        view = fresh;
      }
      const p = cellToWorld(b.x, b.y, size);
      view.visual.root.position.set(p.x, 0, p.z);
      this.detectEvents(b, view, stage);
    }
    for (const [id, view] of this.views) {
      if (!seen.has(id)) {
        this.buildingsRoot.remove(view.visual.root);
        disposeVisual(view.visual);
        this.views.delete(id);
        this.snapshots.delete(id);
      }
    }
    this.firstSync = false;
  }

  /** Compara con el frame anterior para disparar animaciones y efectos. */
  private detectEvents(b: Building, view: BuildingView, stage: number): void {
    const prev = this.snapshots.get(b.id);
    const snap: Snapshot = { level: b.level, building: b.construction !== null, x: b.x, y: b.y, stage };
    this.snapshots.set(b.id, snap);
    if (this.firstSync) return;
    const size = BUILDING_DEFS[b.type].size;
    const center = view.visual.root.position.clone();
    const pop = (duration = 0.9) => (view.anim = { kind: 'pop', t: 0, duration });
    if (!prev) {
      pop();
      this.particles.dust(center.clone().setY(0.1), size * 0.5, 10 + size * 8);
      return;
    }
    if (prev.x !== snap.x || prev.y !== snap.y) {
      pop(0.6);
      this.particles.dust(center.clone().setY(0.1), size * 0.5, 8 + size * 5);
    }
    if (prev.stage !== snap.stage) {
      pop(0.5);
      this.particles.dust(center.clone().setY(0.2), size * 0.4, 12);
    }
    if (prev.building && !snap.building) {
      // ¡Obra terminada!
      pop(1.1);
      this.particles.celebrate(center.clone().setY(view.visual.height * 0.5), size * 0.6);
      const name = BUILDING_DEFS[b.type].name;
      this.overlays.floatText(
        center.clone().setY(view.visual.height + 0.5),
        b.level === 1 ? `¡${name} construido!` : `¡${name} nivel ${b.level}!`,
        'big',
      );
    } else if (!prev.building && snap.building) {
      view.anim = { kind: 'hop', t: 0, duration: 0.5 };
      this.particles.dust(center.clone().setY(0.1), size * 0.5, 16);
    }
  }

  private animateBuildings(dt: number): void {
    const state = this.game.state;
    const simDt = dt * this.game.speed;
    for (const b of state.buildings) {
      const view = this.views.get(b.id);
      if (!view) continue;
      const v = view.visual;
      const working = isOperational(b) && (getWorkers(state, b.id).length > 0 || getTrainees(state, b.id).length > 0);
      v.update(dt, working);

      if (view.anim) {
        view.anim.t += dt / view.anim.duration;
        const [sxz, sy] = view.anim.kind === 'pop' ? popScale(view.anim.t) : hopScale(view.anim.t);
        v.body.scale.set(sxz, sy, sxz);
        if (view.anim.t >= 1) {
          view.anim = null;
          v.body.scale.set(1, 1, 1);
        }
      }

      // Humo de chimeneas: siempre en casas, en el resto solo si trabajan.
      if (v.smoke.length && isOperational(b) && (b.type === 'house' || working)) {
        view.smokeClock -= dt;
        if (view.smokeClock <= 0) {
          view.smokeClock = 0.28 + Math.random() * 0.2;
          for (const s of v.smoke) this.particles.smoke(v.root.localToWorld(s.clone()), 0.8 + BUILDING_DEFS[b.type].size * 0.12);
        }
      }
      if (b.type === 'goldMine' && working && Math.random() < dt * 3) {
        this.particles.glint(v.root.position.clone().setY(0.8), 1.1);
      }

      // Popups de producción: "+12 🌾" cada pocos segundos.
      const prod = getBuildingProduction(state, b);
      for (const r of RESOURCES) if (prod[r]) view.produced[r] = (view.produced[r] ?? 0) + prod[r]! * simDt;
      view.popupClock -= dt;
      if (view.popupClock <= 0) {
        view.popupClock = POPUP_EVERY;
        for (const r of RESOURCES) {
          const amount = Math.floor(view.produced[r] ?? 0);
          if (amount >= 1) {
            view.produced[r]! -= amount;
            this.overlays.floatText(v.root.position.clone().setY(v.height + 0.3), `+${fmtNum(amount)} ${RESOURCE_ICONS[r]}`, r);
          }
        }
      }
    }
  }

  private syncSelection(dt: number): void {
    const id = this.ui.selectedId;
    const b = id !== null ? this.game.state.buildings.find((x) => x.id === id) : undefined;
    if (!b || this.ui.mode.kind !== 'idle') {
      if (this.selection) {
        this.scene.remove(this.selection.frame);
        if (this.selection.ring) this.scene.remove(this.selection.ring);
        this.selection = null;
      }
      return;
    }
    const size = BUILDING_DEFS[b.type].size;
    if (!this.selection || this.selection.id !== b.id) {
      if (this.selection) {
        this.scene.remove(this.selection.frame);
        if (this.selection.ring) this.scene.remove(this.selection.ring);
      }
      const range = BUILDING_DEFS[b.type].levels[Math.max(0, b.level - 1)]?.range;
      const ring = range ? createRangeRing(range) : null;
      this.selection = { id: b.id, frame: createSelectionFrame(size), ring };
      this.scene.add(this.selection.frame);
      if (ring) this.scene.add(ring);
      const view = this.views.get(b.id);
      if (view && !view.anim) view.anim = { kind: 'hop', t: 0, duration: 0.45 };
    }
    const p = cellToWorld(b.x, b.y, size);
    this.selection.frame.position.set(p.x, 0, p.z);
    const pulse = 1 + Math.sin(this.elapsed * 5) * 0.015;
    this.selection.frame.scale.set(pulse, 1, pulse);
    if (this.selection.ring) {
      this.selection.ring.position.set(p.x, 0.06, p.z);
      this.selection.ring.rotation.z += dt * 0.2;
    }
  }

  private ghostTarget(): { type: BuildingType; ignoreId?: number } | null {
    const mode = this.ui.mode;
    if (mode.kind === 'place') return { type: mode.building };
    if (mode.kind === 'move') {
      const b = this.game.state.buildings.find((x) => x.id === mode.buildingId);
      return b ? { type: b.type, ignoreId: b.id } : null;
    }
    return null;
  }

  private syncGhost(): void {
    const target = this.ghostTarget();
    this.env.setGridVisible(target !== null);
    const key = target ? target.type : '';
    if (this.ghost && this.ghost.key !== key) {
      this.scene.remove(this.ghost.group);
      this.ghost = null;
    }
    if (!target) return;
    if (!this.ghost) {
      this.ghost = { key, group: createGhost(this.assets, target.type) };
      this.scene.add(this.ghost.group);
    }
    const cell = this.hoverCell(target.type);
    this.ghost.group.visible = cell !== null;
    if (!cell) return;
    const size = BUILDING_DEFS[target.type].size;
    const p = cellToWorld(cell.x, cell.y, size);
    // Movimiento suave del fantasma hacia la celda.
    const g = this.ghost.group.position;
    if (g.lengthSq() === 0) g.set(p.x, 0, p.z);
    g.lerp(new THREE.Vector3(p.x, Math.abs(Math.sin(this.elapsed * 4)) * 0.08, p.z), 0.35);
    setGhostValid(this.ghost.group, isAreaFree(this.game.state, cell.x, cell.y, size, target.ignoreId));
  }

  private updateOverlays(dt: number): void {
    const items: OverlayItem[] = [];
    const state = this.game.state;
    for (const b of state.buildings) {
      const view = this.views.get(b.id);
      if (!view) continue;
      const top = view.visual.root.position.clone().setY(view.visual.height + 0.6);
      if (b.construction) {
        const c = b.construction;
        items.push({
          key: `c${b.id}`,
          pos: top,
          label: b.level === 0 ? 'Construyendo' : `Nivel ${c.targetLevel}`,
          seconds: c.remainingTicks / TICK_RATE,
          progress: 1 - c.remainingTicks / c.totalTicks,
          kind: 'build',
        });
      }
      getTrainees(state, b.id).forEach((v, i) => {
        if (v.task.kind !== 'train') return;
        items.push({
          key: `t${v.id}`,
          pos: top.clone().setY(top.y + 0.7 * (i + (b.construction ? 1 : 0))),
          label: v.name,
          seconds: v.task.remainingTicks / TICK_RATE,
          progress: 1 - v.task.remainingTicks / v.task.totalTicks,
          kind: 'train',
        });
      });
    }
    this.overlays.update(items, dt);
  }

  // ---------------------------------------------------------------------------
  // Entrada
  // ---------------------------------------------------------------------------

  private bindInput(): void {
    const el = this.renderer.domElement;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointermove', (e) => this.setPointer(e));
    el.addEventListener('pointerleave', () => (this.pointerInside = false));
    el.addEventListener('pointerdown', (e) => {
      this.setPointer(e);
      this.down = { x: e.clientX, y: e.clientY, button: e.button };
    });
    el.addEventListener('pointerup', (e) => {
      const d = this.down;
      this.down = null;
      if (!d || d.button !== e.button) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_TOLERANCE_PX) return;
      this.setPointer(e);
      if (e.button === 0) this.onClick(e.shiftKey);
      else if (e.button === 2) this.cancel();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.cancel();
    });
  }

  private cancel(): void {
    if (this.ui.mode.kind !== 'idle') this.ui.setMode({ kind: 'idle' });
    else this.ui.select(null);
  }

  private setPointer(e: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.pointerInside = true;
  }

  private hoverCell(type: BuildingType): { x: number; y: number } | null {
    if (!this.pointerInside) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null;
    return worldToCell(hit.x, hit.z, BUILDING_DEFS[type].size);
  }

  private pickBuilding(): number | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.buildingsRoot.children, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && o.userData.buildingId === undefined) o = o.parent;
      if (o) return o.userData.buildingId as number;
    }
    // Si no se tocó ningún modelo, se prueba con la huella en el suelo.
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null;
    const cx = hit.x + GRID_SIZE / 2;
    const cz = hit.z + GRID_SIZE / 2;
    const b = this.game.state.buildings.find((x) => {
      const s = BUILDING_DEFS[x.type].size;
      return cx >= x.x && cx < x.x + s && cz >= x.y && cz < x.y + s;
    });
    return b?.id ?? null;
  }

  private onClick(shift: boolean): void {
    const mode = this.ui.mode;
    if (mode.kind === 'place') {
      const cell = this.hoverCell(mode.building);
      if (!cell) return;
      const res = this.game.dispatch({ type: 'placeBuilding', building: mode.building, x: cell.x, y: cell.y });
      if (!res.ok) {
        this.ui.toast(ERROR_MESSAGES[res.error], 'error');
        return;
      }
      // Los muros (o con Mayús) se siguen colocando en cadena.
      if (mode.building !== 'wall' && !shift) {
        this.ui.setMode({ kind: 'idle' });
        this.ui.select(this.game.state.buildings.at(-1)?.id ?? null);
      }
      return;
    }
    if (mode.kind === 'move') {
      const b = this.game.state.buildings.find((x) => x.id === mode.buildingId);
      const cell = b && this.hoverCell(b.type);
      if (!b || !cell) return;
      const res = this.game.dispatch({ type: 'moveBuilding', buildingId: b.id, x: cell.x, y: cell.y });
      if (!res.ok) this.ui.toast(ERROR_MESSAGES[res.error], 'error');
      else this.ui.setMode({ kind: 'idle' });
      return;
    }
    this.ui.select(this.pickBuilding());
  }
}

async function createRenderer(forceWebGL: boolean): Promise<THREE.WebGPURenderer> {
  const renderer = new THREE.WebGPURenderer({ antialias: false, forceWebGL });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  await renderer.init();
  return renderer;
}

function isWebGPU(renderer: THREE.WebGPURenderer): boolean {
  return (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
}

/** Renderiza un par de frames fuera de pantalla y detecta errores del backend. */
async function probe(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera): Promise<boolean> {
  let failed = false;
  const onError = (e: Event) => {
    failed = true;
    e.preventDefault();
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onError);
  try {
    renderer.setSize(64, 64, false);
    for (let i = 0; i < 2 && !failed; i++) {
      renderer.render(scene, camera);
      await new Promise((r) => requestAnimationFrame(r));
    }
  } catch {
    failed = true;
  } finally {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onError);
  }
  return !failed;
}
