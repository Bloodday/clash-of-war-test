import { BUILDING_DEFS, CAMP_SPAWN_SECONDS, GRID_SIZE, TICK_RATE, VILLAGER_NAMES, type BuildingType, type ResourceId, type RoleId } from './data';
import { nextRandom } from './rng';

// El estado es un objeto plano y serializable: se guarda tal cual en
// localStorage hoy, y mañana lo validará/sincronizará el servidor.

export const STATE_VERSION = 4;

export interface Construction {
  targetLevel: number;
  remainingTicks: number;
  totalTicks: number;
  builderId: number;
}

/** Aldeano en camino a la posada. */
export interface Recruit {
  remainingTicks: number;
  totalTicks: number;
}

/** Curación en curso en una enfermería. */
export interface HealJob {
  remainingTicks: number;
  totalTicks: number;
  patientIds: number[];
}

/** Campamento de monstruos que se puede atacar para conseguir botín. */
export interface MonsterCamp {
  id: number;
  seed: number;
  level: number;
  slot: number; // índice en CAMP_SLOTS
}

export interface Building {
  id: number;
  type: BuildingType;
  x: number; // celda de la esquina (mínima) de la huella
  y: number;
  level: number; // 0 = todavía en construcción
  construction: Construction | null;
  hp: number; // vida actual (0 = destruido; los aldeanos lo reparan)
  stored: number; // recursos acumulados sin recolectar (solo productores)
  recruits: Recruit[]; // cola de reclutamiento (solo posadas)
  healing: HealJob | null; // curación en curso (solo enfermerías)
}

export type VillagerTask =
  | { kind: 'idle' }
  | { kind: 'build'; buildingId: number }
  | { kind: 'repair'; buildingId: number }
  | { kind: 'wounded'; infirmaryId: number } // cayó en batalla: ocupa una cama hasta que lo curen
  | {
      kind: 'train';
      buildingId: number;
      role: RoleId;
      targetLevel: number;
      remainingTicks: number;
      totalTicks: number;
    };

export interface Villager {
  id: number;
  name: string;
  role: RoleId | null; // null = aldeano sin formar (hay que entrenarlo)
  roleLevel: number;
  task: VillagerTask;
}

export interface GameState {
  version: typeof STATE_VERSION;
  tick: number;
  rng: number;
  nextId: number;
  resources: Record<ResourceId, number>;
  buildings: Building[];
  villagers: Villager[];
  camps: MonsterCamp[];
  nextCampTick: number; // tick en el que aparece el próximo campamento
}

export function allocId(state: GameState): number {
  return state.nextId++;
}

export function createVillager(state: GameState, role: RoleId | null = null, roleLevel = 0): Villager {
  const name = VILLAGER_NAMES[Math.floor(nextRandom(state) * VILLAGER_NAMES.length)] ?? 'Aldeano';
  const villager: Villager = { id: allocId(state), name, role, roleLevel: role ? Math.max(1, roleLevel) : 0, task: { kind: 'idle' } };
  state.villagers.push(villager);
  return villager;
}

/** Vida máxima de un edificio en su nivel actual (o en el primero si está en obras). */
export function maxHp(b: Pick<Building, 'type' | 'level'>): number {
  const levels = BUILDING_DEFS[b.type].levels;
  return levels[Math.max(1, b.level) - 1]!.hp;
}

function addBuilt(state: GameState, type: BuildingType, x: number, y: number): Building {
  const building: Building = { id: allocId(state), type, x, y, level: 1, construction: null, hp: 0, stored: 0, recruits: [], healing: null };
  building.hp = maxHp(building);
  state.buildings.push(building);
  return building;
}

export function createInitialState(seed = 12345): GameState {
  const state: GameState = {
    version: STATE_VERSION,
    tick: 0,
    rng: seed >>> 0,
    nextId: 1,
    resources: { gold: 500, wood: 500, food: 300 },
    buildings: [],
    villagers: [],
    camps: [],
    nextCampTick: CAMP_SPAWN_SECONDS * TICK_RATE,
  };
  const c = GRID_SIZE / 2;
  addBuilt(state, 'townHall', c - 2, c - 2);
  addBuilt(state, 'house', c - 6, c - 1);
  // La granja inicial ya tiene algo de cosecha para enseñar a recolectar.
  addBuilt(state, 'farm', c - 1, c + 4).stored = 120;
  addBuilt(state, 'inn', c + 4, c - 2);
  // Dos albañiles para empezar a construir y un aldeano sin formar.
  createVillager(state, 'builder', 1);
  createVillager(state, 'builder', 1);
  createVillager(state);
  // Un campamento de monstruos pequeño para empezar.
  state.camps.push({ id: allocId(state), seed: (seed * 7919) >>> 0, level: 1, slot: 0 });
  return state;
}

/**
 * Actualiza un estado guardado con una versión anterior. Devuelve null si no
 * se reconoce.
 *   v1 → v2: sin trabajadores; vida y depósito en los edificios.
 *   v2 → v3: los civiles pasan a ser albañiles; colas de reclutamiento.
 *   v3 → v4: enfermerías (los heridos antiguos quedan curados) y campamentos de monstruos.
 */
export function migrateState(raw: unknown): GameState | null {
  const s = raw as { version: number; buildings: Building[]; villagers: Villager[] } | null;
  if (!s || typeof s !== 'object' || !Array.isArray(s.buildings) || !Array.isArray(s.villagers)) return null;
  if (typeof s.version !== 'number' || s.version < 1 || s.version > STATE_VERSION) return null;
  if (s.version === 1) {
    for (const b of s.buildings) {
      b.hp = maxHp(b);
      b.stored = 0;
    }
    for (const v of s.villagers) {
      if ((v.task as { kind: string }).kind === 'work') v.task = { kind: 'idle' };
    }
    s.version = 2;
  }
  if (s.version === 2) {
    for (const b of s.buildings) b.recruits = [];
    for (const v of s.villagers) {
      // Antes todos los civiles construían: conservan su oficio.
      if (v.role === null) {
        v.role = 'builder';
        v.roleLevel = 1;
      }
    }
    s.version = 3;
  }
  if (s.version === 3) {
    const m = s as unknown as GameState & { version: number };
    for (const b of m.buildings) b.healing = null;
    for (const v of m.villagers) if (v.task.kind === 'wounded') v.task = { kind: 'idle' };
    m.camps = [{ id: m.nextId++, seed: (m.rng * 7919) >>> 0, level: 1, slot: 0 }];
    m.nextCampTick = m.tick + CAMP_SPAWN_SECONDS * TICK_RATE;
    s.version = 4;
  }
  return s as unknown as GameState;
}
