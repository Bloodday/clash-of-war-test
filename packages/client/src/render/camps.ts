import * as THREE from 'three/webgpu';
import { CAMP_SLOTS, RESOURCES, baseLoot, generateMonsterCamp, type GameState, type MonsterCamp } from '@cow/shared';
import { localBounds, type Assets } from './assets';
import { terrainHeight } from './environment';
import type { Marker } from './overlays';
import type { Particles } from './particles';
import { createBones, createCampfire, createChest, createTotem } from './props';
import { dressCharacter, lookFor } from './villagers';
import { RESOURCE_ICONS, fmtNum } from '../ui/format';

// Campamentos de monstruos en el bosque que rodea la aldea: tiendas, hoguera y
// esqueletos de guardia. Se atacan desde su etiqueta para conseguir botín.

const SCALE = 0.42;
const GROUND_RADIUS = 4.4;

interface Guard {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  current: string;
  busy: number;
}

interface CampView {
  camp: MonsterCamp;
  root: THREE.Group;
  guards: Guard[];
  fire: THREE.Vector3;
  fireClock: number;
  marker: { title: string; sub: string };
  ticks: ((dt: number) => void)[];
}

export class CampViews {
  readonly group = new THREE.Group();
  private views = new Map<number, CampView>();
  private first = true;

  constructor(
    private assets: Assets,
    private particles: Particles,
  ) {}

  update(state: GameState, dt: number): void {
    const seen = new Set<number>();
    for (const camp of state.camps) {
      seen.add(camp.id);
      let view = this.views.get(camp.id);
      if (!view) {
        view = this.create(camp, !this.first);
        this.views.set(camp.id, view);
      }
      this.animate(view, dt);
    }
    for (const [id, view] of this.views) {
      if (seen.has(id)) continue;
      // Campamento arrasado: desaparece entre polvo.
      this.particles.dust(view.root.position.clone().setY(view.root.position.y + 0.3), 3, 40);
      this.group.remove(view.root);
      this.views.delete(id);
    }
    this.first = false;
  }

  /** Etiquetas clicables sobre cada campamento. */
  markers(onAttack: (campId: number) => void): Marker[] {
    return [...this.views.values()].map((v) => ({
      key: `camp${v.camp.id}`,
      pos: v.root.position.clone().setY(v.root.position.y + 2.6),
      title: v.marker.title,
      sub: v.marker.sub,
      onClick: () => onAttack(v.camp.id),
    }));
  }

  /** Campamento bajo el rayo (para atacarlo al hacer clic en él). */
  pick(raycaster: THREE.Raycaster): number | null {
    for (const h of raycaster.intersectObjects(this.group.children, true)) {
      let o: THREE.Object3D | null = h.object;
      while (o && o.userData.campId === undefined) o = o.parent;
      if (o) return o.userData.campId as number;
    }
    return null;
  }

