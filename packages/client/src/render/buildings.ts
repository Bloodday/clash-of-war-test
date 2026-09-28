import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { hash, instanceIndex, positionLocal, sin, time, vec3, vertexColor } from 'three/tsl';
import { BUILDING_DEFS, type Building, type BuildingType } from '@cow/shared';
import { localBounds } from './assets';
import { createBanner, createBones, createCampfire, createCatapult, createChest, createCot, createTotem } from './props';

/** Fuente de modelos (Assets o una versión con el color de otro equipo). */
export interface ModelSource {
  model(name: string): THREE.Object3D;
  has(name: string): boolean;
}

export type Team = 'blue' | 'red';

/** Mismos modelos con el color de otro equipo (los packs traen variantes _blue/_red). */
export function teamModels(src: ModelSource, team: Team): ModelSource {
  if (team === 'blue') return src;
  const swap = (n: string) => n.replace('_blue', `_${team}`);
  return { model: (n) => src.model(swap(n)), has: (n) => src.has(swap(n)) };
}
import { seeded } from './noise';

// Representación visual de los edificios a partir de los modelos KayKit.

export interface BuildingVisual {
  /** Nodo posicionado por el mundo. */
  root: THREE.Group;
  /** Hijo que se deforma en las animaciones de aparición/selección. */
  body: THREE.Group;
  /** Altura aproximada del modelo (para etiquetas y efectos). */
  height: number;
  /** Puntos locales de donde sale humo (chimeneas). */
  smoke: THREE.Vector3[];
  /** Anima las piezas móviles. `active` indica si el edificio está trabajando. */
  update(dt: number, active: boolean): void;
  /** Productores: refleja lo acumulado (0..1): el trigo crece, las pilas aumentan. */
  setFill(fraction: number): void;
}

interface Spec {
  models: string[]; // uno por nivel (se repite el último); vacío si todo lo pone `extra`
  fill: number; // fracción de la huella que ocupa el modelo
  pad: string;
  offset?: [number, number]; // desplazamiento del modelo principal (−0.5..0.5)
  /** Piezas procedurales; devuelve su altura. */
  extra?: (assets: ModelSource, body: THREE.Group, size: number, level: number) => number;
  props?: (level: number) => [string, number, number, number, number?][]; // modelo, x, z (−0.5..0.5), escala relativa, rotación
  chimney?: [number, number, number]; // posición relativa al tamaño del modelo
}

const PAD_DIRT = '#b99a6b';
const PAD_STONE = '#a7a193';
const PAD_GRASS = '#86b653';

