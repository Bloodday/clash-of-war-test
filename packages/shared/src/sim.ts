import { CAMP_SLOTS, CAMP_SPAWN_SECONDS, MAX_CAMPS, REPAIR_MIN_HP_PER_SECOND, REPAIR_RATE, TICK_RATE } from './data';
import {
  currentLevelDef,
  getIdleBuilders,
  getTownHallLevel,
  isDamaged,
  isOperational,
  producedResource,
  producerCapacity,
  workSpeed,
} from './queries';
import { allocId, createVillager, maxHp, type GameState } from './state';
import { nextRandom } from './rng';

/**
 * Avanza la simulación `dt` ticks. Con dt=1 es el paso normal del bucle de
 * juego; con dt mayores se usa para recuperar el tiempo transcurrido offline.
 */
export function tick(state: GameState, dt = 1): void {
  const seconds = dt / TICK_RATE;

  // 1) Producción: cada productor llena su propio depósito hasta su capacidad.
  for (const b of state.buildings) {
    const prod = currentLevelDef(b)?.production;
    const r = producedResource(b.type);
    if (!prod || !r || !isOperational(b)) continue;
    b.stored = Math.min(producerCapacity(b), b.stored + (prod[r] ?? 0) * seconds);
  }

  // 2) Obras: los albañiles con más nivel trabajan más rápido.
  for (const b of state.buildings) {
    const c = b.construction;
    if (!c) continue;
    c.remainingTicks -= dt * workSpeed(state.villagers.find((v) => v.id === c.builderId));
    if (c.remainingTicks <= 0) {
      b.level = c.targetLevel;
      b.construction = null;
      b.hp = maxHp(b);
      const builder = state.villagers.find((v) => v.id === c.builderId);
      if (builder && builder.task.kind === 'build') builder.task = { kind: 'idle' };
    }
  }

  // 3) Reparaciones: los albañiles libres acuden solos a los edificios dañados.
  assignRepairs(state);
  for (const v of state.villagers) {
    const t = v.task;
    if (t.kind !== 'repair') continue;
    const b = state.buildings.find((x) => x.id === t.buildingId);
    if (!b || !isDamaged(b) || b.construction) {
      v.task = { kind: 'idle' };
      continue;
    }
    const max = maxHp(b);
    b.hp = Math.min(max, b.hp + Math.max(REPAIR_MIN_HP_PER_SECOND, max * REPAIR_RATE) * workSpeed(v) * seconds);
    if (b.hp >= max) v.task = { kind: 'idle' };
  }

  // 4) Reclutamiento en las posadas (en paralelo, una plaza por aldeano).
  for (const b of state.buildings) {
    if (b.recruits.length === 0 || !isOperational(b)) continue;
    for (const r of b.recruits) r.remainingTicks -= dt;
    const arrived = b.recruits.filter((r) => r.remainingTicks <= 0).length;
    b.recruits = b.recruits.filter((r) => r.remainingTicks > 0);
    for (let i = 0; i < arrived; i++) createVillager(state);
  }

  // 5) Curaciones en las enfermerías (solo si el jugador las pagó).
  for (const b of state.buildings) {
    const job = b.healing;
    if (!job || !isOperational(b)) continue;
    job.remainingTicks -= dt;
    if (job.remainingTicks > 0) continue;
    for (const v of state.villagers) {
      if (job.patientIds.includes(v.id) && v.task.kind === 'wounded') v.task = { kind: 'idle' };
    }
    b.healing = null;
  }

  // Aparecen campamentos de monstruos en los claros libres del bosque.
  if (state.tick + dt >= state.nextCampTick) {
    state.nextCampTick = state.tick + dt + CAMP_SPAWN_SECONDS * TICK_RATE;
    spawnCamp(state);
  }

  // 6) Entrenamiento.
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

/** Un reparador por edificio dañado, empezando por los más dañados. */
function assignRepairs(state: GameState): void {
  const damaged = state.buildings
    .filter((b) => isDamaged(b) && !b.construction)
    .filter((b) => !state.villagers.some((v) => v.task.kind === 'repair' && v.task.buildingId === b.id))
    .sort((a, b) => a.hp / maxHp(a) - b.hp / maxHp(b) || a.id - b.id);
  if (damaged.length === 0) return;
  const idle = getIdleBuilders(state);
  for (let i = 0; i < damaged.length && i < idle.length; i++) {
    idle[i]!.task = { kind: 'repair', buildingId: damaged[i]!.id };
  }
}

/**
 * Daña un edificio (lo usarán las batallas). A 0 de vida queda destruido:
 * deja de funcionar hasta que lo reparen.
 */
export function applyDamage(state: GameState, buildingId: number, amount: number): void {
  const b = state.buildings.find((x) => x.id === buildingId);
  if (!b || b.level === 0) return;
  b.hp = Math.max(0, b.hp - Math.max(0, amount));
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

/** Nuevo campamento de monstruos (si queda algún claro libre), de un nivel parecido al de la aldea. */
export function spawnCamp(state: GameState): void {
  if (state.camps.length >= MAX_CAMPS) return;
  const used = new Set(state.camps.map((c) => c.slot));
  const free = CAMP_SLOTS.map((_, i) => i).filter((i) => !used.has(i));
  if (free.length === 0) return;
  const slot = free[Math.floor(nextRandom(state) * free.length)]!;
  const th = Math.max(1, getTownHallLevel(state));
  const level = Math.max(1, Math.min(5, th + Math.floor(nextRandom(state) * 3) - 1));
  state.camps.push({ id: allocId(state), seed: Math.floor(nextRandom(state) * 2 ** 31), level, slot });
}
