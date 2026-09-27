import { render } from 'preact';
import { GameController } from './game/GameController';
import { World } from './render/World';
import { UiStore } from './ui/UiStore';
import { App } from './ui/App';
import { fmtTime } from './ui/format';
import './style.css';

async function main() {
  const { game, offlineSeconds } = GameController.load();
  const ui = new UiStore();

  const world = new World(document.getElementById('viewport')!, document.getElementById('overlays')!, game, ui);
  render(<App game={game} ui={ui} />, document.getElementById('ui')!);

  try {
    await world.init();
  } catch (err) {
    console.error(err);
    document.getElementById('ui')!.innerHTML =
      '<div class="fatal panel">Tu navegador no soporta WebGPU ni WebGL 2. Prueba con una versión reciente de Chrome, Edge o Firefox.</div>';
    return;
  }

  if (offlineSeconds > 60) ui.toast(`Has estado fuera ${fmtTime(offlineSeconds)}: tu aldea siguió trabajando.`);
  window.addEventListener('beforeunload', () => game.save());
  // Acceso desde la consola para depurar.
  Object.assign(window, { game, ui });
}

void main();
