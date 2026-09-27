import * as THREE from 'three/webgpu';
import { abs, float, instancedBufferAttribute, max, oneMinus, pow, smoothstep, uv, vec2 } from 'three/tsl';

// Partículas en GPU: un único draw call por sistema (sprites instanciados).
// La simulación es en CPU porque son pocas y así es fácil emitirlas desde el juego.

type ColorLike = THREE.ColorRepresentation;

export interface EmitOptions {
  count: number;
  at: THREE.Vector3;
  spread?: number | THREE.Vector3; // radio de aparición
  velocity?: THREE.Vector3;
  jitter?: number; // aleatoriedad de la velocidad
  radial?: number; // velocidad hacia fuera desde el centro (plano XZ)
  life?: [number, number];
  size?: [number, number]; // inicio, fin
  color?: ColorLike | [ColorLike, ColorLike];
  endColor?: ColorLike;
  alpha?: number;
  gravity?: number;
  drag?: number;
  spin?: number;
}

type Shape = 'soft' | 'spark';

export class ParticleSystem {
  readonly mesh: THREE.Mesh;
  private n = 0;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size: Float32Array;
  private c0: Float32Array;
  private c1: Float32Array;
  private phys: Float32Array; // gravedad, arrastre, giro, alfa
  private aOffset: THREE.InstancedBufferAttribute;
  private aSize: THREE.InstancedBufferAttribute;
  private aColor: THREE.InstancedBufferAttribute;
  private aRot: THREE.InstancedBufferAttribute;
  private tmpA = new THREE.Color();
  private tmpB = new THREE.Color();

