import { BUILDING_DEFS, MONSTER_DEFS, RESOURCES, ROLE_DEFS, type BuildingType, type Cost, type MonsterId, type ResourceId } from '../data';
import { freeBeds, getStorageCapacity } from '../queries';
import type { GameState } from '../state';
import { CAMP_STRUCTURES, levelScale, type DefenderBase } from './enemy';
import { CELL_BLOCKED, CELL_FREE, CELL_WALL, cellAt, cellIndex, createGrid, findPath, inGrid, type Grid } from './pathfinding';
import {
  BATTLE_SECONDS,
  BATTLE_TICK_RATE,
  type BattleBuilding,
  type BattleCommand,
  type BattleCommandResult,
  type BattleResult,
  type BattleState,
  type BattleUnit,
  type CampStructure,
  type MilitaryRole,
  type ProjectileKind,
  type ReserveUnit,
  type Side,
  type StructureAttack,
  type UnitKind,
} from './types';

// ---------------------------------------------------------------------------
// Balance de combate
// ---------------------------------------------------------------------------

interface CombatStats {
  speed: number; // celdas/s
  interval: number; // s entre ataques
  aggro: number; // radio en el que buscan enemigos (celdas)
  projectile?: ProjectileKind;
}

export const COMBAT: Record<MilitaryRole, CombatStats> = {
  warrior: { speed: 1.9, interval: 1.0, aggro: 5 },
  archer: { speed: 1.7, interval: 1.1, aggro: 7, projectile: 'bolt' },
  healer: { speed: 1.6, interval: 1.2, aggro: 7, projectile: 'heal' },
  catapult: { speed: 0.8, interval: 3.5, aggro: 12, projectile: 'boulder' },
};

/** Radio de daño en área (celdas) de las rocas de catapulta y de la magia. */
export const CATAPULT_SPLASH = 1.3;
export const MAGIC_SPLASH = 0.8;

export const isMonster = (k: UnitKind): k is MonsterId => k in MONSTER_DEFS;

/** Comportamiento de combate de una unidad (soldado o monstruo). */
interface Profile {
  aggro: number;
  projectile?: ProjectileKind;
  heals: boolean;
  buildingsOnly: boolean; // catapultas: solo atacan edificios
  splash: number;
}

function profile(role: UnitKind): Profile {
  if (isMonster(role)) {
    const d = MONSTER_DEFS[role];
    const magic = role === 'skeletonMage';
    return { aggro: d.aggro, projectile: d.ranged ? (magic ? 'magic' : 'bolt') : undefined, heals: false, buildingsOnly: false, splash: magic ? MAGIC_SPLASH : 0 };
  }
  const c = COMBAT[role];
  return {
    aggro: c.aggro,
    projectile: c.projectile,
    heals: role === 'healer',
    buildingsOnly: role === 'catapult',
    splash: role === 'catapult' ? CATAPULT_SPLASH : 0,
  };
}

/** Los ejércitos son pequeños (cada soldado es un aldeano): pegan fuerte a los edificios. */
export const BUILDING_DAMAGE_MULT = 3;
export const TOWER_INTERVAL = 1.0;
/** Distancia mínima a cualquier edificio para desplegar tropas (celdas). */
export const DEPLOY_MARGIN = 1;

const DT = 1 / BATTLE_TICK_RATE;
const UNIT_RADIUS = 0.3;
const PROJECTILE_SPEED: Record<ProjectileKind, number> = { arrow: 14, bolt: 16, heal: 10, boulder: 7, magic: 11 };

const secondsToTicks = (s: number) => Math.max(1, Math.round(s * BATTLE_TICK_RATE));

// ---------------------------------------------------------------------------
// Creación
// ---------------------------------------------------------------------------

/** Soldados de la aldea listos para ir a la batalla. */
export function availableArmy(state: GameState): ReserveUnit[] {
  return state.villagers
    .filter((v) => v.role && v.role !== 'builder' && v.task.kind === 'idle')
    .map((v) => ({ villagerId: v.id, name: v.name, role: v.role as MilitaryRole, level: v.roleLevel }));
}

function unitStats(role: UnitKind, level: number) {
  if (isMonster(role)) {
    const d = MONSTER_DEFS[role];
    const k = levelScale(level);
    return { hp: Math.round(d.hp * k), damage: Math.round(d.damage * k), range: d.range, speed: d.speed, interval: secondsToTicks(d.interval) };
  }
  const def = ROLE_DEFS[role].levels[Math.max(1, Math.min(level, ROLE_DEFS[role].levels.length)) - 1]!;
  const c = COMBAT[role];
  return { hp: def.hp, damage: def.damage, range: def.range, speed: c.speed, interval: secondsToTicks(c.interval) };
}

