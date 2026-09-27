import * as THREE from 'three/webgpu';
import { MapControls } from 'three/addons/controls/MapControls.js';
import {
  BUILDING_DEFS,
  GRID_SIZE,
  TICK_RATE,
  getTrainees,
  isAreaFree,
  type Building,
  type BuildingType,
} from '@cow/shared';
import type { GameController } from '../game/GameController';
import type { UiStore } from '../ui/UiStore';
import { ERROR_MESSAGES } from '../ui/format';
import { cellToWorld, worldToCell } from './coords';
import {
  addScaffold,
  createBuildingModel,
  createConstructionSite,
  createGhost,
  createSelectionFrame,
  mat,
  setGhostValid,
} from './meshes';
import { Overlays } from './overlays';
import { VillagerAgents } from './villagers';

interface BuildingView {
  key: string;
  root: THREE.Group;
  progress: THREE.Mesh | null;
}

const CLICK_TOLERANCE_PX = 6;

export class World {
  renderer!: THREE.WebGPURenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
  private controls!: MapControls;
  private buildingsRoot = new THREE.Group();
  private views = new Map<number, BuildingView>();
  private villagers = new VillagerAgents();
  private overlays: Overlays;
  private grid: THREE.GridHelper;
  private ghost: { key: string; group: THREE.Group } | null = null;
  private selection: { id: number; size: number; frame: THREE.Group } | null = null;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerInside = false;
  private down: { x: number; y: number; button: number } | null = null;
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private lastTime = performance.now();

  constructor(
    private container: HTMLElement,
    overlayRoot: HTMLElement,
    private game: GameController,
    private ui: UiStore,
  ) {
    this.camera.position.set(0, 21, 19);
    this.grid = new THREE.GridHelper(GRID_SIZE, GRID_SIZE, '#ffffff', '#ffffff');
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.25;
    this.grid.position.y = 0.02;
    this.grid.visible = false;

    this.overlays = new Overlays(overlayRoot, this.camera, container);
    this.buildScene();
  }

  async init(): Promise<void> {
    const forceWebGL = new URLSearchParams(location.search).get('renderer') === 'webgl';
    let renderer = await createRenderer(forceWebGL);
    this.syncBuildings();
    if (isWebGPU(renderer) && !(await probe(renderer, this.scene, this.camera))) {
      // Algunos navegadores exponen WebGPU pero con una implementación
      // incompatible: en ese caso usamos el backend WebGL 2 de three.
      console.warn('WebGPU falló en el frame de prueba; usando WebGL 2.');
      renderer.dispose();
      renderer = await createRenderer(true);
    }
    this.renderer = renderer;
    this.container.appendChild(renderer.domElement);
    this.ui.backend = isWebGPU(renderer) ? 'WebGPU' : 'WebGL 2';
    this.ui.notify();

    this.controls = new MapControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 12;
    this.controls.maxDistance = 70;
    this.controls.maxPolarAngle = 1.2;
    this.controls.minPolarAngle = 0.35;
    this.controls.keys = { LEFT: 'KeyA', UP: 'KeyW', RIGHT: 'KeyD', BOTTOM: 'KeyS' };
    this.controls.keyPanSpeed = 25;
    this.controls.listenToKeyEvents(window);

    this.bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.lastTime = performance.now();
    renderer.setAnimationLoop(() => this.frame());
  }

  // -------------------------------------------------------------------------
  // Escena estática
  // -------------------------------------------------------------------------