  constructor(
    private capacity: number,
    shape: Shape,
    additive: boolean,
  ) {
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity * 2);
    this.c0 = new Float32Array(capacity * 3);
    this.c1 = new Float32Array(capacity * 3);
    this.phys = new Float32Array(capacity * 4);
    this.aOffset = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.aRot = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    for (const a of [this.aOffset, this.aSize, this.aColor, this.aRot]) a.setUsage(THREE.DynamicDrawUsage);

    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
    if (additive) mat.blending = THREE.AdditiveBlending;
    const col = instancedBufferAttribute<'vec4'>(this.aColor, 'vec4');
    const d = uv().sub(0.5).length().mul(2);
    let mask;
    if (shape === 'soft') {
      mask = pow(oneMinus(smoothstep(0.0, 1.0, d)), float(1.6));
    } else {
      // Destello de 4 puntas con núcleo brillante.
      const c = uv().sub(0.5).mul(2);
      const cross = max(
        oneMinus(smoothstep(0.0, 0.12, abs(c.x))).mul(oneMinus(abs(c.y))),
        oneMinus(smoothstep(0.0, 0.12, abs(c.y))).mul(oneMinus(abs(c.x))),
      );
      mask = max(cross, pow(oneMinus(d.min(1)), float(3)));
    }
    mat.colorNode = col.xyz;
    mat.opacityNode = col.w.mul(mask);
    mat.positionNode = instancedBufferAttribute<'vec3'>(this.aOffset, 'vec3');
    mat.scaleNode = vec2(instancedBufferAttribute<'float'>(this.aSize, 'float'));
    mat.rotationNode = instancedBufferAttribute<'float'>(this.aRot, 'float');

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.mesh.count = capacity;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 11 : 10;
  }

  emit(o: EmitOptions): void {
    const [cA, cB] = Array.isArray(o.color) ? o.color : [o.color ?? '#ffffff', o.color ?? '#ffffff'];
    const end = new THREE.Color(o.endColor ?? cA);
    for (let k = 0; k < o.count; k++) {
      if (this.n >= this.capacity) this.kill(0);
      const i = this.n++;
      const sp = o.spread ?? 0;
      const sx = typeof sp === 'number' ? sp : sp.x;
      const sy = typeof sp === 'number' ? sp * 0.3 : sp.y;
      const sz = typeof sp === 'number' ? sp : sp.z;
      const ox = (Math.random() * 2 - 1) * sx;
      const oz = (Math.random() * 2 - 1) * sz;
      this.pos.set([o.at.x + ox, o.at.y + (Math.random() * 2 - 1) * sy, o.at.z + oz], i * 3);
      const j = o.jitter ?? 0;
      const v = o.velocity ?? new THREE.Vector3();
      const len = Math.hypot(ox, oz) || 1;
      const r = o.radial ?? 0;
      this.vel.set(
        [
          v.x + (Math.random() * 2 - 1) * j + (ox / len) * r * (0.5 + Math.random()),
          v.y + (Math.random() * 2 - 1) * j,
          v.z + (Math.random() * 2 - 1) * j + (oz / len) * r * (0.5 + Math.random()),
        ],
        i * 3,
      );
      const [l0, l1] = o.life ?? [1, 1.5];
      this.life[i] = 0;
      this.maxLife[i] = l0 + Math.random() * (l1 - l0);
      const [s0, s1] = o.size ?? [0.3, 0.3];
      this.size.set([s0 * (0.7 + Math.random() * 0.6), s1 * (0.7 + Math.random() * 0.6)], i * 2);
      this.tmpA.set(cA).lerp(this.tmpB.set(cB), Math.random());
      this.c0.set([this.tmpA.r, this.tmpA.g, this.tmpA.b], i * 3);
      this.c1.set(o.endColor ? [end.r, end.g, end.b] : [this.tmpA.r, this.tmpA.g, this.tmpA.b], i * 3);
      this.phys.set([o.gravity ?? 0, o.drag ?? 0, (Math.random() * 2 - 1) * (o.spin ?? 0), o.alpha ?? 1], i * 4);
      this.aRot.array[i] = Math.random() * Math.PI * 2;
    }
  }

  update(dt: number): void {
    const off = this.aOffset.array as Float32Array;
    const sizeA = this.aSize.array as Float32Array;
    const colA = this.aColor.array as Float32Array;
    const rotA = this.aRot.array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      this.life[i]! += dt;
      if (this.life[i]! >= this.maxLife[i]!) {
        this.kill(i);
        i--;
        continue;
      }
      const g = this.phys[i * 4]!;
      const drag = Math.max(0, 1 - this.phys[i * 4 + 1]! * dt);
      this.vel[i * 3 + 1]! -= g * dt;
      for (let k = 0; k < 3; k++) {
        this.vel[i * 3 + k]! *= drag;
        this.pos[i * 3 + k]! += this.vel[i * 3 + k]! * dt;
      }
      const t = this.life[i]! / this.maxLife[i]!;
      off[i * 3] = this.pos[i * 3]!;
      off[i * 3 + 1] = this.pos[i * 3 + 1]!;
      off[i * 3 + 2] = this.pos[i * 3 + 2]!;
      sizeA[i] = this.size[i * 2]! + (this.size[i * 2 + 1]! - this.size[i * 2]!) * t;
      for (let k = 0; k < 3; k++) colA[i * 4 + k] = this.c0[i * 3 + k]! + (this.c1[i * 3 + k]! - this.c0[i * 3 + k]!) * t;
      // Aparece rápido y se desvanece suavemente.
      colA[i * 4 + 3] = this.phys[i * 4 + 3]! * Math.min(1, t * 8) * (1 - t * t);
      rotA[i]! += this.phys[i * 4 + 2]! * dt;
    }
    for (let i = this.n; i < this.capacity && sizeA[i] !== 0; i++) sizeA[i] = 0;
    for (const a of [this.aOffset, this.aSize, this.aColor, this.aRot]) a.needsUpdate = true;
  }

  /** Elimina la partícula i moviendo la última a su hueco. */
  private kill(i: number): void {
    const last = --this.n;
    if (i !== last) {
      const copy = (arr: Float32Array | THREE.TypedArray, stride: number) => {
        for (let k = 0; k < stride; k++) arr[i * stride + k] = arr[last * stride + k]!;
      };
      copy(this.pos, 3);
      copy(this.vel, 3);
      copy(this.life, 1);
      copy(this.maxLife, 1);
      copy(this.size, 2);
      copy(this.c0, 3);
      copy(this.c1, 3);
      copy(this.phys, 4);
      copy(this.aRot.array, 1);
    }
    (this.aSize.array as Float32Array)[last] = 0;
  }
}