function makeUnit(
  b: BattleState,
  side: Side,
  role: UnitKind,
  level: number,
  name: string,
  x: number,
  y: number,
  villagerId: number | null,
): BattleUnit {
  const s = unitStats(role, level);
  const unit: BattleUnit = {
    id: b.nextId++,
    side,
    villagerId,
    name,
    role,
    level,
    x,
    y,
    facing: side === 'attacker' ? 0 : Math.PI,
    hp: s.hp,
    maxHp: s.hp,
    damage: s.damage,
    range: s.range,
    speed: s.speed,
    interval: s.interval,
    cooldown: 0,
    order: { kind: 'auto' },
    targetId: null,
    path: [],
    pathKey: '',
    repathIn: 0,
    state: 'idle',
    post: null,
    lastAttackTick: -1,
  };
  b.units.push(unit);
  return unit;
}

export function createBattle(base: DefenderBase, army: ReserveUnit[], campId: number | null = null): BattleState {
  const b: BattleState = {
    version: 1,
    tick: 0,
    nextId: 1,
    phase: 'scouting',
    kind: base.kind,
    campId,
    enemyName: base.name,
    enemyTownHall: base.townHall,
    timeLimitTicks: BATTLE_SECONDS * BATTLE_TICK_RATE,
    buildings: [],
    units: [],
    projectiles: [],
    reserve: army.map((u) => ({ ...u })),
    gridVersion: 0,
    stars: 0,
    destruction: 0,
    lootTaken: {},
    result: null,
    events: [],
  };
  for (const bb of base.buildings) {
    let size: number;
    let hp: number;
    let attack: StructureAttack | null = null;
    if (bb.type in CAMP_STRUCTURES) {
      const def = CAMP_STRUCTURES[bb.type as CampStructure];
      size = def.size;
      hp = Math.round(def.hp * levelScale(bb.level));
      if (def.attack) {
        attack = {
          damage: Math.round(def.attack.damage * levelScale(bb.level)),
          range: def.attack.range,
          interval: secondsToTicks(def.attack.interval),
          projectile: 'magic',
        };
      }
    } else {
      const def = BUILDING_DEFS[bb.type as BuildingType];
      const lvl = def.levels[Math.max(1, bb.level) - 1]!;
      size = def.size;
      hp = lvl.hp;
      if (lvl.damage && lvl.range) attack = { damage: lvl.damage, range: lvl.range, interval: secondsToTicks(TOWER_INTERVAL), projectile: 'arrow' };
    }
    b.buildings.push({
      id: b.nextId++,
      type: bb.type,
      level: bb.level,
      x: bb.x,
      y: bb.y,
      size,
      hp,
      maxHp: hp,
      loot: { ...bb.loot },
      cooldown: 0,
      attack,
      destroyed: false,
    });
  }
  // Defensores: de guardia en celdas libres alrededor del ayuntamiento.
  const grid = gridFor(b);
  const th = b.buildings.find((x) => x.type === 'townHall');
  const cx = th ? th.x + th.size / 2 : 20;
  const cy = th ? th.y + th.size / 2 : 20;
  const posts = freeCellsAround(grid, cx, cy, base.defenders.length, base.kind === 'camp' ? 1.5 : 3);
  base.defenders.forEach((d, i) => {
    const p = posts[i] ?? { x: cx, y: cy + 3 };
    const u = makeUnit(b, 'defender', d.role, d.level, d.name, p.x, p.y, null);
    u.post = { ...p };
  });
  return b;
}

