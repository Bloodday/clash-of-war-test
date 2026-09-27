import * as THREE from 'three/webgpu';
import {
  abs,
  color,
  float,
  floor,
  fract,
  hash,
  instanceIndex,
  max,
  min,
  mix,
  mod,
  mx_noise_float,
  normalWorld,
  oneMinus,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  step,
  texture,
  time,
  transformNormalToView,
  uniform,
  vec2,
  vec3,
  vertexColor,
} from 'three/tsl';
import { GRID_SIZE } from '@cow/shared';
import type { Assets } from './assets';
import { InstancedModel } from './instancing';
import { fbm, seeded, smoothstep as ss } from './noise';

// Todo lo que rodea a la aldea: terreno, lago, bosque, montañas, nubes, cielo y luz.

const HALF = GRID_SIZE / 2;
const LAKE = { x: -46, z: -30, r: 17 };
export const WATER_Y = -0.45;
const TERRAIN_SIZE = 260;
const TERRAIN_SEGMENTS = 180;

export function lakeMask(x: number, z: number): number {
  const d = Math.hypot(x - LAKE.x, z - LAKE.z) + (fbm(x * 0.07, z * 0.07, 3, 5) - 0.5) * 9;
  return 1 - ss(LAKE.r * 0.5, LAKE.r, d);
}

export function terrainHeight(x: number, z: number): number {
  const d = Math.max(Math.abs(x), Math.abs(z));
  const r = Math.hypot(x, z);
  const m = ss(HALF + 4, HALF + 20, d);
  let h = Math.max(-0.05, (fbm(x * 0.03, z * 0.03, 4, 3) - 0.38) * 8 * m);
  h += ss(55, 120, r) * 16 * (0.5 + fbm(x * 0.02, z * 0.02, 3, 9));
  const lk = lakeMask(x, z);
  return h * (1 - lk) - 2.4 * lk;
}

export class Environment {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  private gridOpacity = uniform(0);
  private gridTarget = 0;
  private clouds: { obj: THREE.Object3D; speed: number }[] = [];

  constructor(
    private scene: THREE.Scene,
    assets: Assets,
  ) {
    this.sky();
    this.sun = this.lights();
    this.group.add(this.terrain(), this.water());
    this.forest(assets);
    this.grass();
    this.addClouds(assets);
    scene.add(this.group);
  }

  setGridVisible(v: boolean): void {
    this.gridTarget = v ? 1 : 0;
  }

  update(dt: number, target: THREE.Vector3): void {
    this.gridOpacity.value += (this.gridTarget - this.gridOpacity.value) * Math.min(1, dt * 10);
    // La sombra sigue a la cámara para aprovechar la resolución del shadow map.
    this.sun.position.set(target.x - 22, 40, target.z + 16);
    this.sun.target.position.copy(target);
    for (const c of this.clouds) {
      c.obj.position.x += c.speed * dt;
      if (c.obj.position.x > 110) c.obj.position.x = -110;
    }
  }

  // ---------------------------------------------------------------------------

  private sky(): void {
    const horizon = color('#e4f2fb');
    const zenith = color('#4f9fe0');
    this.scene.backgroundNode = mix(horizon, zenith, smoothstep(-0.02, 0.55, normalWorld.y));
    this.scene.fog = new THREE.Fog('#dcecf6', 120, 260);
  }

