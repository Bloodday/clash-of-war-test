import { BUILDING_DEFS, GRID_SIZE, RESOURCES, VILLAGER_NAMES, type BuildingType, type Cost, type ResourceId } from '../data';
import { producedResource } from '../queries';
import { nextRandom } from '../rng';
import type { GameState } from '../state';
import type { MilitaryRole } from './types';

// Aldeas a las que atacar. Mientras no haya servidor ni otros jugadores, se
// generan de forma procedural (y determinista) según el nivel de ayuntamiento.

export interface BaseBuilding {
  type: BuildingType;
  x: number;
  y: number;
  level: number;
  loot: Cost;
}

export interface DefenderBase {
  name: string;
  townHall: number;
  buildings: BaseBuilding[];
  defenders: { name: string; role: MilitaryRole; level: number }[];
}

/** Botín total disponible en una base. */
export function baseLoot(base: DefenderBase): Record<ResourceId, number> {
  const total: Record<ResourceId, number> = { gold: 0, wood: 0, food: 0 };
  for (const b of base.buildings) for (const r of RESOURCES) total[r] += b.loot[r] ?? 0;
  return total;
}

const maxCount = (type: BuildingType, th: number) => {
  const t = BUILDING_DEFS[type].maxCountByTownHall;
  return t[Math.min(th, t.length) - 1] ?? 0;
};

/** Nivel más alto de un edificio que permite un ayuntamiento. */
const maxLevelFor = (type: BuildingType, th: number) =>
  BUILDING_DEFS[type].levels.filter((l) => l.requiresTownHall <= th).length;