  private create(camp: MonsterCamp, fresh: boolean): CampView {
    const slot = CAMP_SLOTS[camp.slot % CAMP_SLOTS.length]!;
    const y0 = terrainHeight(slot.x, slot.z);
    const root = new THREE.Group();
    root.position.set(slot.x, y0, slot.z);
    root.userData.campId = camp.id;
    const at = (x: number, z: number) => terrainHeight(slot.x + x, slot.z + z) - y0;
    const ticks: ((dt: number) => void)[] = [];

    root.add(groundPatch(slot.x, slot.z, y0));
    const fire = createCampfire();
    fire.scale.setScalar(1.3);
    fire.position.y = at(0, 0);
    root.add(fire);

    const base = generateMonsterCamp(camp.seed, camp.level);
    const place = (obj: THREE.Object3D, angle: number, r: number, face = true) => {
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      obj.position.set(x, at(x, z), z);
      if (face) obj.rotation.y = Math.atan2(-x, -z);
      root.add(obj);
    };
    const tents = Math.min(3, base.buildings.filter((b) => b.type === 'campTent').length);
    for (let i = 0; i < tents; i++) {
      const tent = this.assets.model('tent');
      fitWidth(tent, 1.9);
      const holder = new THREE.Group();
      holder.add(tent);
      place(holder, camp.seed * 0.1 + (i / tents) * Math.PI * 2, 3);
    }
    const chest = createChest();
    chest.scale.setScalar(1.1);
    place(chest, camp.seed * 0.1 + Math.PI / tents, 2.2);
    if (base.buildings.some((b) => b.type === 'campTotem')) {
      const { root: totem, orb } = createTotem();
      place(totem, camp.seed * 0.1 + Math.PI * 1.3, 3.4, false);
      let t = 0;
      ticks.push((dt) => {
        t += dt;
        orb.position.y = 1.36 + Math.sin(t * 2.2) * 0.05;
      });
    }
    for (let i = 0; i < 3; i++) place(createBones(camp.seed + i), i * 2.1 + 0.5, 3.8, false);

    // Guardia: los primeros defensores del campamento, alrededor del fuego.
    const guards: Guard[] = [];
    const shown = base.defenders.slice(0, 5);
    shown.forEach((d, i) => {
      const model = dressCharacter(this.assets, lookFor({ role: d.role, roleLevel: d.level }), SCALE);
      const g = new THREE.Group();
      g.add(model);
      place(g, (i / shown.length) * Math.PI * 2 + 0.4, 1.35 + (i % 2) * 0.25);
      const guard: Guard = { root: g, mixer: new THREE.AnimationMixer(model), actions: new Map(), current: '', busy: Math.random() * 4 };
      guards.push(guard);
      this.play(guard, fresh ? 'Skeletons_Awaken_Floor' : 'Idle_Combat', fresh);
      if (fresh) guard.busy = this.assets.clip('Skeletons_Awaken_Floor').duration;
    });
    if (fresh) this.particles.dust(root.position.clone().setY(y0 + 0.2), 3, 40);

    const loot = baseLoot(base);
    const lootText = RESOURCES.filter((r) => loot[r] > 0)
      .map((r) => `${RESOURCE_ICONS[r]} ${fmtNum(loot[r])}`)
      .join('  ');
    this.group.add(root);
    return {
      camp,
      root,
      guards,
      fire: new THREE.Vector3(slot.x, y0 + at(0, 0) + 0.25, slot.z),
      fireClock: 0,
      marker: { title: `💀 ${base.name} · nv ${camp.level}`, sub: `${base.defenders.length} monstruos · ${lootText}` },
      ticks,
    };
  }

  private play(g: Guard, clip: string, once = false): void {
    let a = g.actions.get(clip);
    if (!a) {
      a = g.mixer.clipAction(this.assets.clip(clip));
      g.actions.set(clip, a);
    }
    const prev = g.current ? g.actions.get(g.current) : undefined;
    a.reset();
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = once;
    a.play();
    if (prev && prev !== a) a.crossFadeFrom(prev, 0.3, false);
    g.current = clip;
  }

  private animate(view: CampView, dt: number): void {
    view.fireClock -= dt;
    if (view.fireClock <= 0) {
      view.fireClock = 0.09;
      const p = view.fire.clone();
      p.x += (Math.random() - 0.5) * 0.35;
      p.z += (Math.random() - 0.5) * 0.35;
      this.particles.fire(p, 0.75);
      if (Math.random() < 0.15) this.particles.smoke(view.fire.clone().setY(view.fire.y + 1), 0.8);
    }
    for (const t of view.ticks) t(dt);
    for (const g of view.guards) {
      g.busy -= dt;
      if (g.busy <= 0) {
        // Alternan entre guardia y burlas.
        const taunt = g.current !== 'Taunt' && Math.random() < 0.35;
        this.play(g, taunt ? 'Taunt' : 'Idle_Combat', taunt);
        g.busy = taunt ? this.assets.clip('Taunt').duration : 3 + Math.random() * 5;
      }
      g.mixer.update(dt);
    }
  }
}

/** Claro de tierra pisada que sigue el relieve del terreno. */
function groundPatch(cx: number, cz: number, y0: number): THREE.Mesh {
  const geo = new THREE.CircleGeometry(GROUND_RADIUS, 40, 0, Math.PI * 2).rotateX(-Math.PI / 2);
  // Borde irregular y altura del terreno en cada vértice.
  const pos = geo.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r > 0.01) {
      const a = Math.atan2(z, x);
      const k = 1 + Math.sin(a * 5 + cx) * 0.07 + Math.sin(a * 3 + cz) * 0.05;
      x *= k;
      z *= k;
    }
    pos.setXYZ(i, x, terrainHeight(cx + x, cz + z) - y0 + 0.05, z);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#76603f', roughness: 1 }));
  m.receiveShadow = true;
  return m;
}

function fitWidth(obj: THREE.Object3D, width: number): void {
  const box = localBounds(obj);
  const size = box.getSize(new THREE.Vector3());
  const k = width / Math.max(size.x, size.z, 0.001);
  obj.scale.setScalar(k);
  obj.position.set(-(box.min.x + size.x / 2) * k, -box.min.y * k, -(box.min.z + size.z / 2) * k);
}
