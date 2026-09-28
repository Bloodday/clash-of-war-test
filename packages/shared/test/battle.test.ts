import { describe, expect, it } from 'vitest';
import {
  BATTLE_TICK_RATE,
  BUILDING_DEFS,
  TICK_RATE,
  WALL_COST,
  applyBattleResult,
  availableArmy,
  baseLoot,
  canDeploy,
  createBattle,
  createInitialState,
  executeBattleCommand,
  executeCommand,
  findPath,
  generateEnemyBase,
  generateMonsterCamp,
  healCost,
  healTicks,
  maxBuildings,
  spawnCamp,
  structureSize,
  stepBattle,
  tick,
  CAMP_SPAWN_SECONDS,
  MAX_CAMPS,
  type BattleResult,
  type BattleState,
  type DefenderBase,
  type ReserveUnit,
} from '../src';
import { CELL_BLOCKED, CELL_WALL, cellIndex, createGrid } from '../src/battle/pathfinding';
import type { GameState, Villager } from '../src';

const run = (b: BattleState, seconds: number) => {
  for (let i = 0; i < seconds * BATTLE_TICK_RATE && b.phase !== 'ended'; i++) stepBattle(b);
};

const army = (...roles: ReserveUnit['role'][]): ReserveUnit[] =>
  roles.map((role, i) => ({ villagerId: 100 + i, name: `S${i}`, role, level: 1 }));

const base = (buildings: DefenderBase['buildings'], defenders: DefenderBase['defenders'] = []): DefenderBase => ({
  kind: 'village',
  name: 'Prueba',
  townHall: 1,
  buildings,
  defenders,
});

describe('búsqueda de caminos', () => {
  it('rodea los edificios', () => {
    const g = createGrid();
    for (let y = 5; y < 15; y++) g.cells[cellIndex(g, 10, y)] = CELL_BLOCKED;
    const path = findPath(g, 8, 10, (x, y) => x === 12 && y === 10, (x, y) => Math.hypot(x - 12, y - 10))!;
    expect(path.at(-1)).toEqual({ x: 12, y: 10 });
    expect(path.some((p) => p.x === 10)).toBe(true);
    expect(path.every((p) => g.cells[cellIndex(g, p.x, p.y)] !== CELL_BLOCKED)).toBe(true);
  });

  it('atraviesa un muro solo si rodearlo sale más caro', () => {
    const g = createGrid();
    // Anillo cerrado de muros alrededor del objetivo.
    for (let i = 15; i <= 25; i++) {
      for (const [x, y] of [[i, 15], [i, 25], [15, i], [25, i]] as const) g.cells[cellIndex(g, x, y)] = CELL_WALL;
    }
    const path = findPath(g, 5, 20, (x, y) => x === 20 && y === 20, (x, y) => Math.hypot(x - 20, y - 20))!;
    const walls = path.filter((p) => g.cells[cellIndex(g, p.x, p.y)] === CELL_WALL);
    expect(walls).toHaveLength(1);

    // Con un hueco cerca, lo usa en vez de romper.
    g.cells[cellIndex(g, 15, 21)] = 0;
    const around = findPath(g, 5, 20, (x, y) => x === 20 && y === 20, (x, y) => Math.hypot(x - 20, y - 20))!;
    expect(around.some((p) => g.cells[cellIndex(g, p.x, p.y)] === CELL_WALL)).toBe(false);
    expect(WALL_COST).toBeGreaterThan(5);
  });
});

