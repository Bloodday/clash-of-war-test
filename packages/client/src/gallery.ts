// Galería de desarrollo: muestra todos los modelos y personajes empaquetados.
// Abrir en /gallery.html (opcional ?filter=texto).
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Assets, localBounds } from './render/assets';

const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
await renderer.init();

const scene = new THREE.Scene();
scene.background = new THREE.Color('#9cc9e8');
scene.add(new THREE.HemisphereLight('#ffffff', '#667755', 1.4));
const sun = new THREE.DirectionalLight('#fff3dd', 2.2);
sun.position.set(-10, 20, 10);
scene.add(sun);

const assets = await Assets.load();
const filter = new URLSearchParams(location.search).get('filter') ?? '';
const names = assets.modelNames().filter((n) => n.includes(filter));
const cols = Math.ceil(Math.sqrt(names.length + 4));
const spacing = 3;
const labels: { el: HTMLDivElement; pos: THREE.Vector3 }[] = [];
const place = (obj: THREE.Object3D, name: string, i: number) => {
  const box = localBounds(obj);
  const size = box.getSize(new THREE.Vector3());
  const k = 2.2 / Math.max(size.x, size.z, size.y * 0.8, 0.01);
  obj.scale.setScalar(k);
  obj.position.set((i % cols) * spacing - (cols * spacing) / 2, 0, Math.floor(i / cols) * spacing - (cols * spacing) / 2);
  scene.add(obj);
  const el = document.createElement('div');
  el.className = 'label';
  el.textContent = `${name} (${size.x.toFixed(2)}×${size.y.toFixed(2)}×${size.z.toFixed(2)})`;
  document.body.appendChild(el);
  labels.push({ el, pos: obj.position.clone().setZ(obj.position.z + 1.3) });
};
names.forEach((n, i) => place(assets.model(n), n, i));

const mixers: THREE.AnimationMixer[] = [];
const anims = ['Walking_A', 'Interact', '1H_Melee_Attack_Chop', 'Spellcasting'];
if (!filter || filter === 'char') {
  assets.characterNames().forEach((n, j) => {
    const c = assets.character(n);
    place(c, n, names.length + j);
    const mixer = new THREE.AnimationMixer(c);
    mixer.clipAction(assets.clip(anims[j % anims.length]!)).play();
    mixers.push(mixer);
  });
}

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 500);
camera.position.set(0, cols * 2.4, cols * 2.6);
const controls = new OrbitControls(camera, renderer.domElement);
const timer = new THREE.Timer();
const v = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  timer.update();
  const dt = timer.getDelta();
  for (const m of mixers) m.update(dt);
  controls.update();
  renderer.render(scene, camera);
  for (const l of labels) {
    v.copy(l.pos).project(camera);
    l.el.style.left = `${((v.x + 1) / 2) * innerWidth}px`;
    l.el.style.top = `${((1 - v.y) / 2) * innerHeight}px`;
  }
});
Object.assign(window, { assets });