/** Efectos listos para usar desde el juego. */
export class Particles {
  readonly group = new THREE.Group();
  private soft = new ParticleSystem(2500, 'soft', false);
  private glow = new ParticleSystem(1500, 'spark', true);

  constructor() {
    this.group.add(this.soft.mesh, this.glow.mesh);
  }

  update(dt: number): void {
    this.soft.update(dt);
    this.glow.update(dt);
  }

  dust(at: THREE.Vector3, radius: number, count = 24): void {
    this.soft.emit({
      count,
      at,
      spread: new THREE.Vector3(radius, 0.05, radius),
      radial: 1.6,
      velocity: new THREE.Vector3(0, 0.6, 0),
      jitter: 0.3,
      life: [0.6, 1.2],
      size: [0.5, 1.4],
      color: ['#d9c39a', '#bfa47a'],
      alpha: 0.75,
      drag: 2.5,
      spin: 1.5,
    });
  }

  smoke(at: THREE.Vector3, scale = 1): void {
    this.soft.emit({
      count: 1,
      at,
      spread: 0.05 * scale,
      velocity: new THREE.Vector3(0.25, 0.8, 0.1),
      jitter: 0.08,
      life: [2.2, 3.2],
      size: [0.25 * scale, 1.1 * scale],
      color: ['#f2f0ec', '#d8d6d2'],
      endColor: '#b9bcc2',
      alpha: 0.55,
      drag: 0.3,
      spin: 0.6,
    });
  }

  sparks(at: THREE.Vector3, count = 6, tint: ColorLike = '#ffcf5a'): void {
    this.glow.emit({
      count,
      at,
      spread: 0.05,
      velocity: new THREE.Vector3(0, 1.6, 0),
      jitter: 1.4,
      life: [0.25, 0.55],
      size: [0.14, 0.02],
      color: [tint, '#fff3c4'],
      endColor: '#ff7b2e',
      gravity: 6,
    });
  }

  celebrate(at: THREE.Vector3, radius: number): void {
    this.glow.emit({
      count: 60,
      at,
      spread: new THREE.Vector3(radius * 0.6, 0.8, radius * 0.6),
      velocity: new THREE.Vector3(0, 2.2, 0),
      jitter: 1.6,
      life: [0.8, 1.6],
      size: [0.35, 0.05],
      color: ['#fff2a8', '#ffd24a'],
      gravity: 2.5,
      drag: 1,
      spin: 3,
    });
    this.soft.emit({
      count: 50,
      at: at.clone().setY(at.y + 1),
      spread: new THREE.Vector3(radius * 0.5, 0.5, radius * 0.5),
      velocity: new THREE.Vector3(0, 3.5, 0),
      jitter: 2.2,
      life: [1.2, 2.2],
      size: [0.14, 0.12],
      color: ['#ff5d73', '#4fc3ff'],
      gravity: 4,
      drag: 1.2,
      spin: 8,
    });
    this.soft.emit({
      count: 40,
      at: at.clone().setY(at.y + 1),
      spread: new THREE.Vector3(radius * 0.5, 0.5, radius * 0.5),
      velocity: new THREE.Vector3(0, 3.5, 0),
      jitter: 2.2,
      life: [1.2, 2.2],
      size: [0.14, 0.12],
      color: ['#ffe14f', '#7cff7a'],
      gravity: 4,
      drag: 1.2,
      spin: 8,
    });
  }