export function generateEnemyBase(seed: number, townHall: number): DefenderBase {
  const th = Math.max(1, Math.min(5, townHall));
  const rng = { rng: seed >>> 0 || 1 };
  const rand = () => nextRandom(rng);
  const occupied = new Uint8Array(GRID_SIZE * GRID_SIZE);
  const buildings: BaseBuilding[] = [];

  const free = (x: number, y: number, size: number, margin: number) => {
    for (let j = y - margin; j < y + size + margin; j++)
      for (let i = x - margin; i < x + size + margin; i++) {
        if (i < 0 || j < 0 || i >= GRID_SIZE || j >= GRID_SIZE) {
          if (i >= x && i < x + size && j >= y && j < y + size) return false;
          continue;
        }
        if (occupied[j * GRID_SIZE + i]) return false;
      }
    return x >= 0 && y >= 0 && x + size <= GRID_SIZE && y + size <= GRID_SIZE;
  };
  const put = (type: BuildingType, x: number, y: number): BaseBuilding => {
    const size = BUILDING_DEFS[type].size;
    for (let j = y; j < y + size; j++) for (let i = x; i < x + size; i++) occupied[j * GRID_SIZE + i] = 1;
    const top = maxLevelFor(type, th);
    const level = Math.max(1, Math.min(top, top - (rand() < 0.35 ? 1 : 0)));
    const b = { type, x, y, level, loot: {} };
    buildings.push(b);
    return b;
  };
  /** Intenta colocar en una zona; devuelve false si no hay sitio. */
  const tryPlace = (type: BuildingType, area: [number, number, number, number], avoid?: [number, number, number, number]) => {
    const size = BUILDING_DEFS[type].size;
    const [x0, y0, x1, y1] = area;
    for (let attempt = 0; attempt < 200; attempt++) {
      const x = x0 + Math.floor(rand() * Math.max(1, x1 - x0 - size + 1));
      const y = y0 + Math.floor(rand() * Math.max(1, y1 - y0 - size + 1));
      if (avoid) {
        const [ax0, ay0, ax1, ay1] = avoid;
        if (x < ax1 && x + size > ax0 && y < ay1 && y + size > ay0) continue;
      }
      if (free(x, y, size, 1)) {
        put(type, x, y);
        return true;
      }
    }
    return false;
  };

  // Ayuntamiento en el centro.
  const c = GRID_SIZE / 2;
  put('townHall', c - 2, c - 2);

  // Anillo de muros: tan grande como permita el número de muros del nivel.
  const walls = maxCount('wall', th);
  const side = Math.min(26, Math.max(6, Math.floor(walls / 4) + 1));
  const a = c - Math.floor(side / 2);
  const ring: [number, number, number, number] = [a, a, a + side, a + side];
  const inner: [number, number, number, number] = [a + 1, a + 1, a + side - 1, a + side - 1];

  // Dentro del anillo: defensas y almacenes.
  for (let i = 0; i < maxCount('archerTower', th); i++) tryPlace('archerTower', inner) || tryPlace('archerTower', [2, 2, 38, 38], ring);
  for (let i = 0; i < maxCount('storehouse', th); i++) tryPlace('storehouse', inner) || tryPlace('storehouse', [2, 2, 38, 38], ring);

  // Muros (después de lo de dentro, para que el anillo quede cerrado alrededor).
  let placedWalls = 0;
  for (let i = a; i < a + side && placedWalls < walls; i++)
    for (let j = a; j < a + side && placedWalls < walls; j++) {
      const edge = i === a || j === a || i === a + side - 1 || j === a + side - 1;
      if (edge && !occupied[j * GRID_SIZE + i]) {
        put('wall', i, j);
        placedWalls++;
      }
    }

  // Fuera: economía, edificios militares y casas.
  const outside: [number, number, number, number] = [1, 1, GRID_SIZE - 1, GRID_SIZE - 1];
  const outer: BuildingType[] = ['barracks', 'archeryRange', 'temple', 'inn', 'workshop', 'farm', 'lumberCamp', 'goldMine', 'house'];
  for (const type of outer) {
    const n = type === 'house' ? Math.max(1, maxCount(type, th) - 1) : maxCount(type, th);
    for (let i = 0; i < n; i++) tryPlace(type, outside, ring);
  }

  // Botín: una parte en el ayuntamiento y los almacenes, el resto en los productores.
  const total = 220 * Math.pow(th, 1.5);
  const stores = buildings.filter((b) => b.type === 'townHall' || b.type === 'storehouse');
  for (const r of RESOURCES) {
    const amount = Math.round(total * (0.8 + rand() * 0.4));
    const producers = buildings.filter((b) => producedResource(b.type) === r);
    const inProducers = producers.length ? amount * 0.4 : 0;
    for (const p of producers) p.loot[r] = Math.round(inProducers / producers.length);
    for (const s of stores) s.loot[r] = Math.round((amount - inProducers) / stores.length);
  }

  // Defensores
  const defenders: DefenderBase['defenders'] = [];
  const roles: MilitaryRole[] = ['warrior', 'archer', 'warrior', 'archer', 'healer', 'warrior', 'archer'];
  for (let i = 0; i < 1 + th; i++) {
    const role = th < 3 && roles[i] === 'healer' ? 'warrior' : roles[i % roles.length]!;
    const level = Math.max(1, Math.min(3, th - Math.floor(rand() * 2)));
    defenders.push({ name: pickName(rand), role, level });
  }

  return { name: `Aldea de ${pickName(rand)}`, townHall: th, buildings, defenders };
}

function pickName(rand: () => number): string {
  return VILLAGER_NAMES[Math.floor(rand() * VILLAGER_NAMES.length)] ?? 'Nadie';
}

/**
 * Convierte una aldea real en base atacable (para el PvP futuro y para
 * pruebas). El botín es una fracción de lo almacenado y lo acumulado.
 */
export function baseFromVillage(state: GameState, name: string, lootFraction = 0.2): DefenderBase {
  const buildings: BaseBuilding[] = [];
  const th = state.buildings.find((b) => b.type === 'townHall');
  for (const b of state.buildings) {
    if (b.level === 0) continue;
    const loot: Cost = {};
    const r = producedResource(b.type);
    if (r) loot[r] = Math.floor(b.stored * 0.5);
    if (b === th) for (const res of RESOURCES) loot[res] = Math.floor(state.resources[res] * lootFraction);
    buildings.push({ type: b.type, x: b.x, y: b.y, level: b.level, loot });
  }
  const defenders = state.villagers
    .filter((v) => v.role && v.role !== 'builder' && v.task.kind === 'idle')
    .map((v) => ({ name: v.name, role: v.role as MilitaryRole, level: v.roleLevel }));
  return { name, townHall: th?.level ?? 1, buildings, defenders };
}
