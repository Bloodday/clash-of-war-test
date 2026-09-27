import * as THREE from 'three/webgpu';
import { BUILDING_TYPES, type Building, type BuildingType } from '@cow/shared';
import type { Assets } from './assets';
import { localBounds } from './assets';
import { createBuildingVisual } from './buildings';

// Renderiza una miniatura de cada edificio (para la tienda y los paneles).

const SIZE = 192;

export async function renderThumbnails(renderer: THREE.WebGPURenderer, assets: Assets): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#6a7f55', 1.6));
  const sun = new THREE.DirectionalLight('#fff2dc', 2.6);
  sun.position.set(-3, 6, 4);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const target = new THREE.RenderTarget(SIZE, SIZE, { samples: 4 });
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;

  const jobs: [string, BuildingType, number][] = [];
  for (const type of BUILDING_TYPES) for (const level of [1, 2, 3]) jobs.push([`${type}:${level}`, type, level]);

  const prevToneMapping = renderer.toneMapping;
  for (const [key, type, level] of jobs) {
    const b: Building = { id: -1, type, x: 0, y: 0, level, construction: null, hp: 1, stored: 0 };
    const visual = createBuildingVisual(assets, b, type === 'wall' ? 3 : 0);
    scene.add(visual.root);
    const box = localBounds(visual.root);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(15)) * 1.02;
    camera.position.set(sphere.center.x + dist * 0.55, sphere.center.y + dist * 0.5, sphere.center.z + dist * 0.67);
    camera.lookAt(sphere.center);
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    const pixels = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, SIZE, SIZE)) as Uint8Array;
    const img = ctx.createImageData(SIZE, SIZE);
    // Voltear en Y (WebGL) y pasar de lineal a sRGB.
    const flip = !(renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend;
    for (let y = 0; y < SIZE; y++) {
      const srcRow = flip ? SIZE - 1 - y : y;
      for (let x = 0; x < SIZE; x++) {
        const s = (srcRow * SIZE + x) * 4;
        const d = (y * SIZE + x) * 4;
        for (let k = 0; k < 3; k++) img.data[d + k] = Math.round(Math.pow(pixels[s + k]! / 255, 1 / 2.2) * 255);
        img.data[d + 3] = pixels[s + 3]!;
      }
    }
    ctx.putImageData(img, 0, 0);
    out.set(key, canvas.toDataURL('image/png'));
    scene.remove(visual.root);
  }
  renderer.toneMapping = prevToneMapping;
  renderer.setClearColor(0x000000, 1);
  target.dispose();
  return out;
}