const SPECS: Record<Exclude<BuildingType, 'wall' | 'farm'>, Spec> = {
  townHall: {
    models: ['building_castle_blue'],
    fill: 0.62,
    pad: PAD_STONE,
    props: (l) => [
      ...(l >= 2 ? ([['flag_blue', -0.44, 0.44, 0.06], ['flag_blue', 0.44, 0.44, 0.06]] as const) : []),
      ...(l >= 3 ? ([['building_tower_A_blue', -0.4, -0.4, 0.24], ['building_tower_A_blue', 0.4, -0.4, 0.24]] as const) : []),
      ...(l >= 4 ? ([['building_well_blue', 0.42, 0.05, 0.16], ['barrel', -0.44, 0.1, 0.07], ['crate_A_small', -0.44, -0.02, 0.07]] as const) : []),
      ...(l >= 5 ? ([['building_tower_B_blue', -0.4, 0.4, 0.24], ['building_tower_B_blue', 0.4, 0.4, 0.24]] as const) : []),
    ] as [string, number, number, number][],
  },
  house: {
    models: ['building_home_A_blue', 'building_home_B_blue', 'building_home_B_blue'],
    fill: 0.9,
    pad: PAD_GRASS,
    props: (l) =>
      [
        ...(l >= 2 ? ([['barrel', 0.4, 0.4, 0.2]] as const) : []),
        ...(l >= 3 ? ([['crate_A_small', -0.42, 0.42, 0.16], ['flag_blue', 0.44, -0.44, 0.06]] as const) : []),
      ] as [string, number, number, number][],
    chimney: [0.2, 0.95, -0.1],
  },
  inn: {
    models: ['building_tavern_blue'],
    fill: 0.8,
    pad: PAD_DIRT,
    props: (l) => [
      ['barrel', 0.42, 0.42, 0.13],
      ['barrel', 0.3, 0.46, 0.11],
      ...(l >= 2 ? ([['building_well_blue', -0.38, 0.38, 0.22]] as const) : []),
      ...(l >= 3 ? ([['tent', 0.38, -0.38, 0.22], ['flag_blue', -0.45, -0.45, 0.05]] as const) : []),
    ] as [string, number, number, number, number?][],
    chimney: [0.15, 0.95, -0.15],
  },
  workshop: {
    models: ['building_blacksmith_blue'],
    fill: 0.8,
    pad: PAD_DIRT,
    props: (l) => [
      ['resource_lumber', 0.36, 0.42, 0.26, 0.2],
      ['resource_stone', -0.4, 0.42, 0.18],
      ...(l >= 2 ? ([['ladder', 0.46, -0.2, 0.08]] as const) : []),
      ...(l >= 3 ? ([['wheelbarrow', -0.4, -0.38, 0.18, 0.8]] as const) : []),
    ] as [string, number, number, number, number?][],
    chimney: [0.28, 0.9, -0.25],
  },
  lumberCamp: {
    models: ['building_lumbermill_blue'],
    fill: 0.7,
    pad: PAD_DIRT,
    props: (l) => [
      ['resource_lumber', 0.3, 0.38, 0.35, 0.3],
      ['tree_single_A_cut', -0.4, 0.4, 0.12],
      ...(l >= 2 ? ([['wheelbarrow', 0.4, -0.3, 0.2, 1.2]] as const) : []),
      ...(l >= 3 ? ([['resource_lumber', -0.38, -0.36, 0.3, 1.5]] as const) : []),
    ] as [string, number, number, number, number?][],
    chimney: [-0.1, 1.0, -0.1],
  },
  goldMine: {
    models: ['building_mine_blue'],
    fill: 0.8,
    pad: PAD_DIRT,
    props: (l) => [
      ['resource_stone', 0.36, 0.38, 0.3],
      ...(l >= 2 ? ([['wheelbarrow', -0.36, 0.4, 0.22, -0.6]] as const) : []),
      ...(l >= 3 ? ([['crate_A_small', 0.42, -0.1, 0.16]] as const) : []),
    ] as [string, number, number, number, number?][],
  },
  storehouse: {
    models: ['building_market_blue'],
    fill: 0.78,
    pad: PAD_DIRT,
    props: (l) => [
      ['crate_A_big', -0.4, 0.4, 0.2],
      ['sack', 0.4, 0.42, 0.16],
      ...(l >= 2 ? ([['barrel', 0.42, -0.36, 0.16], ['crate_long_A', -0.4, -0.38, 0.2, 1.57]] as const) : []),
      ...(l >= 3 ? ([['crate_open', 0.0, 0.46, 0.18]] as const) : []),
    ] as [string, number, number, number, number?][],
  },
  barracks: {
    models: ['building_barracks_blue'],
    fill: 0.78,
    pad: PAD_STONE,
    props: (l) => [
      ['weaponrack', 0.36, 0.42, 0.24],
      ...(l >= 2 ? ([['flag_blue', -0.44, 0.44, 0.06]] as const) : []),
      ...(l >= 3 ? ([['tent', -0.36, -0.4, 0.24]] as const) : []),
    ] as [string, number, number, number, number?][],
    chimney: [0.25, 0.9, 0.0],
  },
  archeryRange: {
    models: ['building_archeryrange_blue'],
    fill: 0.72,
    pad: PAD_GRASS,
    props: (l) => [
      ['target', -0.36, 0.42, 0.22],
      ['bucket_arrows', 0.42, 0.42, 0.14],
      ...(l >= 2 ? ([['target', 0.0, 0.46, 0.22]] as const) : []),
      ...(l >= 3 ? ([['target', 0.36, -0.42, 0.22, Math.PI]] as const) : []),
    ] as [string, number, number, number, number?][],
  },
  temple: {
    models: ['building_church_blue'],
    fill: 0.74,
    pad: PAD_STONE,
    props: (l) => (l >= 2 ? [['flag_blue', 0.44, 0.44, 0.06]] : []),
  },
  archerTower: {
    models: ['building_tower_A_blue', 'building_tower_B_blue', 'building_tower_catapult_blue'],
    fill: 0.92,
    pad: PAD_STONE,
  },
  siegeWorkshop: {
    // Un taller al fondo y una catapulta en el patio, que dispara al entrenar.
    models: ['building_blacksmith_blue'],
    fill: 0.46,
    offset: [-0.24, -0.24],
    pad: PAD_DIRT,
    props: (l) => [
      ['resource_lumber', 0.36, -0.36, 0.28, 1.2],
      ['crate_A_big', -0.4, 0.38, 0.16],
      ...(l >= 2 ? ([['weaponrack', 0.42, 0.12, 0.2, -1.57], ['flag_blue', -0.45, 0.1, 0.05]] as const) : []),
      ...(l >= 3 ? ([['resource_stone', -0.08, -0.42, 0.18], ['ladder', 0.44, 0.44, 0.08]] as const) : []),
    ] as [string, number, number, number, number?][],
    extra: (_assets, body, size) => {
      const cat = createCatapult();
      cat.root.scale.setScalar(size * 0.36);
      cat.root.position.set(size * 0.12, 0.08, size * 0.12);
      cat.root.rotation.y = -0.5;
      body.add(cat.root);
      let clock = 1 + Math.random() * 2;
      cat.root.userData.tick = (dt: number, active: boolean) => {
        cat.update(dt);
        clock -= dt;
        if (clock <= 0 && active) {
          cat.fire();
          clock = 3.5;
        }
      };
      return size * 0.3;
    },
  },
  infirmary: {
    // Tiendas de campaña, catres (uno por cama) y el estandarte de la cruz.
    models: ['tent'],
    fill: 0.5,
    offset: [-0.22, -0.22],
    pad: PAD_GRASS,
    props: (l) => [
      ['tent', 0.26, -0.3, 0.3, -0.4],
      ['bucket_water', -0.42, 0.1, 0.08],
      ...(l >= 2 ? ([['building_well_blue', 0.36, 0.08, 0.18]] as const) : []),
      ...(l >= 3 ? ([['crate_A_small', -0.44, -0.05, 0.08], ['sack', -0.44, -0.16, 0.08]] as const) : []),
    ] as [string, number, number, number, number?][],
    extra: (_assets, body, size, level) => {
      const beds = BUILDING_DEFS.infirmary.levels[level - 1]?.beds ?? 3;
      const shown = Math.min(beds, 8);
      for (let i = 0; i < shown; i++) {
        const cot = createCot(false);
        const row = Math.floor(i / 4);
        cot.scale.setScalar(size * 0.26);
        cot.position.set(size * (-0.32 + (i % 4) * 0.16), 0.08, size * (0.18 + row * 0.24));
        cot.name = `cot:${i}`;
        body.add(cot);
      }
      const banner = createBanner();
      banner.scale.setScalar(size * 0.36);
      banner.position.set(size * 0.44, 0.08, size * 0.44);
      body.add(banner);
      return size * 0.3;
    },
  },
};

