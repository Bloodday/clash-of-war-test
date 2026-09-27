import { BUILDING_DEFS, RECRUIT_COST, RESOURCES, ROLE_DEFS, TICK_RATE, type BuildingType, type Cost } from './data';
import {
  canAfford,
  countBuildings,
  currentLevelDef,
  getBuilding,
  getHousing,
  getIdleBuilders,
  getIncomingRecruits,
  getTownHallLevel,
  getTrainees,
  getVillager,
  collectableAmount,
  isAreaFree,
  isDamaged,
  isOperational,
  maxBuildings,
  producedResource,
  nextRoleLevel,
  roleMaxLevel,
} from './queries';
import { allocId, maxHp, type Building, type GameState } from './state';

// Toda modificación del estado pasa por un comando. Son objetos planos y
// serializables: hoy los ejecuta el cliente, mañana se enviarán al servidor
// autoritativo, que usará exactamente esta misma función para validarlos.

export type Command =
  | { type: 'placeBuilding'; building: BuildingType; x: number; y: number }
  | { type: 'moveBuilding'; buildingId: number; x: number; y: number }
  | { type: 'upgradeBuilding'; buildingId: number }
  | { type: 'collect'; buildingId: number }
  | { type: 'trainVillager'; villagerId: number; buildingId: number }
  | { type: 'recruitVillager'; buildingId: number };

export type CommandError =
  | 'invalidCommand'
  | 'unknownBuilding'
  | 'unknownVillager'
  | 'limitReached'
  | 'townHallTooLow'
  | 'cannotAfford'
  | 'areaBlocked'
  | 'noIdleBuilder'
  | 'busy'
  | 'maxLevel'
  | 'noFreeSlot'
  | 'damaged'
  | 'notProducer'
  | 'nothingToCollect'
  | 'storageFull'
  | 'notTrainingBuilding'
  | 'buildingLevelTooLow'
  | 'noHousing'
  | 'notInn'
  | 'roleLocked';

export type CommandResult = { ok: true } | { ok: false; error: CommandError };

const OK: CommandResult = { ok: true };
const fail = (error: CommandError): CommandResult => ({ ok: false, error });

function pay(state: GameState, cost: Cost): void {
  for (const r of RESOURCES) state.resources[r] -= cost[r] ?? 0;
}

const secondsToTicks = (s: number) => Math.round(s * TICK_RATE);

/** Arranca una obra (nueva o mejora) asignando un constructor libre. */
function startConstruction(state: GameState, b: Building, targetLevel: number): CommandResult {
  const levelDef = BUILDING_DEFS[b.type].levels[targetLevel - 1]!;
  const ticks = secondsToTicks(levelDef.buildSeconds);
  if (ticks === 0) {
    b.level = targetLevel;
    b.hp = maxHp(b);
    return OK;
  }
  const builder = getIdleBuilders(state)[0];
  if (!builder) return fail('noIdleBuilder');
  builder.task = { kind: 'build', buildingId: b.id };
  b.construction = { targetLevel, remainingTicks: ticks, totalTicks: ticks, builderId: builder.id };
  return OK;
}