describe('generador de aldeas enemigas', () => {
  it('es determinista y respeta los límites por nivel', () => {
    for (const th of [1, 2, 3]) {
      const a = generateEnemyBase(42, th);
      expect(generateEnemyBase(42, th)).toEqual(a);
      expect(a.buildings.filter((b) => b.type === 'townHall')).toHaveLength(1);
      const s = createInitialState();
      s.buildings[0]!.level = th; // ayuntamiento del nivel pedido
      for (const type of ['wall', 'archerTower', 'farm'] as const) {
        expect(a.buildings.filter((b) => b.type === type).length).toBeLessThanOrEqual(maxBuildings(s, type));
      }
      expect(a.defenders.length).toBe(1 + th);
      expect(baseLoot(a).gold).toBeGreaterThan(0);
    }
  });

  it('no solapa edificios', () => {
    const a = generateEnemyBase(7, 3);
    const seen = new Set<string>();
    for (const b of a.buildings) {
      const size = structureSize(b.type);
      for (let y = b.y; y < b.y + size; y++)
        for (let x = b.x; x < b.x + size; x++) {
          const key = `${x},${y}`;
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
    }
  });
});

describe('batalla', () => {
  it('empieza en reconocimiento y el primer despliegue la arranca', () => {
    const b = createBattle(base([{ type: 'house', x: 20, y: 20, level: 1, loot: {} }]), army('warrior'));
    expect(b.phase).toBe('scouting');
    stepBattle(b);
    expect(b.tick).toBe(0); // en reconocimiento no corre el tiempo
    expect(executeBattleCommand(b, { type: 'deploy', villagerId: 100, x: 20.5, y: 20.5 })).toEqual({
      ok: false,
      error: 'forbiddenZone',
    });
    expect(canDeploy(b, 22.5, 20.5)).toBe(false); // pegado al edificio
    expect(executeBattleCommand(b, { type: 'deploy', villagerId: 100, x: 5, y: 5 }).ok).toBe(true);
    expect(b.phase).toBe('fighting');
    expect(b.reserve).toHaveLength(0);
    expect(executeBattleCommand(b, { type: 'deploy', villagerId: 100, x: 5, y: 5 })).toEqual({ ok: false, error: 'notInReserve' });
  });

  it('los guerreros destruyen una aldea indefensa y se llevan el botín', () => {
    const b = createBattle(
      base([
        { type: 'house', x: 20, y: 20, level: 1, loot: { gold: 50 } },
        { type: 'farm', x: 10, y: 10, level: 1, loot: { food: 80 } },
      ]),
      army('warrior', 'warrior'),
    );
    executeBattleCommand(b, { type: 'deploy', villagerId: 100, x: 3, y: 3 });
    executeBattleCommand(b, { type: 'deploy', villagerId: 101, x: 36, y: 36 });
    run(b, 120);
    expect(b.phase).toBe('ended');
    expect(b.result!.reason).toBe('destroyed');
    expect(b.destruction).toBe(1);
    expect(b.stars).toBe(2); // 50 % y 100 % (no hay ayuntamiento)
    expect(b.result!.loot).toEqual({ gold: 50, food: 80 });
    expect(b.result!.fallen).toEqual([]);
    expect(b.result!.survivors.sort()).toEqual([100, 101]);
  });

  it('una torre acaba con un guerrero solitario', () => {
    const b = createBattle(base([{ type: 'archerTower', x: 20, y: 20, level: 3, loot: {} }]), army('warrior'));
    executeBattleCommand(b, { type: 'deploy', villagerId: 100, x: 12, y: 21 });
    run(b, 60);
    expect(b.phase).toBe('ended');
    expect(b.result!.reason).toBe('noTroops');
    expect(b.result!.fallen).toEqual([100]);
    expect(b.buildings[0]!.hp).toBeLessThan(b.buildings[0]!.maxHp);
  });

  it('rompe los muros si el objetivo está encerrado', () => {
    const walls: DefenderBase['buildings'] = [];
    for (let i = 16; i <= 23; i++)
      for (const [x, y] of [[i, 16], [i, 23], [16, i], [23, i]] as const) {
        if (!walls.some((w) => w.x === x && w.y === y)) walls.push({ type: 'wall', x, y, level: 1, loot: {} });
      }
    const b = createBattle(base([{ type: 'townHall', x: 18, y: 18, level: 1, loot: {} }, ...walls]), army('warrior', 'warrior', 'warrior'));
    for (const id of [100, 101, 102]) executeBattleCommand(b, { type: 'deploy', villagerId: id, x: 5, y: 19.5 + (id - 100) * 0.6 });
    run(b, 170);
    const brokenWalls = b.buildings.filter((x) => x.type === 'wall' && x.destroyed);
    expect(brokenWalls.length).toBeGreaterThanOrEqual(1);
    expect(b.buildings.find((x) => x.type === 'townHall')!.destroyed).toBe(true);
    expect(b.stars).toBe(3);
  });

  it('llega a un objetivo pegado a su muralla rompiendo el muro', () => {
    // Ayuntamiento 18..21 con el anillo de muros justo alrededor (17..22): no hay celdas libres al lado.
    const walls: DefenderBase['buildings'] = [];
    for (let i = 17; i <= 22; i++)
      for (const [x, y] of [[i, 17], [i, 22], [17, i], [22, i]] as const) {
        if (!walls.some((w) => w.x === x && w.y === y)) walls.push({ type: 'wall', x, y, level: 1, loot: {} });
      }
    const b = createBattle(base([{ type: 'townHall', x: 18, y: 18, level: 1, loot: {} }, ...walls]), army('warrior', 'warrior'));
    executeBattleCommand(b, { type: 'deploy', villagerId: 100, x: 5, y: 19.5 });
    executeBattleCommand(b, { type: 'deploy', villagerId: 101, x: 5, y: 20.5 });
    run(b, 175);
    expect(b.buildings.find((x) => x.type === 'townHall')!.destroyed).toBe(true);
  });

  it('los defensores atacan a los invasores y los sanadores curan', () => {
    const b = createBattle(base([{ type: 'townHall', x: 18, y: 18, level: 1, loot: {} }], [{ name: 'Guardia', role: 'warrior', level: 1 }]), army('warrior', 'healer'));
    const defender = b.units.find((u) => u.side === 'defender')!;
    // Primer punto desplegable al este del guardia (fuera de la zona roja del ayuntamiento).
    let x = defender.x + 3;
    while (!canDeploy(b, x, defender.y)) x += 0.5;
    expect(executeBattleCommand(b, { type: 'deploy', villagerId: 100, x, y: defender.y }).ok).toBe(true);
    expect(executeBattleCommand(b, { type: 'deploy', villagerId: 101, x: x + 1.5, y: defender.y }).ok).toBe(true);
    let healed = 0;
    for (let i = 0; i < 20 * BATTLE_TICK_RATE && b.phase !== 'ended'; i++) {
      stepBattle(b);
      for (const e of b.events) if (e.kind === 'heal') healed += e.amount;
    }
    expect(defender.state).toBe('dead');
    expect(healed).toBeGreaterThan(0);
  });

  it('obedece órdenes de movimiento y luego vuelve a actuar solo', () => {
    const b = createBattle(base([{ type: 'house', x: 30, y: 30, level: 1, loot: {} }]), army('archer'));
    const res = executeBattleCommand(b, { type: 'deploy', villagerId: 100, x: 3, y: 3 });
    const unit = b.units.find((u) => u.id === (res as { unitId: number }).unitId)!;
    executeBattleCommand(b, { type: 'order', unitIds: [unit.id], order: { kind: 'move', x: 10, y: 3 } });
    let ticks = 0;
    while (unit.order.kind === 'move' && ticks++ < 10 * BATTLE_TICK_RATE) stepBattle(b);
    // Llega al punto (≈7 celdas a 1,7 celdas/s) y solo entonces vuelve a actuar solo.
    expect(ticks / BATTLE_TICK_RATE).toBeLessThan(6);
    expect(Math.hypot(unit.x - 10, unit.y - 3)).toBeLessThan(0.4);
    run(b, 60);
    expect(b.buildings[0]!.destroyed).toBe(true);
  });

  it('termina al acabarse el tiempo y al rendirse', () => {
    const b = createBattle(base([{ type: 'townHall', x: 18, y: 18, level: 5, loot: {} }]), army('healer', 'warrior'));
    executeBattleCommand(b, { type: 'deploy', villagerId: 100, x: 3, y: 3 });
    b.timeLimitTicks = 5 * BATTLE_TICK_RATE;
    run(b, 10);
    expect(b.result!.reason).toBe('time');
    expect(b.result!.survivors.sort()).toEqual([100, 101]);

    const c = createBattle(base([{ type: 'house', x: 20, y: 20, level: 1, loot: {} }]), army('warrior'));
    expect(executeBattleCommand(c, { type: 'surrender' })).toEqual({ ok: true });
    expect(c.result!.reason).toBe('surrender');
    expect(executeBattleCommand(c, { type: 'deploy', villagerId: 100, x: 3, y: 3 })).toEqual({ ok: false, error: 'ended' });
  });

  it('es determinista', () => {
    const play = () => {
      const b = createBattle(generateEnemyBase(9, 2), army('warrior', 'archer', 'warrior', 'healer'));
      [[2, 2], [2, 3], [37, 37], [3, 37]].forEach(([x, y], i) => executeBattleCommand(b, { type: 'deploy', villagerId: 100 + i, x: x!, y: y! }));
      run(b, 90);
      b.events = [];
      return JSON.stringify(b);
    };
    expect(play()).toBe(play());
  });
});

const result = (over: Partial<BattleResult>): BattleResult => ({
  stars: 0,
  destruction: 0,
  loot: {},
  fallen: [],
  survivors: [],
  reason: 'time',
  kind: 'village',
  campId: null,
  cleared: false,
  ...over,
});

describe('catapultas', () => {
  it('solo atacan edificios, desde lejos y por encima de los muros, con daño en área', () => {
    const walls: DefenderBase['buildings'] = [];
    for (let y = 14; y <= 25; y++) walls.push({ type: 'wall', x: 15, y, level: 1, loot: {} });
    const b = createBattle(
      base([{ type: 'house', x: 18, y: 19, level: 1, loot: {} }, { type: 'house', x: 18, y: 21, level: 1, loot: {} }, ...walls], [{ name: 'G', role: 'warrior', level: 1 }]),
      army('catapult'),
    );
    executeBattleCommand(b, { type: 'deploy', villagerId: 100, x: 9, y: 20.5 });
    const cat = b.units.find((u) => u.side === 'attacker')!;
    let impacts = 0;
    let hitUnit = false;
    for (let i = 0; i < 40 * BATTLE_TICK_RATE && b.phase !== 'ended'; i++) {
      stepBattle(b);
      for (const e of b.events) {
        if (e.kind === 'impact') impacts++;
        if (e.kind === 'hit' && e.sourceId !== undefined && b.units.some((u) => u.id === e.targetId && u.side === 'defender')) hitUnit = true;
      }
    }
    expect(impacts).toBeGreaterThan(0);
    expect(cat.x).toBeLessThan(15); // no necesitó cruzar el muro
    // El daño en área alcanza a las dos casas contiguas.
    const houses = b.buildings.filter((x) => x.type === 'house');
    expect(houses.every((h) => h.hp < h.maxHp)).toBe(true);
    expect(cat.targetId === null || b.buildings.some((x) => x.id === cat.targetId)).toBe(true);
    void hitUnit;
  });
});

describe('campamentos de monstruos', () => {
  it('se generan de forma determinista y escalan con el nivel', () => {
    const a = generateMonsterCamp(5, 1);
    expect(generateMonsterCamp(5, 1)).toEqual(a);
    expect(a.kind).toBe('camp');
    expect(a.buildings.some((b) => b.type === 'campChest')).toBe(true);
    const big = generateMonsterCamp(5, 4);
    expect(big.defenders.length).toBeGreaterThan(a.defenders.length);
    expect(big.defenders.some((d) => d.role === 'boneLord')).toBe(true);
    expect(big.buildings.some((b) => b.type === 'campTotem')).toBe(true);
    expect(baseLoot(big).gold).toBeGreaterThan(baseLoot(a).gold);
  });

  it('limpiarlo da botín (también de los monstruos) y lo hace desaparecer', () => {
    const s = createInitialState();
    const camp = s.camps[0]!;
    const base = generateMonsterCamp(camp.seed, 1);
    const b = createBattle(base, army('warrior', 'warrior', 'warrior', 'warrior', 'archer', 'archer').map((u) => ({ ...u, level: 3 })), camp.id);
    [[2, 2], [2, 3], [3, 2], [37, 37], [37, 36], [36, 37]].forEach(([x, y], i) => executeBattleCommand(b, { type: 'deploy', villagerId: 100 + i, x: x!, y: y! }));
    let monsterLoot = 0;
    for (let i = 0; i < 180 * BATTLE_TICK_RATE && b.phase !== 'ended'; i++) {
      stepBattle(b);
      for (const e of b.events) if (e.kind === 'death' && e.loot.gold) monsterLoot += e.loot.gold;
    }
    expect(b.result!.cleared).toBe(true);
    expect(b.stars).toBeGreaterThanOrEqual(2);
    expect(monsterLoot).toBeGreaterThan(0);
    // El botín anunciado incluye lo que llevan los monstruos: arrasarlo lo da entero.
    for (const r of ['gold', 'wood', 'food'] as const) expect(b.lootTaken[r] ?? 0).toBe(baseLoot(base)[r]);
    applyBattleResult(s, b.result!);
    expect(s.camps.find((c) => c.id === camp.id)).toBeUndefined();
  });

  it('aparecen con el tiempo hasta un máximo', () => {
    const s = createInitialState();
    expect(s.camps).toHaveLength(1);
    for (let i = 0; i < (CAMP_SPAWN_SECONDS + 1) * TICK_RATE; i += 50) tick(s, 50);
    expect(s.camps).toHaveLength(2);
    for (let i = 0; i < 10; i++) spawnCamp(s);
    expect(s.camps).toHaveLength(MAX_CAMPS);
    expect(new Set(s.camps.map((c) => c.slot)).size).toBe(MAX_CAMPS);
  });
});

describe('vuelta a la aldea y enfermería', () => {
  const withSoldiers = (levels: number[]) => {
    const s = createInitialState();
    const soldiers: Villager[] = levels.map((lvl, i) => ({ id: 500 + i, name: `S${i}`, role: 'warrior', roleLevel: lvl, task: { kind: 'idle' } }));
    s.villagers.push(...soldiers);
    return { s, soldiers };
  };
  const addInfirmary = (s: GameState, level = 1) => {
    const b = { id: 900 + s.buildings.length, type: 'infirmary' as const, x: 2, y: 2, level, construction: null, hp: 500, stored: 0, recruits: [], healing: null };
    s.buildings.push(b);
    return b;
  };

  it('suma el botín hasta llenar los almacenes', () => {
    const { s } = withSoldiers([1]);
    expect(availableArmy(s).map((u) => u.villagerId)).toEqual([500]);
    const { gained } = applyBattleResult(s, result({ loot: { gold: 800, food: 50 } }));
    expect(gained).toEqual({ gold: 500, wood: 0, food: 50 }); // 500 + 500 = 1000 de capacidad
    expect(s.resources.gold).toBe(1000);
  });

  it('sin enfermería, los caídos mueren', () => {
    const { s } = withSoldiers([1, 2]);
    const { dead, wounded } = applyBattleResult(s, result({ fallen: [500, 501] }));
    expect(wounded).toEqual([]);
    expect(dead.sort()).toEqual([500, 501]);
    expect(s.villagers.some((v) => v.id === 500 || v.id === 501)).toBe(false);
  });

  it('las camas se llenan primero con los de más nivel y el resto muere', () => {
    const { s } = withSoldiers([1, 3, 2, 1]);
    const inf = addInfirmary(s, 1); // 3 camas
    const { wounded, dead } = applyBattleResult(s, result({ fallen: [500, 501, 502, 503] }));
    expect(wounded).toEqual([501, 502, 500]);
    expect(dead).toEqual([503]);
    expect(s.villagers.find((v) => v.id === 501)!.task).toEqual({ kind: 'wounded', infirmaryId: inf.id });
    expect(availableArmy(s).map((u) => u.villagerId)).toEqual([]);
  });

  it('no se curan solos: hay que pagar y tarda más con más soldados y de más nivel', () => {
    const { s, soldiers } = withSoldiers([1, 3]);
    const inf = addInfirmary(s, 1);
    applyBattleResult(s, result({ fallen: [500, 501] }));
    for (let i = 0; i < 600 * TICK_RATE; i += 100) tick(s, 100);
    expect(soldiers.every((v) => v.task.kind === 'wounded')).toBe(true);

    expect(healTicks([soldiers[1]!], inf)).toBeGreaterThan(healTicks([soldiers[0]!], inf));
    expect(healTicks(soldiers, inf)).toBeGreaterThan(healTicks([soldiers[1]!], inf));
    expect(healCost(soldiers)).toEqual({ food: 160, gold: 100 });

    s.resources.food = 1000;
    s.resources.gold = 1000;
    expect(executeCommand(s, { type: 'healWounded', buildingId: inf.id })).toEqual({ ok: true });
    expect(s.resources.food).toBe(840);
    expect(executeCommand(s, { type: 'healWounded', buildingId: inf.id })).toEqual({ ok: false, error: 'busy' });
    const ticks = (inf.healing as { totalTicks: number } | null)!.totalTicks;
    expect(ticks).toBe(4 * 30 * TICK_RATE); // niveles 1 + 3, 30 s por nivel
    for (let i = 0; i <= ticks; i += 10) tick(s, 10);
    expect(soldiers.every((v) => v.task.kind === 'idle')).toBe(true);
    expect(inf.healing).toBeNull();
    expect(executeCommand(s, { type: 'healWounded', buildingId: inf.id })).toEqual({ ok: false, error: 'noPatients' });
  });

  it('una enfermería mejor cura más rápido y tiene más camas', () => {
    const { s, soldiers } = withSoldiers([2, 2, 2, 2, 2]);
    const inf = addInfirmary(s, 2); // 5 camas, velocidad ×1,3
    const { dead } = applyBattleResult(s, result({ fallen: soldiers.map((v) => v.id) }));
    expect(dead).toEqual([]);
    const slow = addInfirmary(s, 1);
    expect(healTicks(soldiers, inf)).toBeLessThan(healTicks(soldiers, slow));
  });
});