/** Celdas libres más cercanas a un punto, separadas entre sí. */
function freeCellsAround(g: Grid, cx: number, cy: number, n: number, minDist = 3): { x: number; y: number }[] {
  const cells: { x: number; y: number; d: number }[] = [];
  for (let y = 0; y < g.size; y++)
    for (let x = 0; x < g.size; x++) {
      if (cellAt(g, x, y) !== CELL_FREE) continue;
      cells.push({ x: x + 0.5, y: y + 0.5, d: Math.hypot(x + 0.5 - cx, y + 0.5 - cy) + ((x * 7 + y * 13) % 5) * 0.05 });
    }
  cells.sort((a, b) => a.d - b.d);
  const out: { x: number; y: number }[] = [];
  for (const c of cells) {
    if (out.length >= n) break;
    if (c.d < minDist) continue;
    if (out.every((o) => Math.hypot(o.x - c.x, o.y - c.y) >= 1.2)) out.push({ x: c.x, y: c.y });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mapa de paso (derivado, se cachea por versión)
// ---------------------------------------------------------------------------

interface GridCache {
  version: number;
  grid: Grid;
  owner: Int32Array; // celda → id del edificio que la ocupa (-1 si libre)
}

const gridCache = new WeakMap<BattleState, GridCache>();

function cacheFor(b: BattleState): GridCache {
  let c = gridCache.get(b);
  if (c && c.version === b.gridVersion) return c;
  const grid = createGrid();
  const owner = new Int32Array(grid.size * grid.size).fill(-1);
  for (const bld of b.buildings) {
    if (bld.hp <= 0) continue;
    for (let y = bld.y; y < bld.y + bld.size; y++)
      for (let x = bld.x; x < bld.x + bld.size; x++) {
        if (!inGrid(grid, x, y)) continue;
        grid.cells[cellIndex(grid, x, y)] = bld.type === 'wall' ? CELL_WALL : CELL_BLOCKED;
        owner[cellIndex(grid, x, y)] = bld.id;
      }
  }
  c = { version: b.gridVersion, grid, owner };
  gridCache.set(b, c);
  return c;
}

const gridFor = (b: BattleState) => cacheFor(b).grid;

/** Distancia de un punto a la huella de un edificio (0 si está dentro). */
export function distToBuilding(x: number, y: number, bld: { x: number; y: number; size: number }): number {
  const dx = Math.max(bld.x - x, 0, x - (bld.x + bld.size));
  const dy = Math.max(bld.y - y, 0, y - (bld.y + bld.size));
  return Math.hypot(dx, dy);
}

/** ¿Se pueden desplegar tropas en este punto? (fuera de la zona roja alrededor de los edificios) */
export function canDeploy(b: BattleState, x: number, y: number): boolean {
  if (x < 0.3 || y < 0.3 || x > 39.7 || y > 39.7) return false;
  return b.buildings.every((bld) => bld.hp <= 0 || distToBuilding(x, y, bld) >= DEPLOY_MARGIN);
}

// ---------------------------------------------------------------------------
// Comandos
// ---------------------------------------------------------------------------

export function executeBattleCommand(b: BattleState, cmd: BattleCommand): BattleCommandResult {
  if (b.phase === 'ended') return { ok: false, error: 'ended' };
  switch (cmd.type) {
    case 'deploy': {
      const idx = b.reserve.findIndex((r) => r.villagerId === cmd.villagerId);
      if (idx < 0) return { ok: false, error: 'notInReserve' };
      if (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.y) || !canDeploy(b, cmd.x, cmd.y)) return { ok: false, error: 'forbiddenZone' };
      const r = b.reserve.splice(idx, 1)[0]!;
      const u = makeUnit(b, 'attacker', r.role, r.level, r.name, cmd.x, cmd.y, r.villagerId);
      if (b.phase === 'scouting') b.phase = 'fighting';
      b.events.push({ kind: 'deploy', unitId: u.id });
      return { ok: true, unitId: u.id };
    }
    case 'order': {
      const order = cmd.order;
      if (order.kind === 'attack') {
        const t = findTarget(b, order.targetId);
        if (!t || isDead(t)) return { ok: false, error: 'unknownTarget' };
      } else if (order.kind === 'move' && (!Number.isFinite(order.x) || !Number.isFinite(order.y))) {
        return { ok: false, error: 'invalidCommand' };
      } else if (order.kind !== 'move' && order.kind !== 'auto') {
        return { ok: false, error: 'invalidCommand' };
      }
      for (const id of cmd.unitIds) {
        const u = b.units.find((x) => x.id === id);
        if (!u || u.side !== 'attacker' || u.state === 'dead') continue;
        u.order = order.kind === 'move' ? { kind: 'move', x: clampMap(order.x), y: clampMap(order.y) } : { ...order };
        u.targetId = order.kind === 'attack' ? order.targetId : null;
        u.pathKey = '';
      }
      return { ok: true };
    }
    case 'surrender':
      endBattle(b, 'surrender');
      return { ok: true };
    default:
      return { ok: false, error: 'invalidCommand' };
  }
}

const clampMap = (v: number) => Math.min(39.6, Math.max(0.4, v));

// ---------------------------------------------------------------------------
// Simulación
// ---------------------------------------------------------------------------

type Target = { kind: 'unit'; unit: BattleUnit } | { kind: 'building'; bld: BattleBuilding };

function findTarget(b: BattleState, id: number | null): Target | null {
  if (id === null) return null;
  const unit = b.units.find((u) => u.id === id);
  if (unit) return { kind: 'unit', unit };
  const bld = b.buildings.find((x) => x.id === id);
  return bld ? { kind: 'building', bld } : null;
}

const isDead = (t: Target) => (t.kind === 'unit' ? t.unit.state === 'dead' : t.bld.hp <= 0);
const targetPos = (t: Target) =>
  t.kind === 'unit' ? { x: t.unit.x, y: t.unit.y } : { x: t.bld.x + t.bld.size / 2, y: t.bld.y + t.bld.size / 2 };
const distTo = (u: BattleUnit, t: Target) =>
  t.kind === 'unit' ? Math.hypot(t.unit.x - u.x, t.unit.y - u.y) : distToBuilding(u.x, u.y, t.bld);

/** Avanza la batalla un tick (1/20 s). En fase de reconocimiento no pasa nada. */
export function stepBattle(b: BattleState): void {
  b.events = [];
  if (b.phase !== 'fighting') return;
  b.tick++;

  for (const u of b.units) if (u.state !== 'dead') updateUnit(b, u);
  for (const bld of b.buildings) if (bld.hp > 0 && bld.attack) updateTower(b, bld);
  updateProjectiles(b);
  separate(b);
  resolveDeaths(b);

  const attackers = b.units.filter((u) => u.side === 'attacker' && u.state !== 'dead');
  if (b.destruction >= 1) endBattle(b, 'destroyed');
  else if (b.tick >= b.timeLimitTicks) endBattle(b, 'time');
  else if (b.reserve.length === 0 && !attackers.some((u) => u.role !== 'healer')) endBattle(b, 'noTroops');
}

function updateUnit(b: BattleState, u: BattleUnit): void {
  if (u.cooldown > 0) u.cooldown--;
  if (u.repathIn > 0) u.repathIn--;

  // Orden de movimiento: ir al punto y después volver a actuar solo.
  if (u.order.kind === 'move') {
    const goal = u.order;
    if (Math.hypot(goal.x - u.x, goal.y - u.y) < 0.35) {
      u.order = { kind: 'auto' };
      u.state = 'idle';
      return;
    }
    moveTo(b, u, { kind: 'point', x: goal.x, y: goal.y }, `p${goal.x.toFixed(1)},${goal.y.toFixed(1)}`);
    return;
  }

  const target = chooseTarget(b, u);
  u.targetId = target ? (target.kind === 'unit' ? target.unit.id : target.bld.id) : null;
  if (!target) {
    if (u.side === 'defender' && u.post && Math.hypot(u.post.x - u.x, u.post.y - u.y) > 0.4) {
      moveTo(b, u, { kind: 'point', x: u.post.x, y: u.post.y }, 'post');
    } else if (profile(u.role).heals) {
      followAllies(b, u);
    } else {
      u.state = 'idle';
    }
    return;
  }

  const reach = target.kind === 'building' ? u.range + 0.35 : u.range + UNIT_RADIUS;
  if (distTo(u, target) <= reach) {
    attack(b, u, target);
  } else {
    const key = target.kind === 'unit' ? `u${target.unit.id}` : `b${target.bld.id}`;
    moveTo(b, u, target.kind === 'unit' ? { kind: 'unit', unit: target.unit, range: u.range } : { kind: 'building', bld: target.bld, range: u.range }, key);
  }
}

function enemiesOf(b: BattleState, u: BattleUnit) {
  return b.units.filter((o) => o.side !== u.side && o.state !== 'dead');
}

function chooseTarget(b: BattleState, u: BattleUnit): Target | null {
  // Orden explícita de ataque.
  if (u.order.kind === 'attack') {
    const t = findTarget(b, u.order.targetId);
    if (t && !isDead(t)) return t;
    u.order = { kind: 'auto' };
  }

  const prof = profile(u.role);
  if (prof.heals) {
    const hurt = b.units
      .filter((o) => o.side === u.side && o.state !== 'dead' && o.id !== u.id && o.hp < o.maxHp)
      .filter((o) => Math.hypot(o.x - u.x, o.y - u.y) <= prof.aggro)
      .sort((a, c) => a.hp / a.maxHp - c.hp / c.maxHp || a.id - c.id)[0];
    return hurt ? { kind: 'unit', unit: hurt } : null;
  }

  const aggro = prof.aggro;
  // Las catapultas solo disparan a edificios: el más cercano que no sea un muro.
  if (prof.buildingsOnly) {
    const current = findTarget(b, u.targetId);
    if (current && current.kind === 'building' && !isDead(current)) return current;
    const bld = b.buildings
      .filter((x) => x.hp > 0 && x.type !== 'wall')
      .sort((a, c) => distToBuilding(u.x, u.y, a) - distToBuilding(u.x, u.y, c) || a.id - c.id)[0];
    return bld ? { kind: 'building', bld } : null;
  }
  // Mantener el objetivo actual mientras siga siendo válido (evita cambiar a cada paso).
  const current = findTarget(b, u.targetId);
  if (current && !isDead(current)) {
    if (current.kind === 'building') {
      const closeEnemy = nearestEnemy(b, u, Math.min(3, aggro));
      return closeEnemy ? { kind: 'unit', unit: closeEnemy } : current;
    }
    if (distTo(u, current) <= aggro * 1.5) return current;
  }

  if (u.side === 'defender') {
    const origin = u.post ?? u;
    const threat = enemiesOf(b, u)
      .filter((e) => Math.hypot(e.x - u.x, e.y - u.y) <= aggro || Math.hypot(e.x - origin.x, e.y - origin.y) <= aggro + 2)
      .sort((a, c) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(c.x - u.x, c.y - u.y) || a.id - c.id)[0];
    return threat ? { kind: 'unit', unit: threat } : null;
  }

  const enemy = nearestEnemy(b, u, aggro);
  if (enemy) return { kind: 'unit', unit: enemy };
  const bld = b.buildings
    .filter((x) => x.hp > 0 && x.type !== 'wall')
    .sort((a, c) => distToBuilding(u.x, u.y, a) - distToBuilding(u.x, u.y, c) || a.id - c.id)[0];
  return bld ? { kind: 'building', bld } : null;
}

function nearestEnemy(b: BattleState, u: BattleUnit, radius: number): BattleUnit | undefined {
  return enemiesOf(b, u)
    .filter((e) => Math.hypot(e.x - u.x, e.y - u.y) <= radius)
    .sort((a, c) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(c.x - u.x, c.y - u.y) || a.id - c.id)[0];
}

/** Los sanadores sin nadie a quien curar siguen al aliado más cercano. */
function followAllies(b: BattleState, u: BattleUnit): void {
  const ally = b.units
    .filter((o) => o.side === u.side && o.state !== 'dead' && o.id !== u.id && o.role !== 'healer')
    .sort((a, c) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(c.x - u.x, c.y - u.y) || a.id - c.id)[0];
  if (!ally || Math.hypot(ally.x - u.x, ally.y - u.y) < 2) {
    u.state = 'idle';
    return;
  }
  moveTo(b, u, { kind: 'unit', unit: ally, range: 1.5 }, `f${ally.id}`);
}

type Goal =
  | { kind: 'point'; x: number; y: number }
  | { kind: 'unit'; unit: BattleUnit; range: number }
  | { kind: 'building'; bld: BattleBuilding; range: number };

function moveTo(b: BattleState, u: BattleUnit, goal: Goal, key: string): void {
  const cache = cacheFor(b);
  const g = cache.grid;
  const fullKey = `${key}:${b.gridVersion}`;
  const moving = goal.kind === 'unit';
  if (u.pathKey !== fullKey || (moving && u.repathIn <= 0) || u.path.length === 0) {
    const sx = Math.floor(u.x);
    const sy = Math.floor(u.y);
    let isGoal: (x: number, y: number) => boolean;
    let h: (x: number, y: number) => number;
    if (goal.kind === 'point') {
      const gx = Math.floor(goal.x);
      const gy = Math.floor(goal.y);
      isGoal = (x, y) => (x === gx && y === gy) || (cellAt(g, gx, gy) !== CELL_FREE && Math.abs(x - gx) <= 1 && Math.abs(y - gy) <= 1 && cellAt(g, x, y) === CELL_FREE);
      h = (x, y) => Math.hypot(x - gx, y - gy);
    } else if (goal.kind === 'unit') {
      const tx = goal.unit.x;
      const ty = goal.unit.y;
      const r = Math.max(0.5, goal.range);
      isGoal = (x, y) => cellAt(g, x, y) === CELL_FREE && Math.hypot(x + 0.5 - tx, y + 0.5 - ty) <= r;
      h = (x, y) => Math.max(0, Math.hypot(x + 0.5 - tx, y + 0.5 - ty) - r);
    } else {
      const bld = goal.bld;
      const r = goal.range + 0.3;
      // Un muro también vale como destino: si el objetivo está pegado a su muralla,
      // la unidad llega al muro, lo rompe (ver más abajo) y después sigue.
      isGoal = (x, y) => cellAt(g, x, y) !== CELL_BLOCKED && distToBuilding(x + 0.5, y + 0.5, bld) <= r;
      h = (x, y) => Math.max(0, distToBuilding(x + 0.5, y + 0.5, bld) - r);
    }
    u.path = findPath(g, sx, sy, isGoal, h) ?? [];
    u.pathKey = fullKey;
    u.repathIn = moving ? secondsToTicks(0.5) : secondsToTicks(3);
  }

  // Si el siguiente paso es un muro en pie, hay que abrir brecha.
  const next = u.path[0];
  if (next) {
    const idx = cellIndex(g, next.x, next.y);
    if (g.cells[idx] === CELL_WALL) {
      const wall = b.buildings.find((x) => x.id === cache.owner[idx]);
      if (wall && wall.hp > 0) {
        if (distToBuilding(u.x, u.y, wall) <= u.range + 0.35) {
          if (!profile(u.role).heals) attack(b, u, { kind: 'building', bld: wall });
          else u.state = 'idle';
          return;
        }
      }
    }
  }

  const wp = next ? { x: next.x + 0.5, y: next.y + 0.5 } : goal.kind === 'point' ? goal : goal.kind === 'unit' ? goal.unit : null;
  if (!wp) {
    u.state = 'idle';
    return;
  }
  const dx = wp.x - u.x;
  const dy = wp.y - u.y;
  const d = Math.hypot(dx, dy);
  const step = u.speed * DT;
  // Los puntos intermedios se dan por alcanzados a media celda: si varias unidades
  // comparten camino, la separación les impediría llegar al centro exacto y se atascarían.
  const last = u.path.length <= 1;
  if (!last && d <= Math.max(step, 0.5)) {
    u.path.shift();
  } else if (d <= step) {
    u.x = wp.x;
    u.y = wp.y;
    if (next) u.path.shift();
  } else {
    u.x += (dx / d) * step;
    u.y += (dy / d) * step;
  }
  if (d > 1e-4) u.facing = Math.atan2(dx, dy);
  u.state = 'moving';
}

function attack(b: BattleState, u: BattleUnit, t: Target): void {
  const p = targetPos(t);
  u.facing = Math.atan2(p.x - u.x, p.y - u.y);
  u.state = 'attacking';
  if (u.cooldown > 0) return;
  u.cooldown = u.interval;
  u.lastAttackTick = b.tick;
  const targetId = t.kind === 'unit' ? t.unit.id : t.bld.id;
  const prof = profile(u.role);
  if (!prof.projectile) {
    applyHit(b, t, u.damage, u.id, true);
    return;
  }
  spawnProjectile(b, prof.projectile, u.x, u.y, u.role === 'catapult' ? 0.9 : 0.5, targetId, u.damage, u.side, u.id, prof.splash);
}

function spawnProjectile(
  b: BattleState,
  kind: ProjectileKind,
  x: number,
  y: number,
  height: number,
  targetId: number,
  amount: number,
  side: Side,
  sourceId: number,
  splash = 0,
): void {
  const id = b.nextId++;
  b.projectiles.push({ id, kind, x, y, sx: x, sy: y, height, targetId, speed: PROJECTILE_SPEED[kind], amount, splash, side });
  b.events.push({ kind: 'shoot', sourceId, projectileId: id });
}

function applyHit(b: BattleState, t: Target, amount: number, sourceId: number, melee: boolean): void {
  if (t.kind === 'unit') {
    t.unit.hp -= amount;
    b.events.push({ kind: 'hit', targetId: t.unit.id, sourceId, amount, melee });
  } else {
    const dmg = amount * BUILDING_DAMAGE_MULT;
    t.bld.hp -= dmg;
    b.events.push({ kind: 'hit', targetId: t.bld.id, sourceId, amount: dmg, melee });
  }
}

function updateTower(b: BattleState, bld: BattleBuilding): void {
  if (bld.cooldown > 0) {
    bld.cooldown--;
    return;
  }
  const atk = bld.attack!;
  const cx = bld.x + bld.size / 2;
  const cy = bld.y + bld.size / 2;
  const target = b.units
    .filter((u) => u.side === 'attacker' && u.state !== 'dead')
    .map((u) => ({ u, d: Math.hypot(u.x - cx, u.y - cy) }))
    .filter((e) => e.d <= atk.range + bld.size / 2)
    .sort((a, c) => a.d - c.d || a.u.id - c.u.id)[0];
  if (!target) return;
  bld.cooldown = atk.interval;
  const height = bld.type === 'archerTower' ? 2.6 : 1.4;
  spawnProjectile(b, atk.projectile, cx, cy, height, target.u.id, atk.damage, 'defender', bld.id, atk.projectile === 'magic' ? MAGIC_SPLASH : 0);
}

function updateProjectiles(b: BattleState): void {
  b.projectiles = b.projectiles.filter((p) => {
    const t = findTarget(b, p.targetId);
    if (!t || isDead(t)) return false;
    const pos = targetPos(t);
    const dx = pos.x - p.x;
    const dy = pos.y - p.y;
    const d = Math.hypot(dx, dy);
    const step = p.speed * DT;
    const reach = t.kind === 'building' ? Math.max(0.3, t.bld.size / 2 - 0.2) : 0.25;
    if (d <= step + reach) {
      if (p.kind === 'heal') {
        if (t.kind === 'unit') {
          const healed = Math.min(p.amount, t.unit.maxHp - t.unit.hp);
          t.unit.hp += healed;
          b.events.push({ kind: 'heal', targetId: t.unit.id, amount: healed });
        }
      } else {
        applyHit(b, t, p.amount, p.id, false);
        if (p.splash > 0) splashDamage(b, p, pos.x, pos.y, t);
      }
      return false;
    }
    p.x += (dx / d) * step;
    p.y += (dy / d) * step;
    return true;
  });
}

/** Daño en área alrededor del impacto (a la mitad), sin repetir el objetivo principal. */
function splashDamage(b: BattleState, p: { amount: number; splash: number; side: Side; id: number }, x: number, y: number, main: Target): void {
  const half = p.amount * 0.5;
  for (const u of b.units) {
    if (u.side === p.side || u.state === 'dead' || (main.kind === 'unit' && main.unit === u)) continue;
    if (Math.hypot(u.x - x, u.y - y) <= p.splash) applyHit(b, { kind: 'unit', unit: u }, half, p.id, false);
  }
  if (p.side === 'attacker') {
    for (const bld of b.buildings) {
      if (bld.hp <= 0 || (main.kind === 'building' && main.bld === bld)) continue;
      if (distToBuilding(x, y, bld) <= p.splash) applyHit(b, { kind: 'building', bld }, half, p.id, false);
    }
  }
  b.events.push({ kind: 'impact', x, y, radius: p.splash });
}

/** Evita que las unidades se amontonen en el mismo punto. */
function separate(b: BattleState): void {
  const g = gridFor(b);
  const alive = b.units.filter((u) => u.state !== 'dead');
  const minDist = UNIT_RADIUS * 2;
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i]!;
      const c = alive[j]!;
      let dx = c.x - a.x;
      let dy = c.y - a.y;
      let d = Math.hypot(dx, dy);
      if (d >= minDist) continue;
      if (d < 1e-4) {
        // Separación determinista si coinciden exactamente.
        dx = ((a.id * 31 + c.id * 17) % 7) - 3 || 1;
        dy = ((a.id * 13 + c.id * 29) % 7) - 3;
        d = Math.hypot(dx, dy);
      }
      const push = (minDist - d) / 2;
      nudge(g, a, (-dx / d) * push, (-dy / d) * push);
      nudge(g, c, (dx / d) * push, (dy / d) * push);
    }
  }
}