/** Valida y ejecuta un comando. Si falla, el estado no se modifica. */
export function executeCommand(state: GameState, cmd: Command): CommandResult {
  switch (cmd.type) {
    case 'placeBuilding': {
      const def = BUILDING_DEFS[cmd.building];
      if (!def) return fail('unknownBuilding');
      if (countBuildings(state, cmd.building) >= maxBuildings(state, cmd.building)) return fail('limitReached');
      const first = def.levels[0]!;
      if (getTownHallLevel(state) < first.requiresTownHall) return fail('townHallTooLow');
      if (!canAfford(state, first.cost)) return fail('cannotAfford');
      if (!isAreaFree(state, cmd.x, cmd.y, def.size)) return fail('areaBlocked');
      if (first.buildSeconds > 0 && getIdleBuilders(state).length === 0) return fail('noIdleBuilder');

      const b: Building = {
        id: allocId(state),
        type: cmd.building,
        x: cmd.x,
        y: cmd.y,
        level: 0,
        construction: null,
        hp: first.hp,
        stored: 0,
        recruits: [],
      };
      state.buildings.push(b);
      pay(state, first.cost);
      return startConstruction(state, b, 1);
    }

    case 'moveBuilding': {
      const b = getBuilding(state, cmd.buildingId);
      if (!b) return fail('unknownBuilding');
      if (!isAreaFree(state, cmd.x, cmd.y, BUILDING_DEFS[b.type].size, b.id)) return fail('areaBlocked');
      b.x = cmd.x;
      b.y = cmd.y;
      return OK;
    }

    case 'upgradeBuilding': {
      const b = getBuilding(state, cmd.buildingId);
      if (!b) return fail('unknownBuilding');
      if (b.construction || getTrainees(state, b.id).length > 0) return fail('busy');
      if (isDamaged(b)) return fail('damaged');
      const def = BUILDING_DEFS[b.type];
      const next = def.levels[b.level];
      if (!next) return fail('maxLevel');
      // El ayuntamiento se limita a sí mismo por su nivel actual (requiresTownHall = nivel - 1).
      if (getTownHallLevel(state) < next.requiresTownHall) return fail('townHallTooLow');
      if (!canAfford(state, next.cost)) return fail('cannotAfford');
      if (next.buildSeconds > 0 && getIdleBuilders(state).length === 0) return fail('noIdleBuilder');
      pay(state, next.cost);
      return startConstruction(state, b, b.level + 1);
    }

    case 'collect': {
      const b = getBuilding(state, cmd.buildingId);
      if (!b) return fail('unknownBuilding');
      const r = producedResource(b.type);
      if (!r) return fail('notProducer');
      if (b.stored < 1) return fail('nothingToCollect');
      const amount = collectableAmount(state, b);
      if (amount < 1) return fail('storageFull');
      b.stored -= amount;
      state.resources[r] += amount;
      return OK;
    }

    case 'trainVillager': {
      const v = getVillager(state, cmd.villagerId);
      if (!v) return fail('unknownVillager');
      const b = getBuilding(state, cmd.buildingId);
      if (!b) return fail('unknownBuilding');
      const def = BUILDING_DEFS[b.type];
      const role = def.trainsRole;
      if (!role) return fail('notTrainingBuilding');
      if (!isOperational(b)) return fail('busy');
      if (v.task.kind !== 'idle') return fail('busy');
      // El oficio es para siempre: solo se forma a los aldeanos sin formar o se sube de nivel.
      if (v.role !== null && v.role !== role) return fail('roleLocked');
      const target = nextRoleLevel(v, role);
      if (target > roleMaxLevel(role)) return fail('maxLevel');
      if (b.level < target) return fail('buildingLevelTooLow');
      const slots = currentLevelDef(b)?.trainingSlots ?? 0;
      if (getTrainees(state, b.id).length >= slots) return fail('noFreeSlot');
      const levelDef = ROLE_DEFS[role].levels[target - 1]!;
      if (!canAfford(state, levelDef.cost)) return fail('cannotAfford');
      pay(state, levelDef.cost);
      const ticks = secondsToTicks(levelDef.trainSeconds);
      v.task = { kind: 'train', buildingId: b.id, role, targetLevel: target, remainingTicks: ticks, totalTicks: ticks };
      return OK;
    }

    case 'recruitVillager': {
      const b = getBuilding(state, cmd.buildingId);
      if (!b) return fail('unknownBuilding');
      const level = currentLevelDef(b);
      if (!level?.recruitSlots || !level.recruitSeconds) return fail('notInn');
      if (!isOperational(b)) return fail('busy');
      if (b.recruits.length >= level.recruitSlots) return fail('noFreeSlot');
      if (state.villagers.length + getIncomingRecruits(state) >= getHousing(state)) return fail('noHousing');
      if (!canAfford(state, RECRUIT_COST)) return fail('cannotAfford');
      pay(state, RECRUIT_COST);
      const ticks = secondsToTicks(level.recruitSeconds);
      b.recruits.push({ remainingTicks: ticks, totalTicks: ticks });
      return OK;
    }

    default:
      // Los comandos llegarán por red: nunca asumir que el tipo es válido.
      return fail('invalidCommand');
  }
}
