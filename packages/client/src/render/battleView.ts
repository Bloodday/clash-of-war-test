import * as THREE from 'three/webgpu';
import type { MapControls } from 'three/addons/controls/MapControls.js';
import {
  BUILDING_DEFS,
  GRID_SIZE,
  RESOURCES,
  canDeploy,
  type BattleBuilding,
  type BattleEvent,
  type BattleUnit,
  type Building,
  type Projectile,
} from '@cow/shared';
import type { BattleController } from '../game/BattleController';
import type { UiStore } from '../ui/UiStore';
import { RESOURCE_ICONS, fmtNum } from '../ui/format';
import type { Assets } from './assets';
import { createBuildingVisual, disposeVisual, teamModels, type BuildingVisual } from './buildings';
import { hopScale, popScale } from './fx';
import type { OverlayItem, Overlays } from './overlays';
import type { Particles } from './particles';
import { BODY_PART, lookFor } from './villagers';

// Vista 3D y controles RTS de una batalla. La simulación vive en @cow/shared;
// aquí solo se dibuja su estado y se traducen los clics a comandos.

export interface BattleContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: MapControls;
  dom: HTMLElement;
  assets: Assets;
  particles: Particles;
  overlays: Overlays;
  ui: UiStore;
  shake: (amount: number) => void;
}

const SCALE = 0.42;
const TEAM_COLOR = { attacker: '#3d8bff', defender: '#ff4a3d' } as const;
const PICK_RADIUS_PX = 28;

/** Celdas (x, y continuas) → mundo. */
const toWorld = (x: number, y: number, h = 0) => new THREE.Vector3(x - GRID_SIZE / 2, h, y - GRID_SIZE / 2);

interface UnitView {
  root: THREE.Group;
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  current: string;
  busyUntil: number; // hasta cuándo dura la animación de ataque en curso
  lastAttackTick: number;
  selection: THREE.Mesh;
  bar: THREE.Group;
  barFill: THREE.Mesh;
  deadFor: number;
  swing: number;
}

interface BuildingView {
  key: string;
  visual: BuildingVisual;
  anim: { kind: 'pop' | 'hop'; t: number; duration: number } | null;
  fxClock: number;
}

const ATTACK_CLIPS: Record<string, string[]> = {
  warrior: ['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Stab'],
  archer: ['2H_Ranged_Shoot'],
  healer: ['Spellcast_Shoot'],
};
const READY_CLIP: Record<string, string> = { warrior: 'Idle', archer: '2H_Ranged_Aiming', healer: 'Idle' };

// Geometrías y materiales compartidos por todas las unidades.
const discGeo = new THREE.CircleGeometry(0.3, 24).rotateX(-Math.PI / 2);
const ringGeo = new THREE.RingGeometry(0.34, 0.43, 32).rotateX(-Math.PI / 2);
const barGeo = new THREE.PlaneGeometry(0.62, 0.075);
const discMat = {
  attacker: new THREE.MeshBasicMaterial({ color: TEAM_COLOR.attacker, transparent: true, opacity: 0.55, depthWrite: false }),
  defender: new THREE.MeshBasicMaterial({ color: TEAM_COLOR.defender, transparent: true, opacity: 0.55, depthWrite: false }),
};
const ringMat = new THREE.MeshBasicMaterial({ color: '#ffe066', transparent: true, opacity: 0.95, depthWrite: false });
const barBgMat = new THREE.MeshBasicMaterial({ color: '#1a1410', transparent: true, opacity: 0.8, depthTest: false });
const barMat = {
  attacker: new THREE.MeshBasicMaterial({ color: '#7cf05a', depthTest: false }),
  defender: new THREE.MeshBasicMaterial({ color: '#ff5a4a', depthTest: false }),
};

function arrowMesh(color: string): THREE.Group {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.55, 5), new THREE.MeshStandardMaterial({ color }));
  shaft.rotation.x = Math.PI / 2;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.12, 5), new THREE.MeshStandardMaterial({ color: '#c9ccd1', roughness: 0.3 }));
  tip.rotation.x = Math.PI / 2;
  tip.position.z = 0.32;
  const fletch = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.005, 0.12), new THREE.MeshStandardMaterial({ color: '#f2efe6' }));
  fletch.position.z = -0.24;
  g.add(shaft, tip, fletch);
  return g;
}