/** Estructuras de los campamentos de monstruos (solo en batalla). */
export function createCampVisual(assets: ModelSource, type: string, size: number, destroyed: boolean, id: number): BuildingVisual {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  root.userData.buildingId = id;
  body.add(pad(size, '#7c6247'));
  let height = 0.8;
  if (destroyed) {
    const rubble = assets.model('building_destroyed');
    height = fit(rubble, size * 0.75);
    rubble.position.y += 0.08;
    body.add(rubble);
    const bones = createBones(id);
    bones.scale.setScalar(size * 0.9);
    bones.position.y = 0.08;
    body.add(bones);
    return makeVisual(root, body, Math.max(height, 0.6), []);
  }
  if (type === 'campTent') {
    const tent = assets.model('tent');
    height = fit(tent, size * 0.85);
    tent.position.y += 0.08;
    body.add(tent);
    const bones = createBones(id);
    bones.position.set(size * 0.32, 0.08, size * 0.34);
    bones.scale.setScalar(size * 0.5);
    body.add(bones);
  } else if (type === 'campChest') {
    const chest = createChest();
    chest.scale.setScalar(size * 1.05);
    chest.position.y = 0.08;
    chest.rotation.y = (id % 4) * 0.4 - 0.6;
    body.add(chest);
    height = 0.55;
  } else {
    const { root: totem, orb } = createTotem();
    totem.scale.setScalar(size * 1.05);
    totem.position.y = 0.08;
    body.add(totem);
    height = 1.55 * size;
    let t = Math.random() * 6;
    orb.userData.tick = (dt: number) => {
      t += dt;
      orb.position.y = 1.36 + Math.sin(t * 2.2) * 0.05;
      orb.scale.setScalar(1 + Math.sin(t * 5) * 0.08);
    };
  }
  return makeVisual(root, body, height, []);
}

