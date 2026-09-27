import { GRID_SIZE, VILLAGER_NAMES, type BuildingType, type ResourceId, type RoleId } from './data';
import { nextRandom } from './rng';

// El estado es un objeto plano y serializable: se guarda tal cual en
// localStorage hoy, y mañana lo validará/sincronizará el servidor.

export interface Construction {
  targetLevel: number;
  remainingTicks: number;
  totalTicks: number;
  builderId: number;
}

export interface Building {
  id: number;
  type: BuildingType;
  x: number; // celda de la esquina (mínima) de la huella
  y: number;
  level: number; // 0 = todavía en construcción
  construction: Construction | null;
}

export type VillagerTask =
  | { kind: 'idle' }
  | { kind: 'work'; buildingId: number }
  | { kind: 'build'; buildingId: number }
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
  role: RoleId | null; // null = civil (puede trabajar y construir)
  roleLevel: number;
  task: VillagerTask;
}

export interface GameState {
  version: 1;
  tick: number;
  rng: number;
  nextId: number;
  resources: Record<ResourceId, number>;
  buildings: Building[];
  villagers: Villager[];
}

export function allocId(state: GameState): number {
  return state.nextId++;
}

export function createVillager(state: GameState): Villager {
  const name = VILLAGER_NAMES[Math.floor(nextRandom(state) * VILLAGER_NAMES.length)] ?? 'Aldeano';
  const villager: Villager = { id: allocId(state), name, role: null, roleLevel: 0, task: { kind: 'idle' } };
  state.villagers.push(villager);
  return villager;
}

function addBuilt(state: GameState, type: BuildingType, x: number, y: number): Building {
  const building: Building = { id: allocId(state), type, x, y, level: 1, construction: null };
  state.buildings.push(building);
  return building;
}

export function createInitialState(seed = 12345): GameState {
  const state: GameState = {
    version: 1,
    tick: 0,
    rng: seed >>> 0,
    nextId: 1,
    resources: { gold: 500, wood: 500, food: 300 },
    buildings: [],
    villagers: [],
  };
  const c = GRID_SIZE / 2;
  addBuilt(state, 'townHall', c - 2, c - 2);
  addBuilt(state, 'house', c - 6, c - 1);
  const farm = addBuilt(state, 'farm', c - 1, c + 4);
  const first = createVillager(state);
  first.task = { kind: 'work', buildingId: farm.id };
  createVillager(state);
  createVillager(state);
  return state;
}