function healOrb(): THREE.Mesh {
  const m = new THREE.MeshStandardMaterial({ color: '#b6ffb0', emissive: new THREE.Color('#5dff7a'), emissiveIntensity: 2.5 });
  return new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), m);
}

export class BattleView {
  readonly group = new THREE.Group();
  readonly selected = new Set<number>();
  private buildings = new Map<number, BuildingView>();
  private units = new Map<number, UnitView>();
  private projectiles = new Map<number, { obj: THREE.Object3D; kind: Projectile['kind']; total: number }>();
  private models;
  private zone: THREE.Mesh;
  private zoneCanvas = document.createElement('canvas');
  private zoneTexture: THREE.CanvasTexture;
  private zoneVersion = -1;
  private zoneFlash = 0;
  private marker: THREE.Mesh;
  private markerT = 1;
  private raycaster = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private boxEl: HTMLDivElement;
  private box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private deploying: { last: THREE.Vector3 | null; time: number } | null = null;
  private elapsed = 0;

  constructor(
    private ctx: BattleContext,
    readonly battle: BattleController,
  ) {
    this.models = teamModels(ctx.assets, 'red');
    this.zoneCanvas.width = this.zoneCanvas.height = GRID_SIZE;
    this.zoneTexture = new THREE.CanvasTexture(this.zoneCanvas);
    this.zoneTexture.magFilter = THREE.NearestFilter;
    this.zoneTexture.colorSpace = THREE.SRGBColorSpace;
    this.zone = new THREE.Mesh(
      new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: this.zoneTexture, transparent: true, depthWrite: false, opacity: 0 }),
    );
    this.zone.position.y = 0.035;
    this.zone.renderOrder = 2;
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.45, 32).rotateX(-Math.PI / 2), ringMat.clone());
    this.marker.visible = false;
    this.group.add(this.zone, this.marker);
    this.boxEl = document.createElement('div');
    this.boxEl.className = 'box-select';
    document.body.appendChild(this.boxEl);
    ctx.scene.add(this.group);
    this.sync(0);
  }

  dispose(): void {
    this.ctx.scene.remove(this.group);
    for (const v of this.buildings.values()) disposeVisual(v.visual);
    this.boxEl.remove();
    this.ctx.overlays.update([], 0);
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  update(dt: number): void {
    this.elapsed += dt;
    for (const e of this.battle.takeEvents()) this.onEvent(e);
    this.sync(dt);
    this.updateZone(dt);
    if (this.markerT < 1) {
      this.markerT += dt / 0.6;
      const s = 1 + this.markerT * 0.8;
      this.marker.scale.set(s, 1, s);
      (this.marker.material as THREE.MeshBasicMaterial).opacity = 1 - this.markerT;
      this.marker.visible = this.markerT < 1;
    }
    this.updateOverlays(dt);
  }

  private sync(dt: number): void {
    const s = this.battle.state;
    // Edificios
    for (const b of s.buildings) {
      const key = `${b.type}:${b.level}:${b.destroyed ? 'x' : ''}`;
      let view = this.buildings.get(b.id);
      if (!view || view.key !== key) {
        if (view) {
          this.group.remove(view.visual.root);
          disposeVisual(view.visual);
        }
        const fake: Building = {
          id: b.id,
          type: b.type,
          x: b.x,
          y: b.y,
          level: b.level,
          construction: null,
          hp: b.destroyed ? 0 : b.hp,
          stored: 0,
          recruits: [],
        };
        const visual = createBuildingVisual(this.models, fake, b.type === 'wall' ? this.wallMask(b) : 0);
        const p = toWorld(b.x + b.size / 2, b.y + b.size / 2);
        visual.root.position.copy(p);
        view = { key, visual, anim: view ? { kind: 'pop', t: 0, duration: 0.6 } : null, fxClock: 0 };
        this.buildings.set(b.id, view);
        this.group.add(visual.root);
      }
      this.animateBuilding(b, view, dt);
    }
    // Unidades
    for (const u of s.units) {
      let view = this.units.get(u.id);
      if (!view) view = this.spawnUnit(u);
      this.animateUnit(u, view, dt);
    }
    // Proyectiles
    const alive = new Set<number>();
    for (const p of s.projectiles) {
      alive.add(p.id);
      let pv = this.projectiles.get(p.id);
      if (!pv) {
        const obj = p.kind === 'heal' ? healOrb() : arrowMesh(p.kind === 'arrow' ? '#8a5a2b' : '#3b3b44');
        const target = this.targetPos(p.targetId);
        const total = target ? Math.hypot(target.x - p.sx, target.y - p.sy) : 1;
        pv = { obj, kind: p.kind, total: Math.max(0.5, total) };
        obj.position.copy(toWorld(p.x, p.y, p.height));
        this.group.add(obj);
        this.projectiles.set(p.id, pv);
      }
      const target = this.targetPos(p.targetId);
      const traveled = Math.hypot(p.x - p.sx, p.y - p.sy);
      const remaining = target ? Math.hypot(target.x - p.x, target.y - p.y) : 0;
      const f = Math.min(1, traveled / Math.max(0.01, traveled + remaining));
      const endH = target?.h ?? 0.5;
      const h = p.height + (endH - p.height) * f + Math.sin(f * Math.PI) * pv.total * 0.12;
      const next = toWorld(p.x, p.y, h);
      if (pv.obj.position.distanceToSquared(next) > 1e-6) pv.obj.lookAt(next);
      pv.obj.position.copy(next);
      if (p.kind === 'heal' && Math.random() < dt * 30) this.ctx.particles.magic(next, '#9dffa0');
    }
    for (const [id, pv] of this.projectiles) {
      if (!alive.has(id)) {
        this.group.remove(pv.obj);
        this.projectiles.delete(id);
      }
    }
  }

  private wallMask(b: BattleBuilding): number {
    const walls = this.battle.state.buildings.filter((x) => x.type === 'wall' && !x.destroyed);
    const has = (x: number, y: number) => walls.some((w) => w.x === x && w.y === y);
    return (has(b.x + 1, b.y) ? 1 : 0) | (has(b.x - 1, b.y) ? 2 : 0) | (has(b.x, b.y + 1) ? 4 : 0) | (has(b.x, b.y - 1) ? 8 : 0);
  }

  private targetPos(id: number): { x: number; y: number; h: number } | null {
    const s = this.battle.state;
    const u = s.units.find((x) => x.id === id);
    if (u) return { x: u.x, y: u.y, h: 0.55 };
    const b = s.buildings.find((x) => x.id === id);
    if (b) return { x: b.x + b.size / 2, y: b.y + b.size / 2, h: 0.8 };
    return null;
  }

  private animateBuilding(b: BattleBuilding, view: BuildingView, dt: number): void {
    const v = view.visual;
    v.update(dt, b.type === 'archerTower' && !b.destroyed);
    if (view.anim) {
      view.anim.t += dt / view.anim.duration;
      const [sxz, sy] = view.anim.kind === 'pop' ? popScale(view.anim.t) : hopScale(view.anim.t);
      v.body.scale.set(sxz, sy, sxz);
      if (view.anim.t >= 1) {
        view.anim = null;
        v.body.scale.set(1, 1, 1);
      }
    }
    if (!b.destroyed && b.hp < b.maxHp) {
      const ratio = b.hp / b.maxHp;
      view.fxClock -= dt;
      if (view.fxClock <= 0) {
        view.fxClock = 0.2 + ratio * 0.4;
        const top = v.root.position.clone().setY(Math.max(0.5, v.height * 0.7));
        if (ratio < 0.7) this.ctx.particles.darkSmoke(top, 0.4 + b.size * 0.2);
        if (ratio < 0.35) this.ctx.particles.fire(top.setY(top.y * 0.6), 0.3 + b.size * 0.15);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Unidades
  // ---------------------------------------------------------------------------

  private spawnUnit(u: BattleUnit): UnitView {
    const look = lookFor({ role: u.role, roleLevel: u.level });
    const model = this.ctx.assets.character(look.character);
    model.scale.setScalar(SCALE);
    model.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.SkinnedMesh) {
        o.visible = BODY_PART.test(o.name) || look.show.includes(o.name);
        o.castShadow = true;
        o.frustumCulled = false;
      }
    });
    const root = new THREE.Group();
    root.add(model);
    const disc = new THREE.Mesh(discGeo, discMat[u.side]);
    disc.position.y = 0.02;
    const selection = new THREE.Mesh(ringGeo, ringMat);
    selection.position.y = 0.03;
    selection.visible = false;
    const bar = new THREE.Group();
    const bg = new THREE.Mesh(barGeo, barBgMat);
    const barFill = new THREE.Mesh(barGeo, barMat[u.side]);
    barFill.position.z = 0.001;
    bar.add(bg, barFill);
    bar.position.y = 1.05;
    bar.renderOrder = 20;
    bg.renderOrder = 20;
    barFill.renderOrder = 21;
    root.add(disc, selection, bar);
    root.position.copy(toWorld(u.x, u.y));
    root.rotation.y = u.facing;
    this.group.add(root);
    const view: UnitView = {
      root,
      model,
      mixer: new THREE.AnimationMixer(model),
      actions: new Map(),
      current: '',
      busyUntil: 0,
      lastAttackTick: u.lastAttackTick,
      selection,
      bar,
      barFill,
      deadFor: 0,
      swing: 0,
    };
    this.units.set(u.id, view);
    return view;
  }

  private play(view: UnitView, clip: string, once = false, timeScale = 1): void {
    if (view.current === clip && !once) return;
    let action = view.actions.get(clip);
    if (!action) {
      action = view.mixer.clipAction(this.ctx.assets.clip(clip));
      view.actions.set(clip, action);
    }
    const prev = view.current ? view.actions.get(view.current) : undefined;
    action.reset();
    action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = once;
    action.timeScale = timeScale;
    action.play();
    if (prev && prev !== action) action.crossFadeFrom(prev, 0.15, false);
    view.current = clip;
  }

  private animateUnit(u: BattleUnit, view: UnitView, dt: number): void {
    const target = toWorld(u.x, u.y);
    view.root.position.lerp(target, Math.min(1, dt * 14));
    let d = u.facing - view.root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    view.root.rotation.y += d * Math.min(1, dt * 12);

    view.selection.visible = this.selected.has(u.id) && u.state !== 'dead';
    if (view.selection.visible) view.selection.scale.setScalar(1 + Math.sin(this.elapsed * 6) * 0.06);
    const ratio = u.hp / u.maxHp;
    view.bar.visible = u.state !== 'dead' && (ratio < 1 || view.selection.visible);
    view.barFill.scale.x = Math.max(0.001, ratio);
    view.barFill.position.x = -0.31 * (1 - ratio);
    view.bar.quaternion.copy(this.ctx.camera.quaternion);
    view.bar.quaternion.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -view.root.rotation.y, 0)));

    if (u.state === 'dead') {
      if (view.deadFor === 0) this.play(view, 'Death_A', true);
      view.deadFor += dt;
      if (view.deadFor > 2.5) view.root.position.y = -Math.min(0.8, (view.deadFor - 2.5) * 0.4);
      if (view.deadFor > 5) view.root.visible = false;
      view.mixer.update(dt);
      return;
    }

    const now = this.elapsed;
    if (u.lastAttackTick !== view.lastAttackTick) {
      view.lastAttackTick = u.lastAttackTick;
      const clips = ATTACK_CLIPS[u.role]!;
      const clip = clips[view.swing++ % clips.length]!;
      this.play(view, clip, true, 1.2);
      view.busyUntil = now + this.ctx.assets.clip(clip).duration / 1.2;
    } else if (now >= view.busyUntil) {
      if (u.state === 'moving') this.play(view, 'Running_A');
      else if (u.state === 'attacking') this.play(view, READY_CLIP[u.role]!);
      else this.play(view, 'Idle');
    }
    view.mixer.update(dt);
  }

  // ---------------------------------------------------------------------------
  // Eventos → efectos
  // ---------------------------------------------------------------------------

  private posOf(id: number, h = 0.5): THREE.Vector3 | null {
    const p = this.targetPos(id);
    return p ? toWorld(p.x, p.y, h) : null;
  }

  private onEvent(e: BattleEvent): void {
    const fx = this.ctx.particles;
    switch (e.kind) {
      case 'deploy': {
        const p = this.posOf(e.unitId, 0.1);
        if (p) fx.dust(p, 0.3, 10);
        break;
      }
      case 'hit': {
        const p = this.posOf(e.targetId, 0.6);
        if (!p) break;
        const bld = this.battle.state.buildings.find((b) => b.id === e.targetId);
        if (bld) {
          fx.sparks(p, e.melee ? 5 : 3, '#ffd28a');
          const view = this.buildings.get(bld.id);
          if (view && !view.anim && bld.type !== 'wall') view.anim = { kind: 'hop', t: 0, duration: 0.25 };
        } else {
          fx.sparks(p, 4, '#ff8a7a');
        }
        break;
      }
      case 'heal': {
        const p = this.posOf(e.targetId, 0.6);
        if (p) fx.collect(p, '#9dffa0');
        break;
      }
      case 'death': {
        const p = this.posOf(e.unitId, 0.2);
        if (p) fx.dust(p, 0.3, 12);
        this.selected.delete(e.unitId);
        this.ctx.ui.notify();
        break;
      }
      case 'destroyed': {
        const b = this.battle.state.buildings.find((x) => x.id === e.buildingId);
        if (!b) break;
        const p = toWorld(b.x + b.size / 2, b.y + b.size / 2, 0.8);
        fx.explosion(p, 0.5 + b.size * 0.25);
        if (b.type !== 'wall') this.ctx.shake(0.25 + b.size * 0.05);
        const parts = RESOURCES.filter((r) => (e.loot[r] ?? 0) > 0);
        for (const r of parts) {
          const amount = e.loot[r]!;
          this.ctx.overlays.floatText(p.clone().setY(1.8), `+${fmtNum(amount)} ${RESOURCE_ICONS[r]}`, r);
          this.ctx.overlays.flyToHud(p.clone().setY(1.5), RESOURCE_ICONS[r], document.querySelector(`[data-loot="${r}"] .res-icon`), Math.min(8, 2 + Math.floor(Math.sqrt(amount) / 3)));
        }
        break;
      }
      case 'star':
        this.ctx.ui.battleStar(e.stars);
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Zona roja y barras de vida
  // ---------------------------------------------------------------------------

  private updateZone(dt: number): void {
    const s = this.battle.state;
    if (this.zoneVersion !== s.gridVersion) {
      this.zoneVersion = s.gridVersion;
      const ctx = this.zoneCanvas.getContext('2d')!;
      ctx.clearRect(0, 0, GRID_SIZE, GRID_SIZE);
      for (let y = 0; y < GRID_SIZE; y++)
        for (let x = 0; x < GRID_SIZE; x++) {
          if (canDeploy(s, x + 0.5, y + 0.5)) continue;
          ctx.fillStyle = 'rgba(235, 40, 30, 0.45)';
          ctx.fillRect(x, y, 1, 1);
        }
      this.zoneTexture.needsUpdate = true;
    }
    const want = s.phase !== 'ended' && (this.ctx.ui.deploy !== null || s.phase === 'scouting') ? 1 : 0;
    this.zoneFlash = Math.max(0, this.zoneFlash - dt * 2);
    const mat = this.zone.material as THREE.MeshBasicMaterial;
    mat.opacity += (Math.min(1, want + this.zoneFlash) - mat.opacity) * Math.min(1, dt * 8);
    mat.color.setRGB(1, 1 - this.zoneFlash * 0.4, 1 - this.zoneFlash * 0.4);
  }

  private updateOverlays(dt: number): void {
    const items: OverlayItem[] = [];
    for (const b of this.battle.state.buildings) {
      if (b.destroyed || b.hp >= b.maxHp || b.type === 'wall') continue;
      const view = this.buildings.get(b.id);
      if (!view) continue;
      items.push({
        key: `bh${b.id}`,
        pos: view.visual.root.position.clone().setY(view.visual.height + 0.5),
        label: `${Math.ceil((b.hp / b.maxHp) * 100)}%`,
        seconds: 0,
        progress: b.hp / b.maxHp,
        kind: 'hp',
      });
    }
    this.ctx.overlays.update(items, dt);
  }

  // ---------------------------------------------------------------------------
  // Entrada (la llama el mundo cuando hay una batalla activa)
  // ---------------------------------------------------------------------------

  private groundAt(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.ctx.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.ctx.camera);
    const hit = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.ground, hit) ? hit : null;
  }

  private screenOf(u: BattleUnit): { x: number; y: number } {
    const v = toWorld(u.x, u.y, 0.5).project(this.ctx.camera);
    const rect = this.ctx.dom.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  private unitAt(clientX: number, clientY: number, side?: BattleUnit['side']): BattleUnit | null {
    let best: BattleUnit | null = null;
    let bestD = PICK_RADIUS_PX;
    for (const u of this.battle.state.units) {
      if (u.state === 'dead' || (side && u.side !== side)) continue;
      const s = this.screenOf(u);
      const d = Math.hypot(s.x - clientX, s.y - clientY);
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }

  private buildingAt(clientX: number, clientY: number): BattleBuilding | null {
    const rect = this.ctx.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.ctx.camera);
    const roots = [...this.buildings.values()].map((v) => v.visual.root);
    for (const h of this.raycaster.intersectObjects(roots, true)) {
      let o: THREE.Object3D | null = h.object;
      while (o && o.userData.buildingId === undefined) o = o.parent;
      const b = o && this.battle.state.buildings.find((x) => x.id === o!.userData.buildingId);
      if (b && !b.destroyed) return b;
    }
    const g = this.groundAt(clientX, clientY);
    if (!g) return null;
    const cx = g.x + GRID_SIZE / 2;
    const cy = g.z + GRID_SIZE / 2;
    return this.battle.state.buildings.find((b) => !b.destroyed && cx >= b.x && cx < b.x + b.size && cy >= b.y && cy < b.y + b.size) ?? null;
  }

  pointerDown(e: PointerEvent): void {
    if (e.button !== 0 || this.battle.ended) return;
    if (this.ctx.ui.deploy) {
      this.deploying = { last: null, time: 0 };
      this.tryDeploy(e.clientX, e.clientY);
      return;
    }
    this.box = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
  }

  pointerMove(e: PointerEvent): void {
    if (this.deploying) {
      this.tryDeploy(e.clientX, e.clientY);
      return;
    }
    if (!this.box) return;
    this.box.x1 = e.clientX;
    this.box.y1 = e.clientY;
    const { x0, y0, x1, y1 } = this.box;
    if (Math.hypot(x1 - x0, y1 - y0) > 6) {
      Object.assign(this.boxEl.style, {
        display: 'block',
        left: `${Math.min(x0, x1)}px`,
        top: `${Math.min(y0, y1)}px`,
        width: `${Math.abs(x1 - x0)}px`,
        height: `${Math.abs(y1 - y0)}px`,
      });
    }
  }

  pointerUp(e: PointerEvent, click: boolean): void {
    if (e.button === 0) {
      this.deploying = null;
      const box = this.box;
      this.box = null;
      this.boxEl.style.display = 'none';
      if (!box) return;
      if (Math.hypot(box.x1 - box.x0, box.y1 - box.y0) > 6) {
        this.selectInRect(box, e.shiftKey);
      } else {
        const u = this.unitAt(e.clientX, e.clientY, 'attacker');
        if (!e.shiftKey) this.selected.clear();
        if (u) this.selected.add(u.id);
      }
      this.ctx.ui.notify();
    } else if (e.button === 2 && click) {
      this.command(e.clientX, e.clientY);
    }
  }

  private tryDeploy(clientX: number, clientY: number): void {
    const key = this.ctx.ui.deploy;
    const g = this.groundAt(clientX, clientY);
    if (!key || !g || !this.deploying) return;
    const now = performance.now();
    if (this.deploying.last && (g.distanceTo(this.deploying.last) < 0.7 || now - this.deploying.time < 110)) return;
    const [role, level] = key.split(':');
    const r = this.battle.state.reserve.find((x) => x.role === role && String(x.level) === level);
    if (!r) {
      this.ctx.ui.deploy = null;
      this.ctx.ui.notify();
      return;
    }
    const res = this.battle.dispatch({ type: 'deploy', villagerId: r.villagerId, x: g.x + GRID_SIZE / 2, y: g.z + GRID_SIZE / 2 });
    if (res.ok) {
      this.deploying.last = g;
      this.deploying.time = now;
      if (!this.battle.state.reserve.some((x) => x.role === role && String(x.level) === level)) {
        this.ctx.ui.deploy = null;
        this.deploying = null;
      }
      this.ctx.ui.notify();
    } else if (res.error === 'forbiddenZone' && !this.deploying.last) {
      this.zoneFlash = 1;
      this.ctx.ui.toast('Despliega fuera de la zona roja, lejos de los edificios.', 'error');
    }
  }

  private selectInRect(box: { x0: number; y0: number; x1: number; y1: number }, add: boolean): void {
    if (!add) this.selected.clear();
    const [xa, xb] = [Math.min(box.x0, box.x1), Math.max(box.x0, box.x1)];
    const [ya, yb] = [Math.min(box.y0, box.y1), Math.max(box.y0, box.y1)];
    for (const u of this.battle.state.units) {
      if (u.side !== 'attacker' || u.state === 'dead') continue;
      const s = this.screenOf(u);
      if (s.x >= xa && s.x <= xb && s.y >= ya && s.y <= yb) this.selected.add(u.id);
    }
  }

  selectAll(): void {
    this.selected.clear();
    for (const u of this.battle.state.units) if (u.side === 'attacker' && u.state !== 'dead') this.selected.add(u.id);
    this.ctx.ui.notify();
  }

  clearSelection(): void {
    this.selected.clear();
    this.ctx.ui.notify();
  }

  /** Clic derecho: atacar lo que hay bajo el cursor o moverse en formación. */
  private command(clientX: number, clientY: number): void {
    const ids = [...this.selected];
    if (ids.length === 0) return;
    const enemy = this.unitAt(clientX, clientY, 'defender');
    const bld = enemy ? null : this.buildingAt(clientX, clientY);
    if (enemy || bld) {
      const targetId = enemy ? enemy.id : bld!.id;
      this.battle.dispatch({ type: 'order', unitIds: ids, order: { kind: 'attack', targetId } });
      const p = this.posOf(targetId, 0.05);
      if (p) this.flashMarker(p, '#ff5a4a');
      return;
    }
    const g = this.groundAt(clientX, clientY);
    if (!g) return;
    const cx = g.x + GRID_SIZE / 2;
    const cy = g.z + GRID_SIZE / 2;
    // Formación: cuadrícula compacta alrededor del punto.
    const cols = Math.ceil(Math.sqrt(ids.length));
    ids.forEach((id, i) => {
      const ox = ((i % cols) - (cols - 1) / 2) * 0.7;
      const oy = (Math.floor(i / cols) - (Math.ceil(ids.length / cols) - 1) / 2) * 0.7;
      this.battle.dispatch({ type: 'order', unitIds: [id], order: { kind: 'move', x: cx + ox, y: cy + oy } });
    });
    this.flashMarker(g.setY(0.05), '#ffe066');
  }

  private flashMarker(p: THREE.Vector3, color: string): void {
    this.marker.position.copy(p);
    (this.marker.material as THREE.MeshBasicMaterial).color.set(color);
    this.markerT = 0;
    this.marker.visible = true;
  }
}