/** Escala uniforme para que el modelo ocupe `width` en planta, centrado y apoyado en el suelo. */
function fit(obj: THREE.Object3D, width: number): number {
  const box = localBounds(obj);
  const size = box.getSize(new THREE.Vector3());
  const k = width / Math.max(size.x, size.z, 0.001);
  obj.position.set(-(box.min.x + size.x / 2) * k, -box.min.y * k, -(box.min.z + size.z / 2) * k);
  obj.scale.setScalar(k);
  return size.y * k;
}

// Geometrías y materiales compartidos: las vistas se reconstruyen al cambiar de
// fase o de nivel, así que no se crean recursos nuevos cada vez.
const cache = new Map<string, unknown>();
function cached<T>(key: string, make: () => T): T {
  let v = cache.get(key) as T | undefined;
  if (v === undefined) {
    v = make();
    cache.set(key, v);
  }
  return v;
}

const standard = (color: string, roughness = 0.95) =>
  cached(`mat:${color}:${roughness}`, () => new THREE.MeshStandardMaterial({ color, roughness }));

function pad(size: number, colorHex: string): THREE.Mesh {
  const geo = cached(`pad:${size}`, () => new RoundedBoxGeometry(size - 0.12, 0.14, size - 0.12, 2, 0.06));
  const m = new THREE.Mesh(geo, standard(colorHex));
  m.position.y = 0.02;
  m.receiveShadow = true;
  return m;
}

/** Libera los recursos propios de una vista (los buffers de instancias). */
export function disposeVisual(v: BuildingVisual): void {
  v.root.traverse((o) => {
    if (o instanceof THREE.InstancedMesh) o.dispose();
  });
}

interface Spinner {
  obj: THREE.Object3D;
  axis: 'x' | 'y' | 'z';
  speed: number;
  current: number;
  always: boolean;
}

function findSpinners(root: THREE.Object3D): Spinner[] {
  const out: Spinner[] = [];
  root.traverse((o) => {
    if (/fan/.test(o.name)) out.push({ obj: o, axis: 'z', speed: 1.4, current: 0, always: true });
    else if (/wheel/.test(o.name)) out.push({ obj: o, axis: 'x', speed: 1.2, current: 0, always: true });
    else if (/saw/.test(o.name)) out.push({ obj: o, axis: 'x', speed: 9, current: 0, always: false });
  });
  return out;
}

function findFlags(root: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (/^prop:flag_/.test(o.name)) out.push(o);
  });
  return out;
}

function makeVisual(root: THREE.Group, body: THREE.Group, height: number, smoke: THREE.Vector3[]): BuildingVisual {
  const spinners = findSpinners(body);
  const flags = findFlags(body);
  const fillers: { obj: THREE.Object3D; min: number; uniform: boolean; base: THREE.Vector3 }[] = [];
  body.traverse((o) => {
    const f = o.userData.fill as { min: number; uniform: boolean } | undefined;
    if (f) fillers.push({ obj: o, ...f, base: o.scale.clone() });
  });
  const ticks: ((dt: number, active: boolean) => void)[] = [];
  body.traverse((o) => {
    if (typeof o.userData.tick === 'function') ticks.push(o.userData.tick);
  });
  let fill = -1;
  const phase = Math.random() * 10;
  let t = 0;
  return {
    root,
    body,
    height,
    smoke,
    update(dt, active) {
      t += dt;
      for (const s of spinners) {
        const target = s.always || active ? s.speed : 0;
        s.current += (target - s.current) * Math.min(1, dt * 2);
        s.obj.rotation[s.axis] += s.current * dt;
      }
      flags.forEach((f, i) => {
        f.rotation.y = Math.sin(t * 2.6 + phase + i) * 0.25;
      });
      for (const tick of ticks) tick(dt, active);
    },
    setFill(fraction) {
      const f = Math.round(Math.min(1, Math.max(0, fraction)) * 50) / 50;
      if (f === fill) return;
      fill = f;
      for (const x of fillers) {
        const k = x.min + (1 - x.min) * f;
        x.obj.visible = f > 0.02 || x.min > 0.2;
        if (x.uniform) x.obj.scale.copy(x.base).multiplyScalar(k);
        else x.obj.scale.set(x.base.x, x.base.y * k, x.base.z);
      }
    },
  };
}

