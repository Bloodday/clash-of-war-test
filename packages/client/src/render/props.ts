import * as THREE from 'three/webgpu';

// Modelos procedurales que no vienen en los packs: catapulta con brazo animado,
// cofre, tótem de huesos, hoguera, catres y estandarte de la enfermería.
// Geometrías y materiales se comparten entre todas las copias.

const cache = new Map<string, unknown>();
function cached<T>(key: string, make: () => T): T {
  let v = cache.get(key) as T | undefined;
  if (v === undefined) {
    v = make();
    cache.set(key, v);
  }
  return v;
}

const mat = (color: string, roughness = 0.85, emissive?: string, intensity = 1) =>
  cached(`m:${color}:${roughness}:${emissive}:${intensity}`, () => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
    if (emissive) {
      m.emissive = new THREE.Color(emissive);
      m.emissiveIntensity = intensity;
    }
    return m;
  });

const WOOD = '#9a6a3c';
const WOOD_DARK = '#6e4724';
const IRON = '#5b5f66';
const BONE = '#ede4cc';
const GOLD = '#f2c243';

function box(w: number, h: number, d: number, color: string, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(
    cached(`box:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d)),
    mat(color),
  );
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cyl(rTop: number, rBottom: number, h: number, color: string, seg = 8): THREE.Mesh {
  const m = new THREE.Mesh(
    cached(`cyl:${rTop}:${rBottom}:${h}:${seg}`, () => new THREE.CylinderGeometry(rTop, rBottom, h, seg)),
    mat(color),
  );
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function sphere(r: number, color: string, detail = 1, emissive?: string, intensity = 1): THREE.Mesh {
  const m = new THREE.Mesh(
    cached(`ico:${r}:${detail}`, () => new THREE.IcosahedronGeometry(r, detail)),
    mat(color, 0.9, emissive, intensity),
  );
  m.castShadow = true;
  return m;
}

// ---------------------------------------------------------------------------
// Catapulta
// ---------------------------------------------------------------------------

export interface Catapult {
  root: THREE.Group;
  /** Lanza: el brazo se dispara y vuelve a cargarse despacio. */
  fire(): void;
  update(dt: number): void;
  /** Hace girar las ruedas según lo que avance. */
  roll(distance: number): void;
}

const ARM_REST = -0.38;
const ARM_FIRED = 1.35;

/** Catapulta de unos 1.1 × 0.8 (unidades de celda) que mira hacia +z. */
export function createCatapult(): Catapult {
  const root = new THREE.Group();
  root.name = 'catapult';
  // Chasis
  for (const x of [-0.24, 0.24]) root.add(box(0.08, 0.08, 1.05, WOOD, x, 0.2, 0));
  for (const z of [-0.42, 0.0, 0.4]) root.add(box(0.56, 0.07, 0.08, WOOD_DARK, 0, 0.2, z));
  // Ruedas
  const wheels: THREE.Object3D[] = [];
  for (const x of [-0.31, 0.31])
    for (const z of [-0.34, 0.34]) {
      const w = new THREE.Group();
      const disc = cyl(0.17, 0.17, 0.06, WOOD_DARK, 10);
      disc.rotation.z = Math.PI / 2;
      const rim = cyl(0.18, 0.18, 0.04, IRON, 10);
      rim.rotation.z = Math.PI / 2;
      rim.scale.set(1, 0.6, 1);
      const hub = box(0.08, 0.06, 0.06, IRON);
      w.add(disc, rim, hub);
      w.position.set(x, 0.17, z);
      root.add(w);
      wheels.push(w);
    }
  // Montantes en A y eje
  for (const x of [-0.2, 0.2]) {
    const a = box(0.06, 0.5, 0.06, WOOD, x, 0.43, 0.08);
    a.rotation.x = 0.35;
    const b = box(0.06, 0.5, 0.06, WOOD, x, 0.43, -0.08);
    b.rotation.x = -0.35;
    root.add(a, b);
  }
  const axle = cyl(0.03, 0.03, 0.5, IRON);
  axle.rotation.z = Math.PI / 2;
  axle.position.set(0, 0.64, 0);
  root.add(axle);
  // Tope delantero donde golpea el brazo
  root.add(box(0.46, 0.08, 0.08, WOOD_DARK, 0, 0.72, 0.28));
  for (const x of [-0.2, 0.2]) root.add(box(0.05, 0.55, 0.05, WOOD, x, 0.47, 0.28));

  // Brazo: pivota en el eje; la cuchara queda atrás (−z) en reposo.
  const arm = new THREE.Group();
  arm.position.set(0, 0.64, 0);
  const beam = box(0.07, 0.07, 0.86, WOOD);
  beam.position.z = -0.25;
  const cup = cyl(0.11, 0.07, 0.07, WOOD_DARK, 8);
  cup.position.set(0, 0.05, -0.66);
  const stone = sphere(0.085, '#8d8a82', 0);
  stone.position.set(0, 0.12, -0.66);
  const weight = box(0.2, 0.18, 0.16, IRON);
  weight.position.set(0, -0.08, 0.2);
  arm.add(beam, cup, stone, weight);
  arm.rotation.x = ARM_REST;
  root.add(arm);

  let t = -1;
  return {
    root,
    fire() {
      t = 0;
    },
    update(dt) {
      if (t < 0) return;
      t += dt;
      // Golpe rápido, pausa arriba y recarga lenta.
      if (t < 0.14) arm.rotation.x = ARM_REST + (ARM_FIRED - ARM_REST) * (t / 0.14) ** 2;
      else if (t < 0.4) arm.rotation.x = ARM_FIRED - Math.sin(((t - 0.14) / 0.26) * Math.PI) * 0.06;
      else if (t < 1.9) arm.rotation.x = ARM_FIRED + (ARM_REST - ARM_FIRED) * easeInOut((t - 0.4) / 1.5);
      else {
        arm.rotation.x = ARM_REST;
        t = -1;
      }
      stone.visible = t < 0 || t > 1.5;
    },
    roll(distance) {
      for (const w of wheels) w.rotation.x += distance / 0.17;
    },
  };
}

const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

/** Piedra de catapulta en vuelo. */
export function createBoulder(): THREE.Mesh {
  const m = sphere(0.16, '#8d8a82', 0);
  m.castShadow = true;
  return m;
}

// ---------------------------------------------------------------------------
// Campamento de monstruos
// ---------------------------------------------------------------------------

/** Cofre abierto con monedas; ancho ~0.6. */
export function createChest(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.6, 0.3, 0.4, WOOD, 0, 0.15, 0));
  for (const x of [-0.22, 0.22]) g.add(box(0.05, 0.31, 0.41, GOLD, x, 0.155, 0));
  const coins = box(0.52, 0.04, 0.32, GOLD, 0, 0.3, 0);
  coins.material = mat(GOLD, 0.35, '#b07a10', 0.35);
  g.add(coins);
  for (let i = 0; i < 5; i++) {
    const c = cyl(0.045, 0.045, 0.015, GOLD, 10);
    c.material = mat(GOLD, 0.35, '#b07a10', 0.35);
    c.position.set(-0.18 + i * 0.09, 0.33 + (i % 2) * 0.02, (i % 3) * 0.05 - 0.05);
    c.rotation.set(0.3 * i, 0, 0.4);
    g.add(c);
  }
  // Tapa abierta hacia atrás
  const lid = new THREE.Group();
  lid.position.set(0, 0.3, -0.2);
  const half = new THREE.Mesh(
    cached('lid', () => new THREE.CylinderGeometry(0.2, 0.2, 0.6, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2)),
    mat(WOOD_DARK),
  );
  half.castShadow = true;
  half.position.z = -0.2;
  half.rotation.x = Math.PI / 2;
  lid.add(half);
  lid.rotation.x = -1.2;
  g.add(lid);
  return g;
}

/** Tótem de huesos con un orbe que brilla (ataca a distancia). Alto ~1.5. */
export function createTotem(): { root: THREE.Group; orb: THREE.Mesh } {
  const g = new THREE.Group();
  const pole = cyl(0.07, 0.1, 1.2, WOOD_DARK, 6);
  pole.position.y = 0.6;
  g.add(pole);
  const skull = (y: number, s: number, rot: number) => {
    const head = sphere(0.16 * s, BONE, 1);
    head.scale.set(1, 0.9, 1.05);
    head.position.set(0, y, 0);
    const jaw = box(0.2 * s, 0.07 * s, 0.14 * s, BONE, 0, y - 0.14 * s, 0.05 * s);
    const eyes = new THREE.Group();
    for (const x of [-0.06, 0.06]) {
      const e = sphere(0.035 * s, '#1a0d24', 0, '#c65bff', 3);
      e.position.set(x * s, y + 0.01, 0.14 * s);
      eyes.add(e);
    }
    const hold = new THREE.Group();
    hold.add(head, jaw, eyes);
    hold.rotation.y = rot;
    g.add(hold);
  };
  skull(0.55, 1, 0.4);
  skull(0.9, 1.15, -0.3);
  // Cuernos
  for (const x of [-1, 1]) {
    const horn = cyl(0.0, 0.05, 0.3, BONE, 6);
    horn.position.set(x * 0.2, 1.1, 0);
    horn.rotation.z = -x * 0.9;
    g.add(horn);
  }
  const orb = sphere(0.12, '#d9a6ff', 2, '#b24dff', 4);
  orb.position.y = 1.36;
  g.add(orb);
  // Travesaño con huesos colgando
  const bar = box(0.6, 0.05, 0.05, WOOD_DARK, 0, 0.3, 0);
  g.add(bar);
  for (const x of [-0.26, 0.26]) {
    const bone = cyl(0.02, 0.02, 0.22, BONE, 5);
    bone.position.set(x, 0.18, 0);
    g.add(bone);
  }
  return { root: g, orb };
}

/** Hoguera: anillo de piedras, troncos cruzados y brasas (el fuego lo ponen las partículas). */
export function createCampfire(): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const s = sphere(0.09, '#7d7a74', 0);
    s.position.set(Math.cos(a) * 0.36, 0.05, Math.sin(a) * 0.36);
    s.scale.set(1.2, 0.8, 1);
    g.add(s);
  }
  for (let i = 0; i < 4; i++) {
    const log = cyl(0.045, 0.05, 0.6, WOOD_DARK, 6);
    log.rotation.set(1.2, (i / 4) * Math.PI * 2, 0);
    log.position.y = 0.14;
    g.add(log);
  }
  const embers = sphere(0.17, '#ff7a2a', 1, '#ff5a10', 3);
  embers.scale.set(1, 0.4, 1);
  embers.position.y = 0.06;
  g.add(embers);
  return g;
}

/** Montón de huesos para decorar el campamento. */
export function createBones(seed: number): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const r = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
    const f = r - Math.floor(r);
    const bone = cyl(0.025, 0.025, 0.28, BONE, 5);
    bone.rotation.set(Math.PI / 2, f * 6, 0);
    bone.position.set((f - 0.5) * 0.4, 0.03, (((f * 7) % 1) - 0.5) * 0.4);
    g.add(bone);
  }
  const skull = sphere(0.09, BONE, 1);
  skull.position.set(0.05, 0.08, 0.02);
  g.add(skull);
  return g;
}

// ---------------------------------------------------------------------------
// Enfermería
// ---------------------------------------------------------------------------

/** Catre con manta; `occupied` añade un bulto (un herido tumbado). Largo ~0.6. */
export function createCot(occupied = false): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.3, 0.05, 0.6, WOOD, 0, 0.14, 0));
  for (const x of [-0.13, 0.13]) for (const z of [-0.27, 0.27]) g.add(box(0.035, 0.14, 0.035, WOOD_DARK, x, 0.07, z));
  g.add(box(0.27, 0.04, 0.55, '#f1ede2', 0, 0.185, 0));
  g.add(box(0.22, 0.05, 0.12, '#ffffff', 0, 0.22, -0.2));
  const blanket = box(0.28, 0.03, 0.34, '#c9453d', 0, 0.215, 0.1);
  g.add(blanket);
  if (occupied) {
    const body = box(0.18, 0.08, 0.3, '#c9453d', 0, 0.25, 0.08);
    const head = sphere(0.07, '#e8b98a', 1);
    head.position.set(0, 0.27, -0.19);
    g.add(body, head);
  }
  return g;
}

/** Estandarte blanco con una cruz roja. Alto ~1.3. */
export function createBanner(): THREE.Group {
  const g = new THREE.Group();
  const pole = cyl(0.025, 0.03, 1.3, WOOD_DARK, 6);
  pole.position.y = 0.65;
  g.add(pole);
  const flag = new THREE.Group();
  flag.name = 'prop:flag_banner'; // ondea como las banderas
  flag.position.set(0, 1.08, 0);
  const cloth = box(0.02, 0.4, 0.4, '#f4f1e8', 0, 0, 0.21);
  const v = box(0.03, 0.26, 0.08, '#d63a33', 0, 0, 0.21);
  const h = box(0.03, 0.08, 0.26, '#d63a33', 0, 0, 0.21);
  flag.add(cloth, v, h);
  g.add(flag);
  return g;
}
