import { describe, expect, it } from 'vitest';
import {
  TICK_RATE,
  advance,
  applyDamage,
  collectableAmount,
  createInitialState,
  deserialize,
  executeCommand,
  getHousing,
  getIdleBuilders,
  getIdleCivilians,
  getProductionRates,
  getStorageCapacity,
  getTownHallLevel,
  isOperational,
  maxHp,
  serialize,
  tick,
  type GameState,
} from '../src';

const seconds = (s: number) => s * TICK_RATE;
const byType = (state: GameState, type: string) => state.buildings.filter((b) => b.type === type);

describe('estado inicial', () => {
  it('tiene ayuntamiento, casa, granja con cosecha, posada, dos albañiles y un aldeano sin formar', () => {
    const s = createInitialState();
    expect(getTownHallLevel(s)).toBe(1);
    expect(byType(s, 'house')).toHaveLength(1);
    expect(byType(s, 'inn')).toHaveLength(1);
    expect(byType(s, 'farm')[0]!.stored).toBe(120);
    expect(s.villagers).toHaveLength(3);
    expect(getIdleBuilders(s)).toHaveLength(2);
    expect(getIdleCivilians(s)).toHaveLength(1);
    expect(getHousing(s)).toBe(5);
    expect(getProductionRates(s).food).toBeCloseTo(0.8);
    for (const b of s.buildings) expect(b.hp).toBe(maxHp(b));
  });

  it('es determinista para una misma semilla', () => {
    expect(createInitialState(7)).toEqual(createInitialState(7));
  });
});