function nudge(g: Grid, u: BattleUnit, dx: number, dy: number): void {
  const nx = Math.min(39.7, Math.max(0.3, u.x + dx));
  const ny = Math.min(39.7, Math.max(0.3, u.y + dy));
  if (cellAt(g, Math.floor(nx), Math.floor(u.y)) === CELL_FREE) u.x = nx;
  if (cellAt(g, Math.floor(u.x), Math.floor(ny)) === CELL_FREE) u.y = ny;
}

function resolveDeaths(b: BattleState): void {
  let changed = false;
  for (const u of b.units) {
    if (u.state !== 'dead' && u.hp <= 0) {
      u.hp = 0;
      u.state = 'dead';
      u.path = [];
      // Los monstruos sueltan botín al caer.
      const loot: Cost = {};
      if (isMonster(u.role)) {
        for (const [r, amount] of Object.entries(MONSTER_DEFS[u.role].loot) as [ResourceId, number][]) {
          loot[r] = Math.round(amount * levelScale(u.level));
          b.lootTaken[r] = (b.lootTaken[r] ?? 0) + loot[r]!;
        }
        changed = true;
      }
      b.events.push({ kind: 'death', unitId: u.id, loot });
    }
  }
  for (const bld of b.buildings) {
    if (bld.destroyed || bld.hp > 0) continue;
    bld.destroyed = true;
    bld.hp = 0;
    changed = true;
    for (const r of RESOURCES) {
      const amount = bld.loot[r] ?? 0;
      if (amount > 0) b.lootTaken[r] = (b.lootTaken[r] ?? 0) + amount;
    }
    b.events.push({ kind: 'destroyed', buildingId: bld.id, loot: { ...bld.loot } });
  }
  if (!changed) return;
  b.gridVersion++;
  const counted = b.buildings.filter((x) => x.type !== 'wall');
  let total = counted.length;
  let done = counted.filter((x) => x.destroyed).length;
  let objective: boolean;
  if (b.kind === 'camp') {
    // En los campamentos cuentan también los monstruos; la 2.ª estrella es acabar con todos.
    const monsters = b.units.filter((u) => u.side === 'defender');
    total += monsters.length;
    done += monsters.filter((u) => u.state === 'dead').length;
    objective = monsters.every((u) => u.state === 'dead');
  } else {
    objective = b.buildings.some((x) => x.type === 'townHall' && x.destroyed);
  }
  b.destruction = total ? done / total : 1;
  const stars = (b.destruction >= 0.5 ? 1 : 0) + (objective ? 1 : 0) + (b.destruction >= 1 ? 1 : 0);
  if (stars > b.stars) {
    b.stars = stars;
    b.events.push({ kind: 'star', stars });
  }
}