  magic(at: THREE.Vector3, tint: ColorLike = '#8fd9ff'): void {
    this.glow.emit({
      count: 2,
      at,
      spread: 0.35,
      velocity: new THREE.Vector3(0, 0.9, 0),
      jitter: 0.25,
      life: [0.8, 1.4],
      size: [0.18, 0.02],
      color: [tint, '#ffffff'],
    });
  }

  chips(at: THREE.Vector3, tint: ColorLike): void {
    this.soft.emit({
      count: 4,
      at,
      spread: 0.05,
      velocity: new THREE.Vector3(0, 1.8, 0),
      jitter: 1.1,
      life: [0.4, 0.7],
      size: [0.09, 0.07],
      color: tint,
      gravity: 9,
      spin: 10,
    });
  }

  /** Humo oscuro de un edificio dañado. */
  darkSmoke(at: THREE.Vector3, scale = 1): void {
    this.soft.emit({
      count: 1,
      at,
      spread: 0.3 * scale,
      velocity: new THREE.Vector3(0.2, 1.0, 0.05),
      jitter: 0.12,
      life: [1.8, 2.6],
      size: [0.4 * scale, 1.5 * scale],
      color: ['#4a4541', '#2f2b28'],
      endColor: '#6d6a67',
      alpha: 0.6,
      drag: 0.3,
      spin: 0.5,
    });
  }

  /** Llamas de un edificio muy dañado. */
  fire(at: THREE.Vector3, scale = 1): void {
    this.glow.emit({
      count: 2,
      at,
      spread: 0.35 * scale,
      velocity: new THREE.Vector3(0, 1.2, 0),
      jitter: 0.25,
      life: [0.35, 0.7],
      size: [0.45 * scale, 0.05],
      color: ['#ffb238', '#ff6a1f'],
      endColor: '#b3200c',
    });
  }

  /** Impacto de un proyectil: fogonazo, humo y escombros. */
  explosion(at: THREE.Vector3, scale = 1): void {
    this.glow.emit({
      count: 30,
      at,
      spread: 0.2 * scale,
      jitter: 3.2 * scale,
      velocity: new THREE.Vector3(0, 1.5, 0),
      life: [0.25, 0.5],
      size: [0.6 * scale, 0.05],
      color: ['#fff0a0', '#ff9a2e'],
      endColor: '#c2300f',
      drag: 3,
    });
    this.soft.emit({
      count: 18,
      at,
      spread: 0.4 * scale,
      radial: 2.2,
      velocity: new THREE.Vector3(0, 1.4, 0),
      jitter: 0.6,
      life: [0.9, 1.6],
      size: [0.6 * scale, 1.8 * scale],
      color: ['#5b534c', '#8a8178'],
      alpha: 0.8,
      drag: 2,
      spin: 1,
    });
    this.soft.emit({ count: 12, at, spread: 0.2, velocity: new THREE.Vector3(0, 3, 0), jitter: 2.2, life: [0.6, 1], size: [0.12, 0.1], color: '#7a6a58', gravity: 9, spin: 8 });
  }

  /** Brillo al recolectar recursos. */
  collect(at: THREE.Vector3, tint: ColorLike): void {
    this.glow.emit({
      count: 22,
      at,
      spread: new THREE.Vector3(0.5, 0.3, 0.5),
      velocity: new THREE.Vector3(0, 2.4, 0),
      jitter: 1.2,
      life: [0.5, 0.9],
      size: [0.3, 0.02],
      color: [tint, '#ffffff'],
      gravity: 3,
      spin: 4,
    });
  }

  glint(at: THREE.Vector3, spread: number): void {
    this.glow.emit({
      count: 1,
      at,
      spread,
      life: [0.3, 0.6],
      size: [0.3, 0.0],
      color: '#fff6c8',
    });
  }
}