  private buildScene(): void {
    this.scene.background = new THREE.Color('#a9d6f5');
    this.scene.fog = new THREE.Fog('#a9d6f5', 70, 160);

    this.scene.add(new THREE.HemisphereLight('#dff1ff', '#5a7a3a', 1.2));
    const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
    sun.position.set(-20, 35, 15);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -30;
    sc.right = sc.top = 30;
    sc.near = 1;
    sc.far = 100;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    const outer = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), mat('#5f8f3e'));
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.02;
    outer.receiveShadow = true;
    this.scene.add(outer);

    const field = new THREE.Mesh(new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE), mat('#7fb24c'));
    field.rotation.x = -Math.PI / 2;
    field.receiveShadow = true;
    this.scene.add(field);

    const border = new THREE.Mesh(new THREE.BoxGeometry(GRID_SIZE + 1, 0.1, GRID_SIZE + 1), mat('#8a7a5a'));
    border.position.y = -0.06;
    this.scene.add(border);

    this.scene.add(this.grid, this.buildingsRoot, this.villagers.group);
    this.addForest();
  }

  /** Bosque decorativo alrededor de la aldea (instanciado: una draw call por pieza). */
  private addForest(): void {
    const count = 420;
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.2, 0.8, 6), mat('#6b4a2b'), count);
    const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(0.9, 2.2, 7), mat('#3f7a35'), count);
    trunks.castShadow = crowns.castShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const r = GRID_SIZE / 2 + 3 + rand() * 45;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const k = 0.7 + rand() * 0.8;
      s.set(k, k, k);
      m.compose(new THREE.Vector3(x, 0.4 * k, z), q, s);
      trunks.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(x, (0.8 + 1.1) * k, z), q, s);
      crowns.setMatrixAt(i, m);
    }
    this.scene.add(trunks, crowns);
  }

  // -------------------------------------------------------------------------
  // Bucle
  // -------------------------------------------------------------------------

  private frame(): void {
    const now = performance.now();
    const dtMs = now - this.lastTime;
    this.lastTime = now;

    this.game.update(dtMs);
    this.syncBuildings();
    this.syncSelection();
    this.syncGhost();
    this.villagers.update(this.game.state, Math.min(dtMs, 100) / 1000);
    this.controls.update();
    this.clampCamera();
    this.renderer.render(this.scene, this.camera);
    this.updateOverlays();
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
    const lim = GRID_SIZE / 2 + 4;
    const cx = THREE.MathUtils.clamp(t.x, -lim, lim);
    const cz = THREE.MathUtils.clamp(t.z, -lim, lim);
    if (cx !== t.x || cz !== t.z) {
      this.camera.position.x += cx - t.x;
      this.camera.position.z += cz - t.z;
      t.set(cx, 0, cz);
    }
  }

  // -------------------------------------------------------------------------
  // Sincronización estado → escena
  // -------------------------------------------------------------------------

  private viewKey(b: Building): string {
    return `${b.type}:${b.level}:${b.construction ? 'c' : ''}`;
  }

  private syncBuildings(): void {
    const seen = new Set<number>();
    for (const b of this.game.state.buildings) {
      seen.add(b.id);
      const key = this.viewKey(b);
      let view = this.views.get(b.id);
      if (!view || view.key !== key) {
        if (view) this.buildingsRoot.remove(view.root);
        view = this.createView(b, key);
        this.views.set(b.id, view);
        this.buildingsRoot.add(view.root);
      }
      const size = BUILDING_DEFS[b.type].size;
      const p = cellToWorld(b.x, b.y, size);
      view.root.position.set(p.x, 0, p.z);
      if (view.progress && b.construction) {
        const c = b.construction;
        view.progress.scale.y = Math.max(0.01, 1.4 * (1 - c.remainingTicks / c.totalTicks));
      }
    }
    for (const [id, view] of this.views) {
      if (!seen.has(id)) {
        this.buildingsRoot.remove(view.root);
        this.views.delete(id);
      }
    }
  }

  private createView(b: Building, key: string): BuildingView {
    const root = new THREE.Group();
    root.userData.buildingId = b.id;
    let progress: THREE.Mesh | null = null;
    if (b.level === 0) {
      const site = createConstructionSite(b.type);
      root.add(site.group);
      progress = site.progress;
    } else {
      root.add(createBuildingModel(b.type, b.level));
      if (b.construction) addScaffold(root, BUILDING_DEFS[b.type].size, 2.2);
    }
    return { key, root, progress };
  }

  private syncSelection(): void {
    const id = this.ui.selectedId;
    const b = id !== null ? this.game.state.buildings.find((x) => x.id === id) : undefined;
    if (!b) {
      if (this.selection) {
        this.scene.remove(this.selection.frame);
        this.selection = null;
      }
      return;
    }
    const size = BUILDING_DEFS[b.type].size;
    if (!this.selection || this.selection.id !== b.id) {
      if (this.selection) this.scene.remove(this.selection.frame);
      this.selection = { id: b.id, size, frame: createSelectionFrame(size) };
      this.scene.add(this.selection.frame);
    }
    const p = cellToWorld(b.x, b.y, size);
    this.selection.frame.position.set(p.x, 0, p.z);
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
    this.grid.visible = target !== null;
    const key = target ? target.type : '';
    if (this.ghost && this.ghost.key !== key) {
      this.scene.remove(this.ghost.group);
      this.ghost = null;
    }
    if (!target) return;
    if (!this.ghost) {
      this.ghost = { key, group: createGhost(target.type) };
      this.scene.add(this.ghost.group);
    }
    const cell = this.hoverCell(target.type);
    this.ghost.group.visible = cell !== null;
    if (!cell) return;
    const size = BUILDING_DEFS[target.type].size;
    const p = cellToWorld(cell.x, cell.y, size);
    this.ghost.group.position.set(p.x, 0, p.z);
    setGhostValid(this.ghost.group, isAreaFree(this.game.state, cell.x, cell.y, size, target.ignoreId));
  }

  private updateOverlays(): void {
    const items = [];
    const state = this.game.state;
    for (const b of state.buildings) {
      const def = BUILDING_DEFS[b.type];
      const p = cellToWorld(b.x, b.y, def.size);
      const top = new THREE.Vector3(p.x, b.type === 'wall' ? 1.4 : 3.2, p.z);
      if (b.construction) {
        const c = b.construction;
        items.push({
          key: `c${b.id}`,
          pos: top,
          label: b.level === 0 ? 'Construyendo' : `Nivel ${c.targetLevel}`,
          seconds: c.remainingTicks / TICK_RATE,
          progress: 1 - c.remainingTicks / c.totalTicks,
          kind: 'build' as const,
        });
      }
      const trainees = getTrainees(state, b.id);
      trainees.forEach((v, i) => {
        if (v.task.kind !== 'train') return;
        items.push({
          key: `t${v.id}`,
          pos: top.clone().setY(top.y + 0.8 * (i + (b.construction ? 1 : 0))),
          label: v.name,
          seconds: v.task.remainingTicks / TICK_RATE,
          progress: 1 - v.task.remainingTicks / v.task.totalTicks,
          kind: 'train' as const,
        });
      });
    }
    this.overlays.update(items);
  }

  // -------------------------------------------------------------------------
  // Entrada
  // -------------------------------------------------------------------------

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
    return null;
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
  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
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