export function createBuildingVisual(assets: ModelSource, b: Building, wallMask = 0, constructionStage = 0): BuildingVisual {
  const size = BUILDING_DEFS[b.type].size;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  root.userData.buildingId = b.id;

  if (b.type === 'wall') {
    const h = buildWall(assets, body, Math.max(1, b.level), wallMask);
    return makeVisual(root, body, h, []);
  }

  if (b.level === 0) {
    const h = buildSite(assets, body, size, constructionStage);
    return makeVisual(root, body, h, []);
  }

  if (b.hp <= 0) {
    // Destruido: escombros hasta que lo reparen.
    body.add(pad(size, PAD_DIRT));
    const rubble = assets.model('building_destroyed');
    const h = fit(rubble, size * 0.85);
    rubble.position.y += 0.08;
    body.add(rubble);
    return makeVisual(root, body, Math.max(h, 0.8), []);
  }

  let height: number;
  const smoke: THREE.Vector3[] = [];
  if (b.type === 'farm') {
    height = buildFarm(assets, body, size, b.level);
  } else {
    const spec = SPECS[b.type];
    body.add(pad(size, spec.pad));
    const name = spec.models[Math.min(b.level, spec.models.length) - 1]!;
    const model = assets.model(name);
    height = fit(model, size * spec.fill);
    if (spec.offset) {
      model.position.x += spec.offset[0] * size;
      model.position.z += spec.offset[1] * size;
    }
    // El ayuntamiento crece un poco con cada nivel.
    if (b.type === 'townHall') {
      const k = 1 + (b.level - 1) * 0.06;
      model.scale.multiplyScalar(k);
      model.position.multiplyScalar(k);
      height *= k;
    }
    model.position.y += 0.08;
    body.add(model);
    for (const [prop, x, z, s, rot] of spec.props?.(b.level) ?? []) addProp(assets, body, prop, x * size, z * size, s * size, rot);
    if (spec.extra) height = Math.max(height, spec.extra(assets, body, size, b.level));
    if (spec.chimney) {
      const w = size * spec.fill;
      smoke.push(new THREE.Vector3(spec.chimney[0] * w, spec.chimney[1] * height, spec.chimney[2] * w));
    }
  }
  if (b.construction) addScaffoldAround(assets, body, size, height);
  return makeVisual(root, body, height, smoke);
}

function addProp(assets: ModelSource, parent: THREE.Object3D, name: string, x: number, z: number, width: number, rot = 0): void {
  if (!assets.has(name)) return;
  const obj = assets.model(name);
  const holder = new THREE.Group();
  fit(obj, width);
  holder.add(obj);
  holder.position.set(x, 0.08, z);
  holder.rotation.y = rot;
  holder.name = `prop:${name}`; // "prop:flag_*" ondea
  // Las pilas de material crecen con lo acumulado en el edificio.
  if (name === 'resource_lumber' || name === 'resource_stone') holder.userData.fill = { min: 0.15, uniform: true };
  parent.add(holder);
}

function addScaffoldAround(assets: ModelSource, parent: THREE.Object3D, size: number, height: number): void {
  const s = assets.model('building_scaffolding');
  const h = fit(s, size * 0.98);
  s.scale.y *= Math.max(0.6, (height * 0.75) / h);
  s.position.y += 0.05;
  parent.add(s);
}

/** Solar en obras: cimientos, fase de la construcción, andamio y material apilado. */
function buildSite(assets: ModelSource, body: THREE.Group, size: number, stage: number): number {
  body.add(pad(size, PAD_DIRT));
  const stageModel = assets.model(['building_stage_A', 'building_stage_B', 'building_stage_C'][stage] ?? 'building_stage_A');
  const h = fit(stageModel, size * 0.8);
  stageModel.position.y += 0.08;
  body.add(stageModel);
  if (size >= 2) {
    addProp(assets, body, 'resource_lumber', size * 0.36, size * 0.4, size * 0.3, 0.4);
    addProp(assets, body, 'resource_stone', -size * 0.38, size * 0.4, size * 0.22);
  }
  return Math.max(h, 1);
}

// ---------------------------------------------------------------------------
// Granja: tierra arada, trigo instanciado que se mece y un molino.
// ---------------------------------------------------------------------------

