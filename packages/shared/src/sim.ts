import { RESOURCES, TICK_RATE } from './data';
import { getProductionRates, getStorageCapacity } from './queries';
import type { GameState } from './state';

/**
 * Avanza la simulación `dt` ticks. Con dt=1 es el paso normal del bucle de
 * juego; con dt mayores se usa para recuperar el tiempo transcurrido offline.
 */
export function tick(state: GameState, dt = 1): void {
  // 1) Producción (con los niveles vigentes al inicio del paso).
  const rates = getProductionRates(state);
  const cap = getStorageCapacity(state);
  const seconds = dt / TICK_RATE;
  for (const r of RESOURCES) {
    const current = state.resources[r];
    // Si ya se estaba por encima de la capacidad (p. ej. tras perder un almacén) no se recorta.
    if (current < cap[r]) state.resources[r] = Math.min(cap[r], current + rates[r] * seconds);
  }

  // 2) Obras.
  for (const b of state.buildings) {
    const c = b.construction;
    if (!c) continue;
    c.remainingTicks -= dt;
    if (c.remainingTicks <= 0) {
      b.level = c.targetLevel;
      b.construction = null;
      const builder = state.villagers.find((v) => v.id === c.builderId);
      if (builder && builder.task.kind === 'build') builder.task = { kind: 'idle' };
    }
  }

  // 3) Entrenamiento.
  for (const v of state.villagers) {
    const t = v.task;
    if (t.kind !== 'train') continue;
    t.remainingTicks -= dt;
    if (t.remainingTicks <= 0) {
      v.role = t.role;
      v.roleLevel = t.targetLevel;
      v.task = { kind: 'idle' };
    }
  }

  state.tick += dt;
}

/** Avanza muchos ticks en bloques (para el progreso offline). */
export function advance(state: GameState, ticks: number, chunk = TICK_RATE * 5): void {
  let remaining = Math.max(0, Math.floor(ticks));
  while (remaining > 0) {
    const step = Math.min(chunk, remaining);
    tick(state, step);
    remaining -= step;
  }
}