  private lights(): THREE.DirectionalLight {
    this.scene.add(new THREE.HemisphereLight('#d6ecff', '#5d7d3f', 0.95));
    const sun = new THREE.DirectionalLight('#fff0d4', 2.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -28;
    sc.right = sc.top = 28;
    sc.near = 1;
    sc.far = 120;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 3;
    this.scene.add(sun, sun.target);
    return sun;
  }

  private terrain(): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position!;
    for (let i = 0; i < pos.count; i++) pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
    geo.computeVertexNormals();
    const normals = geo.attributes.normal!;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const grassA = new THREE.Color('#5a9a34');
    const grassB = new THREE.Color('#78b344');
    const hill = new THREE.Color('#4a8530');
    const sand = new THREE.Color('#e0cd92');
    const wet = new THREE.Color('#a99a68');
    const rock = new THREE.Color('#8b8a77');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      c.copy(grassA).lerp(grassB, fbm(x * 0.08, z * 0.08, 3, 11));
      c.lerp(hill, ss(1.5, 9, y) * 0.8);
      c.lerp(rock, ss(0.85, 0.65, normals.getY(i)) * 0.9);
      c.lerp(sand, ss(-0.05, -0.35, y));
      c.lerp(wet, ss(-0.7, -1.2, y));
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
    const p = positionWorld.xz;
    const inPlot = step(abs(p.x), float(HALF)).mul(step(abs(p.y), float(HALF)));
    // Césped "cortado" en damero, como los jardines bien cuidados.
    const cell = floor(p.add(HALF));
    const checker = mod(cell.x.add(cell.y), 2);
    const mow = mix(float(1), mix(float(0.955), float(1.04), checker), inPlot);
    const variation = mx_noise_float(vec3(p.mul(0.45), 0)).mul(0.07).add(1);
    // Camino de tierra alrededor de la parcela.
    const d = max(abs(p.x), abs(p.y));
    const pathMask = smoothstep(HALF + 0.2, HALF + 0.45, d).mul(oneMinus(smoothstep(HALF + 1.5, HALF + 1.8, d)));
    const pebbles = mx_noise_float(vec3(p.mul(4), 3)).mul(0.18).add(0.93);
    const pathColor = color('#c9a66b').mul(pebbles);
    // Cuadrícula de colocación (aparece con un fundido).
    const g = fract(p);
    const edge = min(min(g.x, oneMinus(g.x)), min(g.y, oneMinus(g.y)));
    const line = oneMinus(smoothstep(0.012, 0.045, edge)).mul(inPlot).mul(this.gridOpacity).mul(0.22);
    const base = vertexColor().rgb.mul(mow).mul(variation);
    mat.colorNode = mix(base, pathColor, pathMask).add(vec3(line));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    return mesh;
  }