function endBattle(b: BattleState, reason: BattleResult['reason']): void {
  if (b.phase === 'ended') return;
  b.phase = 'ended';
  const attackers = b.units.filter((u) => u.side === 'attacker');
  b.result = {
    stars: b.stars,
    destruction: b.destruction,
    loot: { ...b.lootTaken },
    fallen: attackers.filter((u) => u.state === 'dead' && u.villagerId !== null).map((u) => u.villagerId!),
    survivors: [
      ...attackers.filter((u) => u.state !== 'dead' && u.villagerId !== null).map((u) => u.villagerId!),
      ...b.reserve.map((r) => r.villagerId),
    ],
    reason,
    kind: b.kind,
    campId: b.campId,
    cleared: b.kind === 'camp' && b.units.filter((u) => u.side === 'defender').every((u) => u.state === 'dead'),
  };
  b.events.push({ kind: 'end' });
}

// ---------------------------------------------------------------------------
// Vuelta a la aldea
// ---------------------------------------------------------------------------

/**
 * Aplica el resultado a la aldea del atacante: suma el botín (hasta llenar
 * los almacenes) y reparte a los caídos en las camas de las enfermerías,
 * primero los de más nivel. Los que no caben mueren y dejan la aldea.
 * Si era un campamento y se acabó con todos los monstruos, desaparece.
 */
