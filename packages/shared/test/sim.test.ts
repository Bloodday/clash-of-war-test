import { describe, expect, it } from 'vitest';
import {
  TICK_RATE,
  advance,
  createInitialState,
  deserialize,
  executeCommand,
  getHousing,
  getIdleCivilians,
  getProductionRates,
  getStorageCapacity,
  getTownHallLevel,
  serialize,
  tick,
  type GameState,
} from '../src';

const seconds = (s: number) => s * TICK_RATE;
const byType = (state: GameState, type: string) => state.buildings.filter((b) => b.type === type);

describe('estado inicial', () => {
  it('tiene ayuntamiento, casa, granja y tres aldeanos', () => {
    const s = createInitialState();
    expect(getTownHallLevel(s)).toBe(1);
    expect(byType(s, 'house')).toHaveLength(1);
    expect(byType(s, 'farm')).toHaveLength(1);
    expect(s.villagers).toHaveLength(3);
    expect(getHousing(s)).toBe(5);
    expect(getProductionRates(s).food).toBeCloseTo(0.5);
  });

  it('es determinista para una misma semilla', () => {
    expect(createInitialState(7)).toEqual(createInitialState(7));
  });
});

describe('construcción', () => {
  it('coloca un edificio, cobra, usa un constructor y lo termina', () => {
    const s = createInitialState();
    const idleBefore = getIdleCivilians(s).length;
    const res = executeCommand(s, { type: 'placeBuilding', building: 'lumberCamp', x: 2, y: 2 });
    expect(res).toEqual({ ok: true });
    expect(s.resources.gold).toBe(500 - 80);
    const camp = byType(s, 'lumberCamp')[0]!;
    expect(camp.level).toBe(0);
    expect(getIdleCivilians(s)).toHaveLength(idleBefore - 1);

    advance(s, seconds(10));
    expect(camp.level).toBe(1);
    expect(camp.construction).toBeNull();
    expect(getIdleCivilians(s)).toHaveLength(idleBefore);
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
    for (const v of s.villagers) v.task = { kind: 'work', buildingId: byType(s, 'farm')[0]!.id };
    expect(executeCommand(s, { type: 'placeBuilding', building: 'house', x: 1, y: 1 })).toEqual({
      ok: false,
      error: 'noIdleBuilder',
    });
    expect(executeCommand(s, { type: 'placeBuilding', building: 'wall', x: 1, y: 1 })).toEqual({ ok: true });
    expect(byType(s, 'wall')[0]!.level).toBe(1);
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
    expect(getStorageCapacity(s).gold).toBe(2000);

    const farm = byType(s, 'farm')[0]!;
    s.resources.gold = 1000;
    s.resources.wood = 1000;
    expect(executeCommand(s, { type: 'upgradeBuilding', buildingId: farm.id })).toEqual({ ok: true });
    expect(getProductionRates(s).food).toBe(0);
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

describe('economía', () => {
  it('los trabajadores producen hasta la capacidad de almacenamiento', () => {
    const s = createInitialState();
    const farm = byType(s, 'farm')[0]!;
    const idle = getIdleCivilians(s)[0]!;
    expect(executeCommand(s, { type: 'assignWorker', villagerId: idle.id, buildingId: farm.id })).toEqual({
      ok: true,
    });
    expect(getProductionRates(s).food).toBeCloseTo(1);
    tick(s, seconds(10));
    expect(s.resources.food).toBeCloseTo(310);
    advance(s, seconds(3600));
    expect(s.resources.food).toBe(getStorageCapacity(s).food);
  });

  it('limita los puestos de trabajo', () => {
    const s = createInitialState();
    const farm = byType(s, 'farm')[0]!;
    const [a, b] = getIdleCivilians(s);
    expect(executeCommand(s, { type: 'assignWorker', villagerId: a!.id, buildingId: farm.id }).ok).toBe(true);
    expect(executeCommand(s, { type: 'assignWorker', villagerId: b!.id, buildingId: farm.id })).toEqual({
      ok: false,
      error: 'noFreeSlot',
    });
  });

  it('recluta aldeanos mientras haya alojamiento', () => {
    const s = createInitialState();
    s.resources.food = 1000;
    expect(executeCommand(s, { type: 'recruitVillager' })).toEqual({ ok: true });
    expect(executeCommand(s, { type: 'recruitVillager' })).toEqual({ ok: true });
    expect(s.villagers).toHaveLength(5);
    expect(executeCommand(s, { type: 'recruitVillager' })).toEqual({ ok: false, error: 'noHousing' });
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
    const v = s.villagers.find((x) => x.task.kind === 'work')!; // se le saca de la granja
    expect(executeCommand(s, { type: 'trainVillager', villagerId: v.id, buildingId: barracks.id })).toEqual({
      ok: true,
    });
    expect(getProductionRates(s).food).toBe(0);
    advance(s, seconds(15));
    expect(v.role).toBe('warrior');
    expect(v.roleLevel).toBe(1);
    expect(v.task.kind).toBe('idle');
  });

  it('los soldados no pueden trabajar ni construir', () => {
    const { s, barracks } = withBarracks();
    const v = getIdleCivilians(s)[0]!;
    executeCommand(s, { type: 'trainVillager', villagerId: v.id, buildingId: barracks.id });
    advance(s, seconds(15));
    const farm = byType(s, 'farm')[0]!;
    expect(executeCommand(s, { type: 'assignWorker', villagerId: v.id, buildingId: farm.id })).toEqual({
      ok: false,
      error: 'notCivilian',
    });
    expect(getIdleCivilians(s).some((x) => x.id === v.id)).toBe(false);
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

  it('respeta los huecos de entrenamiento', () => {
    const { s, barracks } = withBarracks();
    const [a, b] = s.villagers;
    expect(executeCommand(s, { type: 'trainVillager', villagerId: a!.id, buildingId: barracks.id }).ok).toBe(true);
    expect(executeCommand(s, { type: 'trainVillager', villagerId: b!.id, buildingId: barracks.id })).toEqual({
      ok: false,
      error: 'noFreeSlot',
    });
  });
});

describe('guardado', () => {
  it('recupera el progreso offline', () => {
    const s = createInitialState();
    const json = serialize(s, 1_000_000);
    const loaded = deserialize(json, 1_000_000 + 60_000)!;
    expect(loaded.offlineSeconds).toBe(60);
    expect(loaded.state.resources.food).toBeCloseTo(330);
  });

  it('ignora datos corruptos', () => {
    expect(deserialize('{nope', 0)).toBeNull();
  });
});
