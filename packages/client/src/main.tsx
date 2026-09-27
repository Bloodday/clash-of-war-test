import { render } from 'preact';
import { GameController } from './game/GameController';
import { Assets } from './render/assets';
import { World } from './render/World';
import { renderThumbnails } from './render/thumbnails';
import { UiStore } from './ui/UiStore';
import { App } from './ui/App';
import { fmtTime } from './ui/format';
import './style.css';

const loading = document.getElementById('loading')!;
const bar = loading.querySelector<HTMLDivElement>('.loading-fill')!;

function fail(message: string) {
  loading.querySelector('.loading-text')!.textContent = message;
  loading.classList.add('error');
}

async function main() {
  const { game, offlineSeconds } = GameController.load();
  const ui = new UiStore();

  let assets: Assets;
  try {
    assets = await Assets.load((f) => (bar.style.width = `${Math.round(f * 100)}%`));
  } catch (err) {
    console.error(err);
    fail('No se pudieron cargar los modelos 3D.');
    return;
  }

  const world = new World(document.getElementById('viewport')!, document.getElementById('overlays')!, game, ui, assets);
  try {
    await world.init(ui.quality);
  } catch (err) {
    console.error(err);
    fail('Tu navegador no soporta WebGPU ni WebGL 2. Prueba con una versión reciente de Chrome, Edge o Firefox.');
    return;
  }
  ui.onQualityChange = (q) => world.setQuality(q);
  // Sin preferencia guardada, WebGL 2 arranca en calidad media.
  if (ui.qualityAuto && ui.backend !== 'WebGPU') ui.setQuality('medium', true);
  render(<App game={game} ui={ui} />, document.getElementById('ui')!);

  renderThumbnails(world.renderer, assets)
    .then((thumbs) => {
      ui.thumbnails = thumbs;
      ui.notify();
    })
    .catch((err) => console.warn('Sin miniaturas', err));

  loading.classList.add('done');
  setTimeout(() => loading.remove(), 900);
  if (offlineSeconds > 60) setTimeout(() => ui.toast(`Has estado fuera ${fmtTime(offlineSeconds)}: tu aldea siguió trabajando.`), 3400);
  window.addEventListener('beforeunload', () => game.save());
  // Acceso desde la consola para depurar.
  Object.assign(window, { game, ui, world });
}

void main();