let wheatMaterial: THREE.MeshStandardNodeMaterial | null = null;
let wheatGeometry: THREE.BufferGeometry | null = null;

function wheat(): { geo: THREE.BufferGeometry; mat: THREE.Material } {
  if (!wheatGeometry) {
    const stalk = new THREE.CylinderGeometry(0.02, 0.03, 0.4, 4);
    stalk.translate(0, 0.2, 0);
    const head = new THREE.CylinderGeometry(0.06, 0.035, 0.2, 5);
    head.translate(0, 0.46, 0);
    const leaf = new THREE.ConeGeometry(0.07, 0.3, 3);
    leaf.translate(0, 0.15, 0);
    const paint = (g: THREE.BufferGeometry, c: string) => {
      const col = new THREE.Color(c);
      const arr = new Float32Array(g.attributes.position!.count * 3);
      for (let i = 0; i < arr.length; i += 3) arr.set([col.r, col.g, col.b], i);
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      return g;
    };
    wheatGeometry = mergeGeometries([paint(stalk, '#b9a043'), paint(head, '#f3d05c'), paint(leaf, '#9fb048')]);
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.8 });
    m.colorNode = vertexColor().rgb;
    const phase = hash(instanceIndex).mul(3.0);
    const sway = sin(time.mul(2.1).add(phase)).mul(0.14);
    m.positionNode = positionLocal.add(vec3(sway.mul(positionLocal.y), 0, sway.mul(positionLocal.y).mul(0.4)));
    wheatMaterial = m;
  }
  return { geo: wheatGeometry, mat: wheatMaterial! };
}

function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const attrs = ['position', 'normal', 'color'];
  for (const name of attrs) {
    const arrays = geos.map((g) => (g.index ? g.toNonIndexed() : g).attributes[name]!.array as Float32Array);
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const merged = new Float32Array(total);
    let o = 0;
    for (const a of arrays) {
      merged.set(a, o);
      o += a.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(merged, 3));
  }
  return out;
}

function buildFarm(assets: ModelSource, body: THREE.Group, size: number, level: number): number {
  const soil = new THREE.Mesh(
    cached(`soil:${size}`, () => new RoundedBoxGeometry(size - 0.12, 0.16, size - 0.12, 2, 0.06)),
    standard('#8a5d34', 1),
  );
  soil.position.y = 0.02;
  soil.receiveShadow = true;
  body.add(soil);
  // Surcos
  const furrowGeo = cached(`furrow:${size}`, () => new THREE.BoxGeometry(size * 0.62, 0.05, 0.1));
  for (let i = 0; i < 6; i++) {
    const f = new THREE.Mesh(furrowGeo, standard('#6e4526', 1));
    f.position.set(size * 0.12, 0.12, -size * 0.42 + i * (size * 0.84) / 5);
    f.receiveShadow = true;
    body.add(f);
  }
  const mill = assets.model('building_windmill_blue');
  const h = fit(mill, size * 0.42);
  mill.position.x += -size * 0.28;
  mill.position.z += -size * 0.26;
  mill.position.y += 0.08;
  body.add(mill);

  const { geo, mat } = wheat();
  const rows = 9 + level * 2;
  const perRow = 12 + level * 3;
  const field = new THREE.InstancedMesh(geo, mat, rows * perRow);
  const rand = seeded(level * 13 + 5);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < perRow; c++) {
      const x = -size * 0.1 + (c / (perRow - 1)) * size * 0.54 + (rand() - 0.5) * 0.08;
      const z = -size * 0.42 + (r / (rows - 1)) * size * 0.84 + (rand() - 0.5) * 0.08;
      if (x < -size * 0.02 && z < 0) continue; // hueco para el molino
      const s = 0.85 + rand() * 0.45;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6.28);
      m.compose(new THREE.Vector3(x, 0.1, z), q, new THREE.Vector3(s, s, s));
      field.setMatrixAt(n++, m);
    }
  }
  field.count = n;
  field.castShadow = true;
  field.userData.fill = { min: 0.3, uniform: false }; // el trigo crece según la cosecha acumulada
  body.add(field);
  addProp(assets, body, 'sack', -size * 0.36, size * 0.4, size * 0.14);
  return h;
}

// ---------------------------------------------------------------------------
// Muros: poste en cada celda y tramos hacia los muros vecinos.
// ---------------------------------------------------------------------------