export function applyBattleResult(
  state: GameState,
  result: BattleResult,
): { gained: Record<ResourceId, number>; wounded: number[]; dead: number[] } {
  const cap = getStorageCapacity(state);
  const gained: Record<ResourceId, number> = { gold: 0, wood: 0, food: 0 };
  for (const r of RESOURCES) {
    const amount = Math.floor(result.loot[r] ?? 0);
    const room = Math.max(0, cap[r] - state.resources[r]);
    gained[r] = Math.min(amount, room);
    state.resources[r] += gained[r];
  }

  const fallen = result.fallen
    .map((id) => state.villagers.find((v) => v.id === id))
    .filter((v): v is NonNullable<typeof v> => !!v)
    .sort((a, c) => c.roleLevel - a.roleLevel || a.id - c.id);
  const infirmaries = state.buildings.filter((b) => b.type === 'infirmary').sort((a, c) => a.id - c.id);
  const wounded: number[] = [];
  const dead: number[] = [];
  for (const v of fallen) {
    const bed = infirmaries.find((b) => freeBeds(state, b) > 0);
    if (bed) {
      v.task = { kind: 'wounded', infirmaryId: bed.id };
      wounded.push(v.id);
    } else {
      dead.push(v.id);
    }
  }
  if (dead.length) state.villagers = state.villagers.filter((v) => !dead.includes(v.id));

  if (result.kind === 'camp' && result.cleared && result.campId !== null) {
    state.camps = state.camps.filter((c) => c.id !== result.campId);
  }
  return { gained, wounded, dead };
}
