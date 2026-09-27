import {
  BUILDING_DEFS,
  GRID_SIZE,
  RESOURCES,
  ROLE_DEFS,
  type BuildingLevelDef,
  type BuildingType,
  type Cost,
  type ResourceId,
  type RoleId,
} from './data';
import type { Building, GameState, Villager } from './state';

// Consultas puras sobre el estado (sin efectos secundarios).

export function getBuilding(state: GameState, id: number): Building | undefined {
  return state.buildings.find((b) => b.id === id);
}

export function getVillager(state: GameState, id: number): Villager | undefined {
  return state.villagers.find((v) => v.id === id);
}

/** Definición del nivel actual (undefined si aún no está construido). */
export function currentLevelDef(b: Building): BuildingLevelDef | undefined {
  return b.level > 0 ? BUILDING_DEFS[b.type].levels[b.level - 1] : undefined;
}

/** Un edificio está operativo si existe y no está en obras. */
export function isOperational(b: Building): boolean {
  return b.level > 0 && b.construction === null;
}

export function getTownHallLevel(state: GameState): number {
  const th = state.buildings.find((b) => b.type === 'townHall');
  return th ? th.level : 0;
}

export function countBuildings(state: GameState, type: BuildingType): number {
  return state.buildings.filter((b) => b.type === type).length;
}

export function maxBuildings(state: GameState, type: BuildingType): number {
  const th = Math.max(1, getTownHallLevel(state));
  const table = BUILDING_DEFS[type].maxCountByTownHall;
  return table[Math.min(th, table.length) - 1] ?? 0;
}

export function getStorageCapacity(state: GameState): Record<ResourceId, number> {
  const cap: Record<ResourceId, number> = { gold: 0, wood: 0, food: 0 };
  for (const b of state.buildings) {
    const storage = currentLevelDef(b)?.storage;
    if (!storage) continue;
    for (const r of RESOURCES) cap[r] += storage[r] ?? 0;
  }
  return cap;
}

export function getHousing(state: GameState): number {
  let total = 0;
  for (const b of state.buildings) total += currentLevelDef(b)?.housing ?? 0;
  return total;
}

export function getWorkers(state: GameState, buildingId: number): Villager[] {
  return state.villagers.filter((v) => v.task.kind === 'work' && v.task.buildingId === buildingId);
}

export function getTrainees(state: GameState, buildingId: number): Villager[] {
  return state.villagers.filter((v) => v.task.kind === 'train' && v.task.buildingId === buildingId);
}

/** Aldeanos civiles sin tarea: los únicos que pueden construir. */
export function getIdleCivilians(state: GameState): Villager[] {
  return state.villagers.filter((v) => v.role === null && v.task.kind === 'idle');
}

/** Producción por segundo de un edificio concreto. */
export function getBuildingProduction(state: GameState, b: Building): Cost {
  const def = currentLevelDef(b);
  if (!def?.productionPerWorker || !isOperational(b)) return {};
  const workers = getWorkers(state, b.id).length;
  const out: Cost = {};
  for (const r of RESOURCES) {
    const rate = def.productionPerWorker[r];
    if (rate) out[r] = rate * workers;
  }
  return out;
}

/** Producción total por segundo de la aldea. */
export function getProductionRates(state: GameState): Record<ResourceId, number> {
  const rates: Record<ResourceId, number> = { gold: 0, wood: 0, food: 0 };
  for (const b of state.buildings) {
    const p = getBuildingProduction(state, b);
    for (const r of RESOURCES) rates[r] += p[r] ?? 0;
  }
  return rates;
}

export function canAfford(state: GameState, cost: Cost): boolean {
  return RESOURCES.every((r) => state.resources[r] >= (cost[r] ?? 0));
}

/** Nivel de rol al que llegaría un aldeano si entrenara el rol indicado. */
export function nextRoleLevel(v: Villager, role: RoleId): number {
  return v.role === role ? v.roleLevel + 1 : 1;
}

export function roleMaxLevel(role: RoleId): number {
  return ROLE_DEFS[role].levels.length;
}

/** ¿Cabe un edificio de tamaño `size` en (x, y)? Ignora el edificio `ignoreId`. */
export function isAreaFree(
  state: GameState,
  x: number,
  y: number,
  size: number,
  ignoreId?: number,
): boolean {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
  if (x < 0 || y < 0 || x + size > GRID_SIZE || y + size > GRID_SIZE) return false;
  for (const b of state.buildings) {
    if (b.id === ignoreId) continue;
    const s = BUILDING_DEFS[b.type].size;
    if (x < b.x + s && x + size > b.x && y < b.y + s && y + size > b.y) return false;
  }
  return true;
}