const WALL_MODELS = ['fence_wood_straight', 'fence_stone_straight', 'wall_straight'];

function buildWall(assets: ModelSource, body: THREE.Group, level: number, mask: number): number {
  const name = WALL_MODELS[Math.min(level, WALL_MODELS.length) - 1]!;
  const heightK = level === 3 ? 1.0 : 0.75;
  const segment = (length: number, thick: number, height: number, x: number, z: number, alongX: boolean) => {
    const obj = assets.model(name);
    const box = localBounds(obj);
    const size = box.getSize(new THREE.Vector3());
    const longX = size.x >= size.z;
    const sl = length / (longX ? size.x : size.z);
    const st = thick / (longX ? size.z : size.x);
    const holder = new THREE.Group();
    obj.scale.set(longX ? sl : st, height / size.y, longX ? st : sl);
    obj.position.set(
      -(box.min.x + size.x / 2) * obj.scale.x,
      -box.min.y * obj.scale.y,
      -(box.min.z + size.z / 2) * obj.scale.z,
    );
    holder.add(obj);
    holder.position.set(x, 0, z);
    if (alongX !== longX) holder.rotation.y = Math.PI / 2;
    body.add(holder);
  };
  const h = heightK;
  // Poste central, algo más alto y grueso.
  segment(0.5, 0.5, h * 1.15, 0, 0, true);
  if (mask & 1) segment(0.55, 0.36, h, 0.27, 0, true);
  if (mask & 2) segment(0.55, 0.36, h, -0.27, 0, true);
  if (mask & 4) segment(0.55, 0.36, h, 0, 0.27, false);
  if (mask & 8) segment(0.55, 0.36, h, 0, -0.27, false);
  return h * 1.15;
}

// ---------------------------------------------------------------------------
// Fantasma de colocación, marco de selección y alcance de defensas.
// ---------------------------------------------------------------------------

const ghostOk = new THREE.MeshStandardMaterial({ color: '#5fe07a', transparent: true, opacity: 0.5, depthWrite: false, emissive: new THREE.Color('#1f7a33') });
const ghostBad = new THREE.MeshStandardMaterial({ color: '#ff4a3d', transparent: true, opacity: 0.5, depthWrite: false, emissive: new THREE.Color('#7a1f1a') });

export function createGhost(assets: ModelSource, type: BuildingType): THREE.Group {
  const fake: Building = { id: -1, type, x: 0, y: 0, level: 1, construction: null, hp: 1, stored: 0, recruits: [], healing: null };
  const g = createBuildingVisual(assets, fake).root;
  const size = BUILDING_DEFS[type].size;
  const base = new THREE.Mesh(cached(`ghost:${size}`, () => new THREE.BoxGeometry(size, 0.04, size)), ghostOk);
  base.position.y = 0.03;
  g.add(base);
  setGhostValid(g, true);
  return g;
}

export function setGhostValid(g: THREE.Group, valid: boolean): void {
  const m = valid ? ghostOk : ghostBad;
  g.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) {
      o.material = m;
      o.castShadow = false;
    }
  });
}

const selectionMat = new THREE.MeshBasicMaterial({ color: '#ffe066', transparent: true, opacity: 0.95 });

export function createSelectionFrame(size: number): THREE.Group {
  const g = new THREE.Group();
  const t = 0.1;
  const h = size / 2 + 0.08;
  for (const [w, d, x, z] of [
    [size + 0.26, t, 0, -h],
    [size + 0.26, t, 0, h],
    [t, size + 0.26, -h, 0],
    [t, size + 0.26, h, 0],
  ] as const) {
    const mesh = new THREE.Mesh(cached(`sel:${w}:${d}`, () => new THREE.BoxGeometry(w, 0.05, d)), selectionMat);
    mesh.position.set(x, 0.05, z);
    g.add(mesh);
  }
  return g;
}

const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false });
const ringFillMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.08, depthWrite: false });

export function createRangeRing(radius: number): THREE.Mesh {
  const ring = new THREE.Mesh(cached(`ring:${radius}`, () => new THREE.RingGeometry(radius - 0.08, radius, 96)), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  const fill = new THREE.Mesh(cached(`disc:${radius}`, () => new THREE.CircleGeometry(radius, 96)), ringFillMat);
  fill.position.z = -0.001;
  ring.add(fill);
  return ring;
}
