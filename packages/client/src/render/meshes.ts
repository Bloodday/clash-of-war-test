import * as THREE from 'three/webgpu';
import { BUILDING_DEFS, type BuildingType } from '@cow/shared';

// Modelos low-poly generados por código. Son provisionales: cuando haya arte
// definitivo se sustituirán por glTF manteniendo la misma interfaz.

const materials = new Map<string, THREE.MeshStandardMaterial>();

export function mat(color: string, opts: { emissive?: string; roughness?: number } = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${opts.emissive ?? ''}|${opts.roughness ?? ''}`;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: opts.roughness ?? 0.85, metalness: 0 });
    if (opts.emissive) {
      m.emissive = new THREE.Color(opts.emissive);
      m.emissiveIntensity = 0.35;
    }
    materials.set(key, m);
  }
  return m;
}

type V3 = [number, number, number];

function add(group: THREE.Group, geo: THREE.BufferGeometry, color: string, pos: V3, rot: V3 = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geo, mat(color));
  mesh.position.set(...pos);
  mesh.rotation.set(...rot);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

const box = (g: THREE.Group, w: number, h: number, d: number, color: string, x: number, y: number, z: number, rot?: V3) =>
  add(g, new THREE.BoxGeometry(w, h, d), color, [x, y + h / 2, z], rot);

const cyl = (g: THREE.Group, rt: number, rb: number, h: number, color: string, x: number, y: number, z: number, seg = 10) =>
  add(g, new THREE.CylinderGeometry(rt, rb, h, seg), color, [x, y + h / 2, z]);

/** Tejado piramidal de 4 caras alineado con los ejes. */
const pyramid = (g: THREE.Group, w: number, h: number, color: string, x: number, y: number, z: number) =>
  add(g, new THREE.ConeGeometry(w * Math.SQRT1_2, h, 4), color, [x, y + h / 2, z], [0, Math.PI / 4, 0]);

/** Tejado a dos aguas (prisma triangular) a lo largo del eje X. */
function gable(g: THREE.Group, w: number, h: number, d: number, color: string, x: number, y: number, z: number) {
  const shape = new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(0, h)]);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  geo.rotateY(Math.PI / 2);
  geo.translate(-w / 2, 0, 0);
  return add(g, geo, color, [x, y, z]);
}

function flag(g: THREE.Group, x: number, y: number, z: number, color: string, height = 1.2) {
  cyl(g, 0.03, 0.03, height, '#5b4630', x, y, z, 6);
  box(g, 0.5, 0.3, 0.03, color, x + 0.26, y + height - 0.35, z);
}

const builders: Record<BuildingType, (g: THREE.Group, level: number) => void> = {
  townHall(g, level) {
    box(g, 3.5, 1.4, 3.5, '#bfae94', 0, 0, 0);
    box(g, 2.7, 1.2, 2.7, '#efe3c8', 0, 1.4, 0);
    pyramid(g, 3.3, 1.5, level >= 3 ? '#2f4b7c' : '#3f6fa8', 0, 2.6, 0);
    box(g, 0.8, 1.0, 0.1, '#5b3a1e', 0, 0, 1.76);
    for (const [x, z] of [[-1.55, -1.55], [1.55, -1.55], [-1.55, 1.55], [1.55, 1.55]] as const) {
      cyl(g, 0.32, 0.36, 2.2, '#a89880', x, 0, z, 8);
      add(g, new THREE.ConeGeometry(0.42, 0.6, 8), '#3f6fa8', [x, 2.5, z]);
    }
    flag(g, 0, 4.1, 0, '#c0392b');
  },
  house(g) {
    box(g, 1.5, 0.9, 1.3, '#e8d5a6', 0, 0, 0);
    pyramid(g, 1.9, 0.9, '#a0522d', 0, 0.9, 0);
    box(g, 0.2, 0.5, 0.2, '#7f6e5d', 0.4, 1.2, -0.2);
    box(g, 0.35, 0.55, 0.05, '#5b3a1e', 0, 0, 0.66);
  },
  farm(g) {
    box(g, 2.8, 0.08, 2.8, '#7a5230', 0, 0, 0);
    for (let i = 0; i < 5; i++) box(g, 2.4, 0.25, 0.22, '#7fb03a', 0.1, 0.08, -1.0 + i * 0.5);
    box(g, 0.7, 0.6, 0.6, '#b5651d', -1.0, 0.08, 1.05);
    pyramid(g, 0.95, 0.4, '#8b3a1e', -1.0, 0.68, 1.05);
    add(g, new THREE.CylinderGeometry(0.2, 0.2, 0.35, 10), '#e3c16f', [1.1, 0.26, 1.15], [Math.PI / 2, 0, 0]);
  },
  lumberCamp(g) {
    box(g, 1.3, 0.8, 1.1, '#8b5a2b', -0.6, 0, -0.6);
    pyramid(g, 1.6, 0.7, '#5d7a3a', -0.6, 0.8, -0.6);
    for (let i = 0; i < 3; i++)
      add(g, new THREE.CylinderGeometry(0.16, 0.16, 1.6, 8), '#9c6b3c', [0.55, 0.16 + i * 0.3, 0.7 + (i % 2) * 0.1], [0, 0, Math.PI / 2]);
    add(g, new THREE.CylinderGeometry(0.16, 0.16, 1.6, 8), '#9c6b3c', [0.55, 0.16, 1.05], [0, 0, Math.PI / 2]);
    cyl(g, 0.28, 0.3, 0.35, '#a47449', 0.8, 0, -0.7);
  },
  goldMine(g) {
    const rock = add(g, new THREE.DodecahedronGeometry(1.25, 0), '#8a8680', [0, 0.55, -0.2]);
    rock.scale.set(1.1, 0.75, 1);
    box(g, 0.8, 0.8, 0.2, '#2b2118', 0, 0, 0.9);
    box(g, 1.0, 0.12, 0.3, '#6b4a2b', 0, 0.8, 0.9);
    for (const [x, y, z] of [[-0.8, 0.9, 0.2], [0.6, 1.0, 0.1], [0.2, 1.25, -0.6], [0.9, 0.35, 0.8]] as const) {
      const n = add(g, new THREE.IcosahedronGeometry(0.16, 0), '#f2c230', [x, y, z]);
      n.material = mat('#f2c230', { emissive: '#8a6a00', roughness: 0.4 });
    }
    box(g, 0.5, 0.3, 0.35, '#6b4a2b', 0.9, 0, 1.1);
  },
  storehouse(g) {
    box(g, 2.5, 1.2, 2.0, '#a26b3a', 0, 0, 0);
    gable(g, 2.7, 0.9, 2.3, '#7c3f1d', 0, 1.2, 0);
    box(g, 0.8, 0.9, 0.06, '#5b3a1e', 0, 0, 1.02);
    for (const [x, z] of [[-1.2, 1.25], [-0.75, 1.3], [1.2, 1.25]] as const) box(g, 0.4, 0.4, 0.4, '#c49a5a', x, 0, z);
  },
  barracks(g) {
    box(g, 2.6, 1.2, 2.2, '#9d9a92', 0, 0, 0);
    pyramid(g, 3.0, 1.0, '#9e2a2b', 0, 1.2, 0);
    box(g, 0.7, 0.8, 0.06, '#3b2a1e', 0, 0, 1.12);
    flag(g, 1.25, 0, 1.3, '#9e2a2b', 1.8);
    flag(g, -1.25, 0, 1.3, '#9e2a2b', 1.8);
  },
  archeryRange(g) {
    box(g, 2.8, 0.05, 2.8, '#b89b6a', 0, 0, 0);
    for (const x of [-0.9, 0, 0.9]) {
      const t = add(g, new THREE.CylinderGeometry(0.35, 0.35, 0.08, 16), '#f4f1e8', [x, 0.75, -1.0], [Math.PI / 2, 0, 0]);
      t.castShadow = true;
      add(g, new THREE.CylinderGeometry(0.18, 0.18, 0.09, 16), '#c0392b', [x, 0.75, -0.99], [Math.PI / 2, 0, 0]);
      box(g, 0.06, 0.5, 0.06, '#5b4630', x, 0, -1.05);
    }
    box(g, 1.4, 0.7, 0.8, '#6f8f3a', 0, 0, 0.9);
    pyramid(g, 1.6, 0.5, '#4d6a26', 0, 0.7, 0.9);
  },
  temple(g) {
    box(g, 2.8, 0.3, 2.8, '#e9e4d8', 0, 0, 0);
    box(g, 2.4, 0.2, 2.4, '#f4f0e6', 0, 0.3, 0);
    for (const x of [-0.95, 0, 0.95]) for (const z of [-0.95, 0.95]) cyl(g, 0.15, 0.17, 1.4, '#f7f4ec', x, 0.5, z, 10);
    box(g, 2.4, 0.2, 2.4, '#f4f0e6', 0, 1.9, 0);
    pyramid(g, 2.8, 0.7, '#d4a93a', 0, 2.1, 0);
  },
  wall(g, level) {
    const color = ['#9a9a9a', '#7e8a96', '#5f6670'][level - 1] ?? '#9a9a9a';
    box(g, 0.96, 0.9, 0.96, color, 0, 0, 0);
    box(g, 0.3, 0.2, 0.3, color, -0.3, 0.9, -0.3);
    box(g, 0.3, 0.2, 0.3, color, 0.3, 0.9, 0.3);
  },
  archerTower(g) {
    cyl(g, 0.6, 0.75, 2.6, '#9b8e7a', 0, 0, 0, 8);
    cyl(g, 0.9, 0.9, 0.25, '#7a5a3a', 0, 2.6, 0, 8);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      box(g, 0.2, 0.3, 0.2, '#9b8e7a', Math.cos(a) * 0.78, 2.85, Math.sin(a) * 0.78);
    }
    add(g, new THREE.ConeGeometry(0.95, 0.9, 8), '#3f6fa8', [0, 3.7, 0]);
    for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2])
      box(g, 0.06, 0.9, 0.06, '#5b4630', Math.cos(a) * 0.75, 2.85, Math.sin(a) * 0.75);
  },
};

/** Modelo de un edificio terminado (el pivote está en el centro de la huella, a ras de suelo). */
export function createBuildingModel(type: BuildingType, level: number): THREE.Group {
  const g = new THREE.Group();
  builders[type](g, Math.max(1, level));
  if (type !== 'wall') g.scale.y = 1 + 0.08 * (Math.max(1, level) - 1);
  return g;
}

/** Andamio + cimientos para un edificio nuevo en construcción. */
export function createConstructionSite(type: BuildingType): { group: THREE.Group; progress: THREE.Mesh } {
  const size = BUILDING_DEFS[type].size;
  const g = new THREE.Group();
  const s = size - 0.2;
  box(g, s, 0.12, s, '#8a6a45', 0, 0, 0);
  const progress = add(g, new THREE.BoxGeometry(s * 0.8, 1, s * 0.8), '#cdbb9a', [0, 0.12, 0]);
  progress.geometry.translate(0, 0.5, 0);
  progress.scale.y = 0.01;
  addScaffold(g, size, 1.6);
  return { group: g, progress };
}

export function addScaffold(g: THREE.Group, size: number, height: number): void {
  const h = size / 2 - 0.05;
  for (const [x, z] of [[-h, -h], [h, -h], [-h, h], [h, h]] as const) box(g, 0.08, height, 0.08, '#c8a26a', x, 0, z);
  for (const y of [height * 0.5, height]) {
    box(g, size - 0.1, 0.06, 0.06, '#c8a26a', 0, y, -h);
    box(g, size - 0.1, 0.06, 0.06, '#c8a26a', 0, y, h);
    box(g, 0.06, 0.06, size - 0.1, '#c8a26a', -h, y, 0);
    box(g, 0.06, 0.06, size - 0.1, '#c8a26a', h, y, 0);
  }
}

const ghostOk = new THREE.MeshStandardMaterial({ color: '#4cd964', transparent: true, opacity: 0.55, depthWrite: false });
const ghostBad = new THREE.MeshStandardMaterial({ color: '#ff3b30', transparent: true, opacity: 0.55, depthWrite: false });

/** Fantasma translúcido usado al colocar o mover edificios. */
export function createGhost(type: BuildingType): THREE.Group {
  const g = createBuildingModel(type, 1);
  const size = BUILDING_DEFS[type].size;
  const pad = new THREE.Mesh(new THREE.BoxGeometry(size, 0.05, size), ghostOk);
  pad.position.y = 0.03;
  g.add(pad);
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.material = ghostOk;
      o.castShadow = false;
    }
  });
  return g;
}

export function setGhostValid(g: THREE.Group, valid: boolean): void {
  const m = valid ? ghostOk : ghostBad;
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.material = m;
  });
}

/** Marco amarillo alrededor del edificio seleccionado. */
export function createSelectionFrame(size: number): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.MeshBasicMaterial({ color: '#ffd84a' });
  const t = 0.08;
  const h = size / 2 + 0.05;
  for (const [w, d, x, z] of [
    [size + 0.2, t, 0, -h],
    [size + 0.2, t, 0, h],
    [t, size + 0.2, -h, 0],
    [t, size + 0.2, h, 0],
  ] as const) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, d), m);
    mesh.position.set(x, 0.03, z);
    g.add(mesh);
  }
  return g;
}