  private water(): THREE.Mesh {
    const size = LAKE.r * 3;
    // Profundidad horneada en una textura para colorear el agua y dibujar la espuma de la orilla.
    const res = 96;
    const data = new Uint8Array(res * res * 4);
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const x = LAKE.x - size / 2 + ((i + 0.5) / res) * size;
        const z = LAKE.z - size / 2 + ((j + 0.5) / res) * size;
        const depth = Math.max(0, Math.min(1, (WATER_Y - terrainHeight(x, z)) / 2));
        data[(j * res + i) * 4] = depth * 255;
        data[(j * res + i) * 4 + 3] = 255;
      }
    }
    const depthTex = new THREE.DataTexture(data, res, res);
    depthTex.magFilter = THREE.LinearFilter;
    depthTex.minFilter = THREE.LinearFilter;
    depthTex.needsUpdate = true;

    const mat = new THREE.MeshStandardNodeMaterial({ transparent: true, roughness: 0.06, metalness: 0 });
    const p = positionWorld.xz;
    const uvW = p.sub(vec2(LAKE.x - size / 2, LAKE.z - size / 2)).div(size);
    const depth = texture(depthTex, uvW).r;
    const shallow = color('#6fd6d6');
    const deep = color('#1d6c9f');
    const wave = sin(time.mul(1.6).add(mx_noise_float(vec3(p.mul(0.6), time.mul(0.2))).mul(7)));
    const foam = oneMinus(smoothstep(0.0, 0.12, depth.add(wave.mul(0.025))));
    mat.colorNode = mix(mix(shallow, deep, smoothstep(0.02, 0.7, depth)), color('#ffffff'), foam.mul(0.85));
    mat.opacityNode = mix(float(0.55), float(0.92), smoothstep(0.0, 0.5, depth)).max(foam);
    const nx = mx_noise_float(vec3(p.mul(0.9), time.mul(0.5))).mul(0.18);
    const nz = mx_noise_float(vec3(p.mul(0.9).add(17), time.mul(0.5))).mul(0.18);
    mat.normalNode = transformNormalToView(vec3(nx, 1, nz).normalize());
    const geo = new THREE.PlaneGeometry(size, size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(LAKE.x, WATER_Y, LAKE.z);
    mesh.receiveShadow = true;
    return mesh;
  }

  /** Material de vegetación con balanceo por viento (proporcional a la altura). */
  private windMaterial(base: THREE.Material, strength: number): THREE.Material {
    const src = base as THREE.MeshStandardMaterial;
    const m = new THREE.MeshStandardNodeMaterial({ map: src.map, color: src.color, roughness: 0.8, metalness: 0 });
    const phase = hash(instanceIndex).mul(6.28);
    const gust = sin(time.mul(0.6)).mul(0.5).add(1);
    const sway = sin(time.mul(1.7).add(phase)).mul(strength).mul(gust);
    const h = positionLocal.y.max(0);
    m.positionNode = positionLocal.add(vec3(sway.mul(h), 0, sway.mul(h).mul(0.6)));
    return m;
  }

  private forest(assets: Assets): void {
    const rand = seeded(42);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const place = (im: InstancedModel, x: number, z: number, scale: number, sink = 0) => {
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      m.compose(new THREE.Vector3(x, terrainHeight(x, z) - sink, z), q, new THREE.Vector3(scale, scale, scale));
      im.add(m);
    };
    const free = (x: number, z: number, margin: number) =>
      Math.max(Math.abs(x), Math.abs(z)) > HALF + margin && lakeMask(x, z) < 0.02;

    // Bosque
    const treeKinds = ['trees_A_large', 'trees_A_medium', 'trees_B_large', 'trees_B_medium', 'tree_single_A', 'tree_single_B', 'trees_A_small', 'trees_B_small'];
    const trees = treeKinds.map((k) => new InstancedModel(assets.model(k), 320, (mat) => this.windMaterial(mat, 0.035)));
    for (const t of trees) this.group.add(t.group);
    for (let i = 0; i < 2200; i++) {
      const a = rand() * Math.PI * 2;
      const r = HALF + 4 + Math.pow(rand(), 0.7) * 75;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      // Más densidad lejos de la aldea, con claros por ruido.
      if (!free(x, z, 4) || fbm(x * 0.05, z * 0.05, 2, 21) < 0.36 + (r < HALF + 12 ? 0.12 : 0)) continue;
      const kind = Math.floor(rand() * trees.length);
      place(trees[kind]!, x, z, 1.5 + rand() * 1.2);
    }

    // Montañas en el horizonte
    const mountains = ['mountain_A_grass_trees', 'mountain_B_grass_trees', 'mountain_C_grass_trees', 'mountain_A', 'mountain_B'].map(
      (k) => new InstancedModel(assets.model(k), 40),
    );
    for (const g of mountains) this.group.add(g.group);
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * Math.PI * 2 + rand() * 0.15;
      const r = 88 + rand() * 25;
      const k = 10 + rand() * 8;
      place(mountains[Math.floor(rand() * mountains.length)]!, Math.cos(a) * r, Math.sin(a) * r, k, k * 0.12);
    }

    // Rocas
    const rocks = ['rock_single_A', 'rock_single_B', 'rock_single_C', 'rock_single_D', 'rock_single_E'].map(
      (k) => new InstancedModel(assets.model(k), 60),
    );
    for (const g of rocks) this.group.add(g.group);
    for (let i = 0; i < 160; i++) {
      const a = rand() * Math.PI * 2;
      const r = HALF + 2.5 + rand() * 60;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (!free(x, z, 2.5) && lakeMask(x, z) < 0.02) continue;
      place(rocks[Math.floor(rand() * rocks.length)]!, x, z, 0.35 + rand() * 0.6, 0.1);
    }

    // Plantas acuáticas en el lago
    const lilies = ['waterlily_A', 'waterlily_B'].map((k) => new InstancedModel(assets.model(k), 30));
    const reeds = ['waterplant_A', 'waterplant_B'].map((k) => new InstancedModel(assets.model(k), 40, (mat) => this.windMaterial(mat, 0.08)));
    for (const g of [...lilies, ...reeds]) this.group.add(g.group);
    for (let i = 0; i < 300; i++) {
      const x = LAKE.x + (rand() - 0.5) * LAKE.r * 2.4;
      const z = LAKE.z + (rand() - 0.5) * LAKE.r * 2.4;
      const h = terrainHeight(x, z);
      if (h < WATER_Y - 1.2 && rand() < 0.25) {
        q.setFromAxisAngle(up, rand() * 6.28);
        m.compose(new THREE.Vector3(x, WATER_Y + 0.02, z), q, new THREE.Vector3(0.6, 0.6, 0.6));
        lilies[i % 2]!.add(m);
      } else if (h > WATER_Y - 0.5 && h < WATER_Y + 0.2) {
        place(reeds[i % 2]!, x, z, 0.5 + rand() * 0.4);
      }
    }
  }

  /** Matas de hierba y flores instanciadas, con viento. */
  private grass(): void {
    const blade = new THREE.BufferGeometry();
    const verts: number[] = [];
    const cols: number[] = [];
    const base = new THREE.Color('#4f8f2c');
    const tip = new THREE.Color('#a9dc62');
    for (let b = 0; b < 5; b++) {
      const a = (b / 5) * Math.PI;
      const dx = Math.cos(a) * 0.05;
      const dz = Math.sin(a) * 0.05;
      const lean = (b - 2) * 0.05;
      const hgt = 0.28 + (b % 2) * 0.12;
      verts.push(-dx, 0, -dz, dx, 0, dz, lean, hgt, lean * 0.5);
      cols.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b);
    }
    blade.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    blade.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    blade.computeVertexNormals();

    const mat = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.9 });
    const phase = hash(instanceIndex).mul(6.28);
    const sway = sin(time.mul(2.2).add(phase)).mul(0.12).mul(sin(time.mul(0.5)).mul(0.4).add(1));
    mat.positionNode = positionLocal.add(vec3(sway.mul(positionLocal.y), 0, sway.mul(positionLocal.y).mul(0.5)));
    mat.colorNode = vertexColor().rgb;
    mat.normalNode = transformNormalToView(vec3(0, 1, 0));

    const count = 7000;
    const tufts = new THREE.InstancedMesh(blade, mat, count);
    const flowerGeo = new THREE.IcosahedronGeometry(0.06, 0);
    const flowers = new THREE.InstancedMesh(flowerGeo, new THREE.MeshStandardMaterial({ roughness: 0.6 }), 900);
    const flowerColors = ['#ffffff', '#ffe066', '#ff8fb1', '#b58cff'].map((c) => new THREE.Color(c));
    const rand = seeded(7);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let n = 0;
    let f = 0;
    for (let i = 0; i < count * 3 && n < count; i++) {
      const x = (rand() - 0.5) * 150;
      const z = (rand() - 0.5) * 150;
      const d = Math.max(Math.abs(x), Math.abs(z));
      if (d < HALF + 2.2 || lakeMask(x, z) > 0.3) continue;
      // Agrupadas en manchas.
      if (fbm(x * 0.12, z * 0.12, 2, 33) < 0.45) continue;
      const y = terrainHeight(x, z);
      if (y < WATER_Y + 0.1) continue;
      const s = 0.7 + rand() * 0.8;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6.28);
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s));
      tufts.setMatrixAt(n++, m);
      if (f < flowers.count && rand() < 0.14) {
        m.compose(new THREE.Vector3(x + 0.1, y + 0.25 * s, z), q, new THREE.Vector3(1, 1, 1));
        flowers.setMatrixAt(f, m);
        flowers.setColorAt(f++, flowerColors[Math.floor(rand() * flowerColors.length)]!);
      }
    }
    tufts.count = n;
    flowers.count = f;
    tufts.receiveShadow = true;
    this.group.add(tufts, flowers);
  }

  private addClouds(assets: Assets): void {
    const rand = seeded(99);
    const white = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, emissive: new THREE.Color('#dfe9f2'), emissiveIntensity: 0.35 });
    for (let i = 0; i < 12; i++) {
      const obj = assets.model(i % 3 === 0 ? 'cloud_small' : 'cloud_big');
      obj.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.material = white;
          o.castShadow = false;
          o.receiveShadow = false;
        }
      });
      const s = 5 + rand() * 4;
      obj.scale.set(s, s * 0.7, s);
      obj.position.set(-110 + rand() * 220, 26 + rand() * 10, -95 + rand() * 40);
      obj.rotation.y = rand() * 6.28;
      this.group.add(obj);
      this.clouds.push({ obj, speed: 1 + rand() * 1.5 });
    }
  }
}
