import type { BuildingType, Cost, RoleId } from '../data';

// Estado de una batalla. Igual que el de la aldea, es un objeto plano y
// serializable, y solo cambia mediante comandos + pasos de simulación, para
// que en el futuro lo ejecute el servidor y el cliente solo lo muestre.

export const BATTLE_TICK_RATE = 20;
export const BATTLE_SECONDS = 180;

export type Side = 'attacker' | 'defender';
export type MilitaryRole = Exclude<RoleId, 'builder'>;

export interface BattleBuilding {
  id: number;
  type: BuildingType;
  level: number;
  x: number;
  y: number;
  size: number;
  hp: number;
  maxHp: number;
  loot: Cost; // botín que se obtiene al destruirlo
  cooldown: number; // ticks hasta el próximo disparo (defensas)
  destroyed: boolean;
}

export type UnitOrder =
  | { kind: 'auto' } // elige objetivos solo
  | { kind: 'move'; x: number; y: number }
  | { kind: 'attack'; targetId: number };

export type UnitState = 'idle' | 'moving' | 'attacking' | 'dead';

export interface BattleUnit {
  id: number;
  side: Side;
  villagerId: number | null; // aldeano del jugador (atacantes) o null (defensores generados)
  name: string;
  role: MilitaryRole;
  level: number;
  x: number; // posición continua en celdas
  y: number;
  facing: number; // ángulo (radianes) en el plano XZ del render
  hp: number;
  maxHp: number;
  damage: number;
  range: number;
  speed: number; // celdas por segundo
  interval: number; // ticks entre ataques
  cooldown: number;
  order: UnitOrder;
  targetId: number | null;
  path: { x: number; y: number }[];
  pathKey: string; // objetivo + versión del mapa para los que se calculó el camino
  repathIn: number;
  state: UnitState;
  post: { x: number; y: number } | null; // puesto de guardia (defensores)
  lastAttackTick: number;
}

export type ProjectileKind = 'arrow' | 'bolt' | 'heal';

export interface Projectile {
  id: number;
  kind: ProjectileKind;
  x: number;
  y: number;
  height: number; // altura de salida (para el arco en el render)
  sx: number;
  sy: number;
  targetId: number;
  speed: number;
  amount: number; // daño o curación
  side: Side;
}

export type BattleEvent =
  | { kind: 'deploy'; unitId: number }
  | { kind: 'hit'; targetId: number; sourceId: number; amount: number; melee: boolean }
  | { kind: 'heal'; targetId: number; amount: number }
  | { kind: 'shoot'; sourceId: number; projectileId: number }
  | { kind: 'death'; unitId: number }
  | { kind: 'destroyed'; buildingId: number; loot: Cost }
  | { kind: 'star'; stars: number }
  | { kind: 'end' };

export interface ReserveUnit {
  villagerId: number;
  name: string;
  role: MilitaryRole;
  level: number;
}

export interface BattleResult {
  stars: number;
  destruction: number; // 0..1
  loot: Cost;
  fallen: number[]; // aldeanos del jugador que cayeron (vuelven heridos)
  survivors: number[];
  reason: 'time' | 'destroyed' | 'noTroops' | 'surrender';
}

export interface BattleState {
  version: 1;
  tick: number;
  nextId: number;
  phase: 'scouting' | 'fighting' | 'ended';
  enemyName: string;
  enemyTownHall: number;
  timeLimitTicks: number;
  buildings: BattleBuilding[];
  units: BattleUnit[];
  projectiles: Projectile[];
  reserve: ReserveUnit[];
  gridVersion: number;
  stars: number;
  destruction: number;
  lootTaken: Cost;
  result: BattleResult | null;
  /** Eventos del último paso (para sonidos y efectos). No afectan a la simulación. */
  events: BattleEvent[];
}

export type BattleCommand =
  | { type: 'deploy'; villagerId: number; x: number; y: number }
  | { type: 'order'; unitIds: number[]; order: UnitOrder }
  | { type: 'surrender' };

export type BattleError = 'invalidCommand' | 'notInReserve' | 'forbiddenZone' | 'ended' | 'unknownTarget';

export type BattleCommandResult = { ok: true; unitId?: number } | { ok: false; error: BattleError };
