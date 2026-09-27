#!/usr/bin/env node
// Prueba de humo en un Chrome real con WebGPU (SwiftShader si no hay GPU):
// arranca el build, comprueba que el render es WebGPU, que no hay errores,
// que se puede construir y que las miniaturas se generan. Deja capturas en tools/out/.
//
//   tools/get-chrome.sh && pnpm build && pnpm smoke
//   CHROME_PATH=/ruta/a/chrome pnpm smoke     (otro Chrome)
//   pnpm smoke --allow-webgl                  (acepta el fallback WebGL 2)

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tools/out');
const CHROME = process.env.CHROME_PATH ?? join(ROOT, '.chrome/chrome-linux64/chrome');
const ALLOW_WEBGL = process.argv.includes('--allow-webgl');
const PORT = 4179;

if (!existsSync(CHROME)) {
  console.error(`No se encontró Chrome en ${CHROME}. Ejecuta tools/get-chrome.sh o define CHROME_PATH.`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const server = spawn('pnpm', ['--filter', '@cow/client', 'exec', 'vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: ROOT,
  stdio: 'ignore',
});
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  server.kill();
  process.exit(1);
};

try {
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  // Calidad baja: el render por software es lento.
  await page.addInitScript(() => localStorage.setItem('clash-of-war:quality', 'low'));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForFunction(() => window.world && window.game, null, { timeout: 180_000 });
  const backend = await page.evaluate(() => window.ui.backend);
  console.log(`· backend: ${backend}`);
  if (backend !== 'WebGPU' && !ALLOW_WEBGL) fail('se esperaba WebGPU');

  await page.evaluate(() => (window.world.intro.t = 99));
  const placed = await page.evaluate(() => window.game.dispatch({ type: 'placeBuilding', building: 'lumberCamp', x: 27, y: 23 }));
  if (!placed.ok) fail(`no se pudo construir: ${placed.error}`);
  await page.evaluate(() => (window.game.speed = 20));
  await page.waitForFunction(() => window.game.state.buildings.some((b) => b.type === 'lumberCamp' && b.level === 1), null, {
    timeout: 120_000,
  });
  console.log('· construcción completada');

  const food = await page.evaluate(() => {
    const before = window.game.state.resources.food;
    window.ui.collect(window.game.state.buildings.find((b) => b.type === 'farm').id);
    return window.game.state.resources.food - before;
  });
  if (!(food > 0)) fail('la recolección no sumó comida');
  console.log(`· recolectado: +${Math.floor(food)} de comida`);

  // Reclutar en la posada y formar al recién llegado como albañil en un taller.
  const before = await page.evaluate(() => {
    const s = window.game.state;
    s.resources.food = 1000;
    s.resources.gold = 1000;
    s.resources.wood = 1000;
    const inn = s.buildings.find((b) => b.type === 'inn');
    const r = window.game.dispatch({ type: 'recruitVillager', buildingId: inn.id });
    const w = window.game.dispatch({ type: 'placeBuilding', building: 'workshop', x: 12, y: 24 });
    if (!r.ok || !w.ok) throw new Error(`posada/taller: ${JSON.stringify([r, w])}`);
    return s.villagers.length;
  });
  await page.waitForFunction(
    (n) => window.game.state.villagers.length > n && window.game.state.buildings.some((b) => b.type === 'workshop' && b.level === 1),
    before,
    { timeout: 120_000 },
  );
  await page.evaluate(() => {
    const s = window.game.state;
    const v = s.villagers.find((x) => x.role === null && x.task.kind === 'idle');
    const ws = s.buildings.find((b) => b.type === 'workshop');
    const r = window.game.dispatch({ type: 'trainVillager', villagerId: v.id, buildingId: ws.id });
    if (!r.ok) throw new Error(`entrenar albañil: ${r.error}`);
  });
  await page.waitForFunction(() => window.game.state.villagers.filter((v) => v.role === 'builder').length >= 3, null, { timeout: 120_000 });
  console.log('· posada: aldeano reclutado y formado como albañil');

  // Vida completa de cada edificio antes del ataque, para comprobar que se repara todo.
  await page.evaluate(() => {
    window.__fullHp = Object.fromEntries(window.game.state.buildings.map((b) => [b.id, b.hp]));
    window.ui.simulateAttack();
  });
  const damaged = await page.evaluate(() => window.game.state.buildings.filter((b) => b.hp < window.__fullHp[b.id]).length);
  if (damaged === 0) fail('el ataque simulado no dañó nada');
  await page.waitForFunction(() => window.game.state.buildings.every((b) => b.hp >= window.__fullHp[b.id]), null, {
    timeout: 180_000,
  });
  console.log(`· ataque simulado reparado por los aldeanos (${damaged} edificios afectados)`);
  await page.evaluate(() => (window.game.speed = 1));

  // Batalla: soldados contra una aldea generada, hasta el final.
  await page.evaluate(() => {
    const s = window.game.state;
    let id = 9000;
    for (const [role, n] of [['warrior', 4], ['archer', 3], ['healer', 1]]) {
      for (let i = 0; i < n; i++) s.villagers.push({ id: id++, name: `${role}${i}`, role, roleLevel: 2, task: { kind: 'idle' } });
    }
    window.ui.startBattle();
    const b = window.ui.battle;
    let y = 1;
    for (const r of [...b.state.reserve]) {
      let res = b.dispatch({ type: 'deploy', villagerId: r.villagerId, x: 0.6, y });
      while (!res.ok && y < 39) res = b.dispatch({ type: 'deploy', villagerId: r.villagerId, x: 0.6, y: (y += 0.7) });
      y += 0.7;
    }
    b.speed = 40;
  });
  const deployed = await page.evaluate(() => window.ui.battle.state.units.filter((u) => u.side === 'attacker').length);
  if (deployed < 8) fail(`solo se desplegaron ${deployed} tropas`);
  await page.waitForFunction(() => window.ui.battle && window.ui.battle.summary, null, { timeout: 300_000 });
  const summary = await page.evaluate(() => window.ui.battle.summary);
  console.log(`· batalla: ${summary.stars}★ ${Math.round(summary.destruction * 100)}% · heridos: ${summary.fallen.length}`);
  await page.screenshot({ path: join(OUT, 'smoke-battle.png') });
  await page.evaluate(() => window.ui.leaveBattle());
  if (await page.evaluate(() => !!window.ui.battle)) fail('no se volvió a la aldea');

  await page.waitForFunction(() => window.ui.thumbnails.size > 0, null, { timeout: 180_000 });
  console.log(`· miniaturas: ${await page.evaluate(() => window.ui.thumbnails.size)}`);
  await page.getByRole('button', { name: /Construir/ }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, 'smoke.png') });

  const real = errors.filter((e) => !/favicon|GL Driver/.test(e));
  if (real.length) fail(`errores en la página:\n  ${real.join('\n  ')}`);
  await browser.close();
  console.log(`✓ todo correcto (captura en tools/out/smoke.png)`);
} finally {
  server.kill();
}