describe('construcción', () => {
  it('coloca un edificio, cobra, usa un constructor y lo termina', () => {
    const s = createInitialState();
    const res = executeCommand(s, { type: 'placeBuilding', building: 'lumberCamp', x: 2, y: 2 });
    expect(res).toEqual({ ok: true });
    expect(s.resources.gold).toBe(500 - 80);
    const camp = byType(s, 'lumberCamp')[0]!;
    expect(camp.level).toBe(0);
    expect(getIdleBuilders(s)).toHaveLength(1);

    advance(s, seconds(10));
    expect(camp.level).toBe(1);
    expect(camp.construction).toBeNull();
    expect(camp.hp).toBe(maxHp(camp));
    expect(getIdleBuilders(s)).toHaveLength(2);
  });

  it('solo construyen los albañiles: un aldeano sin formar no sirve', () => {
    const s = createInitialState();
    for (const v of s.villagers) if (v.role === 'builder') v.task = { kind: 'build', buildingId: 999 };
    expect(getIdleCivilians(s)).toHaveLength(1);
    expect(executeCommand(s, { type: 'placeBuilding', building: 'house', x: 1, y: 1 })).toEqual({
      ok: false,
      error: 'noIdleBuilder',
    });
  });

  it('un albañil de más nivel construye más rápido', () => {
    const s = createInitialState();
    s.villagers[0]!.roleLevel = 3; // velocidad ×1,75
    executeCommand(s, { type: 'placeBuilding', building: 'lumberCamp', x: 2, y: 2 });
    const camp = byType(s, 'lumberCamp')[0]!;
    expect(camp.construction!.builderId).toBe(s.villagers[0]!.id); // se elige al más experto
    advance(s, seconds(6));
    expect(camp.level).toBe(1); // 10 s de obra / 1,75 ≈ 5,7 s
  });

  it('rechaza solapamientos y posiciones fuera del mapa', () => {
    const s = createInitialState();
    const th = byType(s, 'townHall')[0]!;
    expect(executeCommand(s, { type: 'placeBuilding', building: 'wall', x: th.x + 1, y: th.y + 1 })).toEqual({
      ok: false,
      error: 'areaBlocked',
    });
    expect(executeCommand(s, { type: 'placeBuilding', building: 'house', x: 39, y: 0 })).toEqual({
      ok: false,
      error: 'areaBlocked',
    });
  });

  it('rechaza comandos malformados', () => {
    const s = createInitialState();
    expect(executeCommand(s, { type: 'hack' } as never)).toEqual({ ok: false, error: 'invalidCommand' });
    expect(executeCommand(s, { type: 'placeBuilding', building: 'castle', x: 1, y: 1 } as never)).toEqual({
      ok: false,
      error: 'unknownBuilding',
    });
    expect(executeCommand(s, { type: 'placeBuilding', building: 'wall', x: 1.5, y: 1 })).toEqual({
      ok: false,
      error: 'areaBlocked',
    });
  });

  it('no modifica el estado si falla', () => {
    const s = createInitialState();
    s.resources.wood = 0;
    const before = JSON.stringify(s);
    expect(executeCommand(s, { type: 'placeBuilding', building: 'house', x: 1, y: 1 }).ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('necesita un aldeano libre como constructor, salvo los muros', () => {
    const s = createInitialState();
    for (const v of s.villagers) v.task = { kind: 'build', buildingId: 999 };
    expect(executeCommand(s, { type: 'placeBuilding', building: 'house', x: 1, y: 1 })).toEqual({
      ok: false,
      error: 'noIdleBuilder',
    });
    expect(executeCommand(s, { type: 'placeBuilding', building: 'wall', x: 1, y: 1 })).toEqual({ ok: true });
    const wall = byType(s, 'wall')[0]!;
    expect(wall.level).toBe(1);
    expect(wall.hp).toBe(maxHp(wall));
  });

  it('respeta el límite por nivel de ayuntamiento', () => {
    const s = createInitialState();
    expect(executeCommand(s, { type: 'placeBuilding', building: 'storehouse', x: 1, y: 1 })).toEqual({
      ok: false,
      error: 'limitReached',
    });
    expect(executeCommand(s, { type: 'placeBuilding', building: 'house', x: 1, y: 1 })).toEqual({ ok: true });
    s.resources.wood = 1000;
    expect(executeCommand(s, { type: 'placeBuilding', building: 'house', x: 4, y: 1 })).toEqual({
      ok: false,
      error: 'limitReached',
    });
  });

  it('mejora el ayuntamiento y detiene la producción de un edificio en obras', () => {
    const s = createInitialState();
    s.resources.gold = 1000;
    s.resources.wood = 1000;
    const th = byType(s, 'townHall')[0]!;
    expect(executeCommand(s, { type: 'upgradeBuilding', buildingId: th.id })).toEqual({ ok: true });
    advance(s, seconds(60));
    expect(getTownHallLevel(s)).toBe(2);
    expect(th.hp).toBe(maxHp(th));
    expect(getStorageCapacity(s).gold).toBe(2000);

    const farm = byType(s, 'farm')[0]!;
    s.resources.gold = 1000;
    s.resources.wood = 1000;
    expect(executeCommand(s, { type: 'upgradeBuilding', buildingId: farm.id })).toEqual({ ok: true });
    expect(getProductionRates(s).food).toBe(0);
    const stored = farm.stored;
    tick(s, seconds(5));
    expect(farm.stored).toBe(stored);
  });

  it('mueve edificios a zonas libres', () => {
    const s = createInitialState();
    const house = byType(s, 'house')[0]!;
    expect(executeCommand(s, { type: 'moveBuilding', buildingId: house.id, x: 0, y: 0 })).toEqual({ ok: true });
    expect([house.x, house.y]).toEqual([0, 0]);
    // Moverse sobre su propia huella es válido.
    expect(executeCommand(s, { type: 'moveBuilding', buildingId: house.id, x: 1, y: 0 })).toEqual({ ok: true });
  });
});

describe('producción y recolección', () => {
  it('los productores llenan su depósito solos hasta su capacidad', () => {
    const s = createInitialState();
    const farm = byType(s, 'farm')[0]!;
    tick(s, seconds(10));
    expect(farm.stored).toBeCloseTo(128);
    expect(s.resources.food).toBe(300); // no llega al almacén hasta recolectar
    advance(s, seconds(3600));
    expect(farm.stored).toBe(400);
    expect(getProductionRates(s).food).toBe(0); // lleno: deja de producir
  });

  it('recolectar mueve lo acumulado a los recursos', () => {
    const s = createInitialState();
    const farm = byType(s, 'farm')[0]!;
    expect(executeCommand(s, { type: 'collect', buildingId: farm.id })).toEqual({ ok: true });
    expect(s.resources.food).toBe(420);
    expect(farm.stored).toBe(0);
    expect(executeCommand(s, { type: 'collect', buildingId: farm.id })).toEqual({ ok: false, error: 'nothingToCollect' });
  });

  it('con los almacenes llenos solo se recoge lo que cabe', () => {
    const s = createInitialState();
    const farm = byType(s, 'farm')[0]!;
    s.resources.food = 950;
    expect(collectableAmount(s, farm)).toBe(50);
    expect(executeCommand(s, { type: 'collect', buildingId: farm.id })).toEqual({ ok: true });
    expect(s.resources.food).toBe(1000);
    expect(farm.stored).toBe(70);
    expect(executeCommand(s, { type: 'collect', buildingId: farm.id })).toEqual({ ok: false, error: 'storageFull' });
  });

  it('solo los productores se pueden recolectar', () => {
    const s = createInitialState();
    const house = byType(s, 'house')[0]!;
    expect(executeCommand(s, { type: 'collect', buildingId: house.id })).toEqual({ ok: false, error: 'notProducer' });
  });

  it('la posada recluta aldeanos sin formar tras un tiempo', () => {
    const s = createInitialState();
    const inn = byType(s, 'inn')[0]!;
    expect(executeCommand(s, { type: 'recruitVillager', buildingId: inn.id })).toEqual({ ok: true });
    expect(s.resources.food).toBe(240);
    expect(inn.recruits).toHaveLength(1);
    // Una plaza a nivel 1: el segundo espera a que quede libre.
    expect(executeCommand(s, { type: 'recruitVillager', buildingId: inn.id })).toEqual({ ok: false, error: 'noFreeSlot' });
    advance(s, seconds(20));
    expect(s.villagers).toHaveLength(4);
    expect(s.villagers.at(-1)!.role).toBeNull();
    expect(inn.recruits).toHaveLength(0);
  });

  it('los aldeanos en camino ocupan alojamiento', () => {
    const s = createInitialState();
    s.resources.food = 1000;
    const inn = byType(s, 'inn')[0]!;
    inn.level = 3; // 3 plazas
    inn.hp = maxHp(inn);
    // 3 aldeanos + 2 en camino = 5 = alojamiento: el tercero no cabe aunque haya plaza.
    expect(executeCommand(s, { type: 'recruitVillager', buildingId: inn.id }).ok).toBe(true);
    expect(executeCommand(s, { type: 'recruitVillager', buildingId: inn.id }).ok).toBe(true);
    expect(executeCommand(s, { type: 'recruitVillager', buildingId: inn.id })).toEqual({ ok: false, error: 'noHousing' });
  });

  it('solo la posada recluta', () => {
    const s = createInitialState();
    const th = byType(s, 'townHall')[0]!;
    expect(executeCommand(s, { type: 'recruitVillager', buildingId: th.id })).toEqual({ ok: false, error: 'notInn' });
  });
});

describe('daño y reparación', () => {
  it('un albañil libre repara solo el edificio dañado', () => {
    const s = createInitialState();
    const house = byType(s, 'house')[0]!;
    applyDamage(s, house.id, 300);
    expect(house.hp).toBe(100);
    tick(s);
    const repairer = s.villagers.find((v) => v.task.kind === 'repair');
    expect(repairer?.role).toBe('builder');
    advance(s, seconds(30));
    expect(house.hp).toBe(maxHp(house));
    expect(repairer!.task.kind).toBe('idle');
  });

  it('un edificio destruido deja de producir hasta que lo reparan', () => {
    const s = createInitialState();
    for (const v of s.villagers) v.task = { kind: 'build', buildingId: 999 }; // nadie libre
    const farm = byType(s, 'farm')[0]!;
    expect(s.villagers[0]!.role).toBe('builder');
    applyDamage(s, farm.id, 9999);
    expect(farm.hp).toBe(0);
    expect(isOperational(farm)).toBe(false);
    const stored = farm.stored;
    tick(s, seconds(10));
    expect(farm.stored).toBe(stored);
    s.villagers[0]!.task = { kind: 'idle' };
    advance(s, seconds(60));
    expect(farm.hp).toBe(maxHp(farm));
    expect(isOperational(farm)).toBe(true);
  });

  it('no se puede mejorar un edificio dañado', () => {
    const s = createInitialState();
    s.resources.gold = 1000;
    s.resources.wood = 1000;
    const th = byType(s, 'townHall')[0]!;
    applyDamage(s, th.id, 10);
    expect(executeCommand(s, { type: 'upgradeBuilding', buildingId: th.id })).toEqual({ ok: false, error: 'damaged' });
  });

  it('reparte un reparador por edificio, primero el más dañado', () => {
    const s = createInitialState();
    const [th, house, farm] = [byType(s, 'townHall')[0]!, byType(s, 'house')[0]!, byType(s, 'farm')[0]!];
    applyDamage(s, th.id, 100);
    applyDamage(s, house.id, 350);
    applyDamage(s, farm.id, 200);
    s.villagers[2]!.task = { kind: 'build', buildingId: 999 };
    tick(s);
    const targets = s.villagers.filter((v) => v.task.kind === 'repair').map((v) => (v.task as { buildingId: number }).buildingId);
    expect(targets).toEqual([house.id, farm.id]);
  });
});

describe('entrenamiento de roles', () => {
  function withBarracks() {
    const s = createInitialState();
    s.resources.food = 1000;
    s.resources.gold = 1000;
    s.resources.wood = 1000;
    executeCommand(s, { type: 'placeBuilding', building: 'barracks', x: 2, y: 2 });
    advance(s, seconds(20));
    const barracks = byType(s, 'barracks')[0]!;
    expect(barracks.level).toBe(1);
    return { s, barracks };
  }

  it('convierte a un aldeano en guerrero de nivel 1', () => {
    const { s, barracks } = withBarracks();
    const v = getIdleCivilians(s)[0]!;
    expect(executeCommand(s, { type: 'trainVillager', villagerId: v.id, buildingId: barracks.id })).toEqual({
      ok: true,
    });
    advance(s, seconds(15));
    expect(v.role).toBe('warrior');
    expect(v.roleLevel).toBe(1);
    expect(v.task.kind).toBe('idle');
  });

  it('el taller forma albañiles', () => {
    const s = createInitialState();
    s.resources.food = 1000;
    s.resources.gold = 1000;
    s.resources.wood = 1000;
    executeCommand(s, { type: 'placeBuilding', building: 'workshop', x: 2, y: 2 });
    advance(s, seconds(20));
    const workshop = byType(s, 'workshop')[0]!;
    const v = getIdleCivilians(s)[0]!;
    expect(executeCommand(s, { type: 'trainVillager', villagerId: v.id, buildingId: workshop.id })).toEqual({ ok: true });
    advance(s, seconds(15));
    expect(v.role).toBe('builder');
    expect(getIdleBuilders(s)).toHaveLength(3);
  });

  it('los soldados no construyen ni reparan', () => {
    const { s, barracks } = withBarracks();
    const v = getIdleCivilians(s)[0]!;
    executeCommand(s, { type: 'trainVillager', villagerId: v.id, buildingId: barracks.id });
    advance(s, seconds(15));
    expect(getIdleCivilians(s).some((x) => x.id === v.id)).toBe(false);
    for (const other of s.villagers) if (other.id !== v.id) other.task = { kind: 'build', buildingId: 999 };
    applyDamage(s, barracks.id, 100);
    tick(s);
    expect(v.task.kind).toBe('idle');
  });

  it('no se puede entrenar a un aldeano ocupado', () => {
    const { s, barracks } = withBarracks();
    const v = s.villagers[0]!;
    v.task = { kind: 'repair', buildingId: barracks.id };
    expect(executeCommand(s, { type: 'trainVillager', villagerId: v.id, buildingId: barracks.id })).toEqual({
      ok: false,
      error: 'busy',
    });
  });

  it('el nivel del edificio limita el nivel del rol', () => {
    const { s, barracks } = withBarracks();
    const v = getIdleCivilians(s)[0]!;
    executeCommand(s, { type: 'trainVillager', villagerId: v.id, buildingId: barracks.id });
    advance(s, seconds(15));
    expect(executeCommand(s, { type: 'trainVillager', villagerId: v.id, buildingId: barracks.id })).toEqual({
      ok: false,
      error: 'buildingLevelTooLow',
    });
  });

  it('un aldeano formado no puede cambiar de oficio', () => {
    const { s, barracks } = withBarracks();
    const mason = s.villagers.find((v) => v.role === 'builder')!;
    expect(executeCommand(s, { type: 'trainVillager', villagerId: mason.id, buildingId: barracks.id })).toEqual({
      ok: false,
      error: 'roleLocked',
    });
  });

  it('respeta los huecos de entrenamiento', () => {
    const { s, barracks } = withBarracks();
    s.villagers.push({ id: 901, name: 'Otro', role: null, roleLevel: 0, task: { kind: 'idle' } });
    const [a, b] = s.villagers.filter((v) => v.role === null);
    expect(executeCommand(s, { type: 'trainVillager', villagerId: a!.id, buildingId: barracks.id }).ok).toBe(true);
    expect(executeCommand(s, { type: 'trainVillager', villagerId: b!.id, buildingId: barracks.id })).toEqual({
      ok: false,
      error: 'noFreeSlot',
    });
  });
});

describe('guardado', () => {
  it('recupera el progreso offline en los depósitos', () => {
    const s = createInitialState();
    const json = serialize(s, 1_000_000);
    const loaded = deserialize(json, 1_000_000 + 60_000)!;
    expect(loaded.offlineSeconds).toBe(60);
    expect(byType(loaded.state, 'farm')[0]!.stored).toBeCloseTo(168);
  });

  it('migra partidas de la versión 1 (con trabajadores)', () => {
    const v1 = {
      savedAt: 0,
      state: {
        version: 1,
        tick: 5,
        rng: 1,
        nextId: 4,
        resources: { gold: 10, wood: 20, food: 30 },
        buildings: [{ id: 1, type: 'farm', x: 0, y: 0, level: 2, construction: null }],
        villagers: [{ id: 2, name: 'Aldo', role: null, roleLevel: 0, task: { kind: 'work', buildingId: 1 } }],
      },
    };
    const loaded = deserialize(JSON.stringify(v1), 0)!;
    expect(loaded.state.version).toBe(3);
    expect(loaded.state.buildings[0]!.hp).toBe(550);
    expect(loaded.state.buildings[0]!.stored).toBe(0);
    expect(loaded.state.buildings[0]!.recruits).toEqual([]);
    expect(loaded.state.villagers[0]!.task).toEqual({ kind: 'idle' });
    // Los civiles que construían conservan su oficio como albañiles.
    expect(loaded.state.villagers[0]!.role).toBe('builder');
  });

  it('migra partidas de la versión 2 sin tocar a los soldados', () => {
    const v2 = {
      savedAt: 0,
      state: {
        version: 2,
        tick: 5,
        rng: 1,
        nextId: 4,
        resources: { gold: 10, wood: 20, food: 30 },
        buildings: [{ id: 1, type: 'farm', x: 0, y: 0, level: 1, construction: null, hp: 400, stored: 7 }],
        villagers: [
          { id: 2, name: 'Aldo', role: null, roleLevel: 0, task: { kind: 'idle' } },
          { id: 3, name: 'Berta', role: 'archer', roleLevel: 2, task: { kind: 'idle' } },
        ],
      },
    };
    const loaded = deserialize(JSON.stringify(v2), 0)!;
    expect(loaded.state.buildings[0]!.stored).toBe(7);
    expect(loaded.state.villagers.map((v) => [v.role, v.roleLevel])).toEqual([
      ['builder', 1],
      ['archer', 2],
    ]);
  });

  it('ignora datos corruptos o de versiones desconocidas', () => {
    expect(deserialize('{nope', 0)).toBeNull();
    expect(deserialize(JSON.stringify({ savedAt: 0, state: { version: 99, buildings: [], villagers: [] } }), 0)).toBeNull();
  });
});
