import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// Modelos 3D: packs CC0 de KayKit (Kay Lousberg, www.kaylousberg.com),
// empaquetados por tools/build-assets.mjs.

const BASE = `${import.meta.env.BASE_URL}assets/`;
export const CHARACTERS = [
  'Knight',
  'Barbarian',
  'Mage',
  'Rogue_Hooded',
  'Rogue',
  'Skeleton_Minion',
  'Skeleton_Warrior',
  'Skeleton_Rogue',
  'Skeleton_Mage',
] as const;
export type CharacterName = (typeof CHARACTERS)[number];

export class Assets {
  private constructor(
    private models: Map<string, THREE.Object3D>,
    private characters: Map<string, THREE.Object3D>,
    private gearModels: Map<string, THREE.Object3D>,
    readonly clips: Map<string, THREE.AnimationClip>,
  ) {}

  static async load(onProgress?: (fraction: number) => void): Promise<Assets> {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const files = ['village.glb', 'animations.glb', 'anim_skeletons.glb', 'skeleton_gear.glb', ...CHARACTERS.map((c) => `char_${c}.glb`)];
    const progress = files.map(() => 0);
    const report = () => onProgress?.(progress.reduce((a, b) => a + b, 0) / files.length);
    const [village, anims, skelAnims, gear, ...chars] = await Promise.all(
      files.map((f, i) =>
        loader.loadAsync(BASE + f, (e) => {
          if (e.total) progress[i] = e.loaded / e.total;
          report();
        }),
      ),
    );

    const models = new Map<string, THREE.Object3D>();
    for (const child of [...village!.scene.children]) {
      child.position.set(0, 0, 0);
      prepare(child);
      models.set(child.name, child);
    }
    const characters = new Map<string, THREE.Object3D>();
    chars.forEach((gltf, i) => {
      const root = gltf.scene.children[0]!;
      root.position.set(0, 0, 0);
      prepare(root);
      characters.set(CHARACTERS[i]!, root);
    });
    // Las armas conservan su transformación original: su origen es la empuñadura.
    const gearModels = new Map<string, THREE.Object3D>();
    for (const child of [...gear!.scene.children]) {
      prepare(child);
      gearModels.set(child.name, child);
    }
    // Aventureros y esqueletos comparten rig: los clips valen para todos.
    const clips = new Map([...anims!.animations, ...skelAnims!.animations].map((c) => [c.name, c]));
    return new Assets(models, characters, gearModels, clips);
  }

  has(name: string): boolean {
    return this.models.has(name);
  }

  modelNames(): string[] {
    return [...this.models.keys()];
  }

  characterNames(): string[] {
    return [...this.characters.keys()];
  }

  /** Copia de un modelo estático (geometrías y materiales compartidos). */
  model(name: string): THREE.Object3D {
    const src = this.models.get(name);
    if (!src) throw new Error(`Modelo desconocido: ${name}`);
    return src.clone(true);
  }

  /** Copia de un personaje con su propio esqueleto, lista para animar. */
  character(name: string): THREE.Object3D {
    const src = this.characters.get(name);
    if (!src) throw new Error(`Personaje desconocido: ${name}`);
    return SkeletonUtils.clone(src);
  }

  /** Arma o escudo de esqueleto, para colgarlo de un hueso `handslot`. */
  gear(name: string): THREE.Object3D {
    const src = this.gearModels.get(name);
    if (!src) throw new Error(`Equipo desconocido: ${name}`);
    return src.clone(true);
  }

  clip(name: string): THREE.AnimationClip {
    const c = this.clips.get(name);
    if (!c) throw new Error(`Animación desconocida: ${name}`);
    return c;
  }
}

function prepare(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      const m = o.material as THREE.MeshStandardMaterial;
      if (m.isMeshStandardMaterial) {
        m.metalness = 0;
        m.roughness = 0.75;
        if (m.map) {
          m.map.anisotropy = 4;
          m.map.colorSpace = THREE.SRGBColorSpace;
        }
      }
    }
  });
}

/** Caja envolvente de un objeto en su espacio local (sin su transformación propia). */
export function localBounds(obj: THREE.Object3D): THREE.Box3 {
  const saved = obj.matrix.clone();
  obj.position.set(0, 0, 0);
  obj.rotation.set(0, 0, 0);
  obj.scale.set(1, 1, 1);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  saved.decompose(obj.position, obj.quaternion, obj.scale);
  obj.updateMatrixWorld(true);
  return box;
}
