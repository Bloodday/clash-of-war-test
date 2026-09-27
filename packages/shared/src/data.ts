// Definiciones de datos del juego. Todo el balance vive aquí para poder
// ajustarlo sin tocar la lógica de la simulación.

export const TICK_RATE = 10; // ticks de simulación por segundo
export const GRID_SIZE = 40; // la aldea es una cuadrícula GRID_SIZE x GRID_SIZE

export const RESOURCES = ['gold', 'wood', 'food'] as const;
export type ResourceId = (typeof RESOURCES)[number];
export type Cost = Partial<Record<ResourceId, number>>;

export const RESOURCE_NAMES: Record<ResourceId, string> = {
  gold: 'Oro',
  wood: 'Madera',
  food: 'Comida',
};

// ---------------------------------------------------------------------------
// Roles: los aldeanos aprenden un rol en un edificio de entrenamiento.
// ---------------------------------------------------------------------------

export const ROLES = ['builder', 'warrior', 'archer', 'healer', 'catapult'] as const;
export type RoleId = (typeof ROLES)[number];

export interface RoleLevelDef {
  cost: Cost;
  trainSeconds: number;
  // Estadísticas de combate (se usarán en la fase RTS/FPS).
  hp: number;
  damage: number;
  range: number;
  /** Solo albañiles: multiplicador de velocidad al construir y reparar. */
  workSpeed?: number;
}

export interface RoleDef {
  name: string;
  description: string;
  /** civil: trabaja en la aldea; military: forma parte del ejército. */
  kind: 'civil' | 'military';
  trainedAt: BuildingType;
  levels: RoleLevelDef[]; // índice 0 = nivel 1
}

export const ROLE_DEFS: Record<RoleId, RoleDef> = {
  builder: {
    name: 'Albañil',
    description: 'Construye, mejora y repara los edificios. Con más nivel trabaja más rápido.',
    kind: 'civil',
    trainedAt: 'workshop',
    levels: [
      { cost: { food: 40, gold: 30 }, trainSeconds: 15, hp: 80, damage: 4, range: 1, workSpeed: 1 },
      { cost: { food: 120, gold: 120 }, trainSeconds: 45, hp: 100, damage: 6, range: 1, workSpeed: 1.35 },
      { cost: { food: 300, gold: 350 }, trainSeconds: 120, hp: 130, damage: 8, range: 1, workSpeed: 1.75 },
    ],
  },
  warrior: {
    name: 'Guerrero',
    description: 'Combatiente cuerpo a cuerpo. Primera línea de ataque y defensa.',
    kind: 'military',
    trainedAt: 'barracks',
    levels: [
      { cost: { food: 50, gold: 20 }, trainSeconds: 15, hp: 120, damage: 12, range: 1 },
      { cost: { food: 120, gold: 80 }, trainSeconds: 45, hp: 180, damage: 18, range: 1 },
      { cost: { food: 300, gold: 250 }, trainSeconds: 120, hp: 260, damage: 26, range: 1 },
    ],
  },
  archer: {
    name: 'Arquero',
    description: 'Ataca a distancia. Frágil, pero letal detrás de un muro.',
    kind: 'military',
    trainedAt: 'archeryRange',
    levels: [
      { cost: { food: 60, gold: 40 }, trainSeconds: 20, hp: 70, damage: 9, range: 6 },
      { cost: { food: 150, gold: 120 }, trainSeconds: 60, hp: 100, damage: 14, range: 7 },
      { cost: { food: 350, gold: 320 }, trainSeconds: 150, hp: 140, damage: 20, range: 8 },
    ],
  },
  healer: {
    name: 'Sanador',
    description: 'Cura a los aliados cercanos durante la batalla.',
    kind: 'military',
    trainedAt: 'temple',
    levels: [
      { cost: { food: 100, gold: 100 }, trainSeconds: 30, hp: 80, damage: 10, range: 4 },
      { cost: { food: 250, gold: 250 }, trainSeconds: 90, hp: 110, damage: 15, range: 5 },
      { cost: { food: 500, gold: 600 }, trainSeconds: 200, hp: 150, damage: 22, range: 6 },
    ],
  },
  catapult: {
    name: 'Catapulta',
    description: 'Máquina de asedio manejada por un aldeano. Lenta y frágil, pero derriba edificios y muros desde lejos con daño en área.',
    kind: 'military',
    trainedAt: 'siegeWorkshop',
    levels: [
      { cost: { food: 60, gold: 120, wood: 150 }, trainSeconds: 40, hp: 150, damage: 30, range: 9 },
      { cost: { food: 150, gold: 300, wood: 350 }, trainSeconds: 90, hp: 200, damage: 45, range: 10 },
      { cost: { food: 300, gold: 700, wood: 800 }, trainSeconds: 180, hp: 260, damage: 65, range: 11 },
    ],
  },
};

export const RECRUIT_COST: Cost = { food: 60 };

/** Curar a un soldado herido: coste y segundos por cada nivel del soldado. */
export const HEAL_COST_PER_LEVEL: Cost = { food: 40, gold: 25 };
export const HEAL_SECONDS_PER_LEVEL = 30;

/** Fracción de la vida máxima que repara un aldeano por segundo. */
export const REPAIR_RATE = 0.05;
/** Mínimo de vida reparada por segundo (para edificios con poca vida). */
export const REPAIR_MIN_HP_PER_SECOND = 15;

// ---------------------------------------------------------------------------
// Edificios
// ---------------------------------------------------------------------------

export type BuildingType =
  | 'townHall'
  | 'house'
  | 'inn'
  | 'workshop'
  | 'farm'
  | 'lumberCamp'
  | 'goldMine'
  | 'storehouse'
  | 'barracks'
  | 'archeryRange'
  | 'temple'
  | 'wall'
  | 'archerTower'
  | 'siegeWorkshop'
  | 'infirmary';

export type BuildingCategory = 'core' | 'economy' | 'military' | 'defense';

export interface BuildingLevelDef {
  cost: Cost;
  buildSeconds: number; // 0 = instantáneo y no necesita constructor
  hp: number;
  requiresTownHall: number;
  housing?: number;
  storage?: Cost;
  production?: Cost; // por segundo, hacia el depósito propio del edificio
  capacity?: number; // máximo acumulable antes de tener que recolectar
  trainingSlots?: number;
  recruitSlots?: number; // posada: aldeanos que se reclutan a la vez
  recruitSeconds?: number;
  beds?: number; // enfermería: soldados heridos que puede acoger
  healSpeed?: number; // enfermería: multiplicador de velocidad de curación
  damage?: number;
  range?: number;
}

export interface BuildingDef {
  type: BuildingType;
  name: string;
  description: string;
  category: BuildingCategory;
  size: number; // huella cuadrada en celdas
  levels: BuildingLevelDef[]; // índice 0 = nivel 1
  maxCountByTownHall: number[]; // índice = nivel del ayuntamiento - 1
  trainsRole?: RoleId;
}

const storageAll = (n: number): Cost => ({ gold: n, wood: n, food: n });

export const BUILDING_DEFS: Record<BuildingType, BuildingDef> = {
  townHall: {
    type: 'townHall',
    name: 'Ayuntamiento',
    description: 'Corazón de la aldea. Su nivel desbloquea nuevos edificios y mejoras.',
    category: 'core',
    size: 4,
    maxCountByTownHall: [1, 1, 1, 1, 1],
    levels: [
      { cost: {}, buildSeconds: 0, hp: 1500, requiresTownHall: 0, housing: 3, storage: storageAll(1000) },
      { cost: { gold: 800, wood: 800 }, buildSeconds: 60, hp: 2200, requiresTownHall: 1, housing: 4, storage: storageAll(2000) },
      { cost: { gold: 2500, wood: 2500 }, buildSeconds: 180, hp: 3000, requiresTownHall: 2, housing: 5, storage: storageAll(4000) },
      { cost: { gold: 6000, wood: 6000 }, buildSeconds: 480, hp: 4000, requiresTownHall: 3, housing: 6, storage: storageAll(8000) },
      { cost: { gold: 12000, wood: 12000 }, buildSeconds: 900, hp: 5200, requiresTownHall: 4, housing: 8, storage: storageAll(15000) },
    ],
  },
  house: {
    type: 'house',
    name: 'Casa',
    description: 'Alojamiento para más aldeanos.',
    category: 'core',
    size: 2,
    maxCountByTownHall: [2, 3, 4, 5, 6],
    levels: [
      { cost: { wood: 100 }, buildSeconds: 10, hp: 400, requiresTownHall: 1, housing: 2 },
      { cost: { wood: 250, gold: 100 }, buildSeconds: 30, hp: 550, requiresTownHall: 2, housing: 3 },
      { cost: { wood: 600, gold: 300 }, buildSeconds: 90, hp: 700, requiresTownHall: 3, housing: 4 },
    ],
  },
  inn: {
    type: 'inn',
    name: 'Posada',
    description: 'Aquí llegan los nuevos aldeanos. Recluta a cambio de comida; luego fórmalos.',
    category: 'core',
    size: 3,
    maxCountByTownHall: [1, 1, 1, 2, 2],
    levels: [
      { cost: { wood: 150 }, buildSeconds: 15, hp: 500, requiresTownHall: 1, recruitSlots: 1, recruitSeconds: 20 },
      { cost: { wood: 500, gold: 300 }, buildSeconds: 60, hp: 700, requiresTownHall: 2, recruitSlots: 2, recruitSeconds: 15 },
      { cost: { wood: 1400, gold: 1000 }, buildSeconds: 180, hp: 900, requiresTownHall: 3, recruitSlots: 3, recruitSeconds: 10 },
    ],
  },
  workshop: {
    type: 'workshop',
    name: 'Taller',
    description: 'Forma a los aldeanos como albañiles, los únicos que construyen y reparan.',
    category: 'core',
    size: 3,
    trainsRole: 'builder',
    maxCountByTownHall: [1, 1, 1, 1, 1],
    levels: [
      { cost: { wood: 200, gold: 100 }, buildSeconds: 20, hp: 600, requiresTownHall: 1, trainingSlots: 1 },
      { cost: { wood: 600, gold: 400 }, buildSeconds: 90, hp: 800, requiresTownHall: 2, trainingSlots: 2 },
      { cost: { wood: 1500, gold: 1200 }, buildSeconds: 240, hp: 1000, requiresTownHall: 3, trainingSlots: 2 },
    ],
  },
  farm: {
    type: 'farm',
    name: 'Granja',
    description: 'Produce comida por sí sola. Pasa el ratón por encima para recolectarla.',
    category: 'economy',
    size: 3,
    maxCountByTownHall: [1, 2, 2, 3, 3],
    levels: [
      { cost: { wood: 80 }, buildSeconds: 10, hp: 400, requiresTownHall: 1, production: { food: 0.8 }, capacity: 400 },
      { cost: { wood: 250, gold: 150 }, buildSeconds: 45, hp: 550, requiresTownHall: 2, production: { food: 1.3 }, capacity: 1000 },
      { cost: { wood: 700, gold: 400 }, buildSeconds: 120, hp: 700, requiresTownHall: 3, production: { food: 2 }, capacity: 2200 },
    ],
  },
  lumberCamp: {
    type: 'lumberCamp',
    name: 'Aserradero',
    description: 'Produce madera por sí solo. Pasa el ratón por encima para recolectarla.',
    category: 'economy',
    size: 3,
    maxCountByTownHall: [1, 2, 2, 3, 3],
    levels: [
      { cost: { gold: 80 }, buildSeconds: 10, hp: 400, requiresTownHall: 1, production: { wood: 0.8 }, capacity: 400 },
      { cost: { gold: 250, wood: 150 }, buildSeconds: 45, hp: 550, requiresTownHall: 2, production: { wood: 1.3 }, capacity: 1000 },
      { cost: { gold: 700, wood: 400 }, buildSeconds: 120, hp: 700, requiresTownHall: 3, production: { wood: 2 }, capacity: 2200 },
    ],
  },
  goldMine: {
    type: 'goldMine',
    name: 'Mina de oro',
    description: 'Extrae oro por sí sola. Pasa el ratón por encima para recolectarlo.',
    category: 'economy',
    size: 3,
    maxCountByTownHall: [1, 2, 2, 3, 3],
    levels: [
      { cost: { wood: 120 }, buildSeconds: 15, hp: 450, requiresTownHall: 1, production: { gold: 0.6 }, capacity: 300 },
      { cost: { wood: 300, gold: 150 }, buildSeconds: 60, hp: 600, requiresTownHall: 2, production: { gold: 1 }, capacity: 800 },
      { cost: { wood: 800, gold: 400 }, buildSeconds: 150, hp: 750, requiresTownHall: 3, production: { gold: 1.6 }, capacity: 1800 },
    ],
  },
  storehouse: {
    type: 'storehouse',
    name: 'Almacén',
    description: 'Aumenta la capacidad de almacenamiento de todos los recursos.',
    category: 'economy',
    size: 3,
    maxCountByTownHall: [0, 1, 2, 2, 3],
    levels: [
      { cost: { wood: 300, gold: 200 }, buildSeconds: 30, hp: 600, requiresTownHall: 2, storage: storageAll(1500) },
      { cost: { wood: 800, gold: 600 }, buildSeconds: 120, hp: 800, requiresTownHall: 3, storage: storageAll(3000) },
      { cost: { wood: 2000, gold: 1800 }, buildSeconds: 300, hp: 1000, requiresTownHall: 4, storage: storageAll(6000) },
    ],
  },
  barracks: {
    type: 'barracks',
    name: 'Cuartel',
    description: 'Entrena aldeanos como guerreros. Su nivel limita el nivel del rol.',
    category: 'military',
    size: 3,
    trainsRole: 'warrior',
    maxCountByTownHall: [1, 1, 2, 2, 2],
    levels: [
      { cost: { wood: 200, gold: 100 }, buildSeconds: 20, hp: 600, requiresTownHall: 1, trainingSlots: 1 },
      { cost: { wood: 600, gold: 400 }, buildSeconds: 90, hp: 800, requiresTownHall: 2, trainingSlots: 2 },
      { cost: { wood: 1500, gold: 1200 }, buildSeconds: 240, hp: 1000, requiresTownHall: 3, trainingSlots: 2 },
    ],
  },
  archeryRange: {
    type: 'archeryRange',
    name: 'Campo de tiro',
    description: 'Entrena aldeanos como arqueros.',
    category: 'military',
    size: 3,
    trainsRole: 'archer',
    maxCountByTownHall: [0, 1, 1, 2, 2],
    levels: [
      { cost: { wood: 300, gold: 150 }, buildSeconds: 30, hp: 550, requiresTownHall: 2, trainingSlots: 1 },
      { cost: { wood: 800, gold: 500 }, buildSeconds: 120, hp: 750, requiresTownHall: 3, trainingSlots: 2 },
      { cost: { wood: 2000, gold: 1500 }, buildSeconds: 300, hp: 950, requiresTownHall: 4, trainingSlots: 2 },
    ],
  },
  temple: {
    type: 'temple',
    name: 'Templo',
    description: 'Entrena aldeanos como sanadores.',
    category: 'military',
    size: 3,
    trainsRole: 'healer',
    maxCountByTownHall: [0, 0, 1, 1, 1],
    levels: [
      { cost: { wood: 600, gold: 600 }, buildSeconds: 60, hp: 700, requiresTownHall: 3, trainingSlots: 1 },
      { cost: { wood: 1500, gold: 1500 }, buildSeconds: 180, hp: 900, requiresTownHall: 4, trainingSlots: 1 },
      { cost: { wood: 3500, gold: 3500 }, buildSeconds: 400, hp: 1100, requiresTownHall: 5, trainingSlots: 2 },
    ],
  },
  wall: {
    type: 'wall',
    name: 'Muralla',
    description: 'Frena a los atacantes. Arrastra para levantar tramos rectos al instante. Mejora de empalizada a muro de piedra y a muralla de castillo.',
    category: 'defense',
    size: 1,
    maxCountByTownHall: [20, 40, 60, 80, 100],
    levels: [
      { cost: { gold: 10 }, buildSeconds: 0, hp: 300, requiresTownHall: 1 },
      { cost: { gold: 60 }, buildSeconds: 0, hp: 600, requiresTownHall: 2 },
      { cost: { gold: 200 }, buildSeconds: 0, hp: 1000, requiresTownHall: 3 },
    ],
  },
  siegeWorkshop: {
    type: 'siegeWorkshop',
    name: 'Taller de asedio',
    description: 'Forma a los aldeanos para manejar catapultas.',
    category: 'military',
    size: 3,
    trainsRole: 'catapult',
    maxCountByTownHall: [0, 1, 1, 1, 2],
    levels: [
      { cost: { wood: 500, gold: 300 }, buildSeconds: 60, hp: 700, requiresTownHall: 2, trainingSlots: 1 },
      { cost: { wood: 1200, gold: 900 }, buildSeconds: 150, hp: 900, requiresTownHall: 3, trainingSlots: 1 },
      { cost: { wood: 2500, gold: 2000 }, buildSeconds: 300, hp: 1100, requiresTownHall: 4, trainingSlots: 2 },
    ],
  },
  infirmary: {
    type: 'infirmary',
    name: 'Enfermería',
    description: 'Acoge a los soldados que caen en batalla. Si no hay camas, mueren. Curarlos cuesta recursos y tiempo.',
    category: 'military',
    size: 3,
    maxCountByTownHall: [1, 1, 2, 2, 3],
    levels: [
      { cost: { wood: 150, gold: 100 }, buildSeconds: 20, hp: 500, requiresTownHall: 1, beds: 3, healSpeed: 1 },
      { cost: { wood: 450, gold: 350 }, buildSeconds: 60, hp: 700, requiresTownHall: 2, beds: 5, healSpeed: 1.3 },
      { cost: { wood: 1200, gold: 1000 }, buildSeconds: 180, hp: 900, requiresTownHall: 3, beds: 8, healSpeed: 1.7 },
    ],
  },
  archerTower: {
    type: 'archerTower',
    name: 'Torre de arqueros',
    description: 'Defensa a distancia. En el futuro podrá guarnecerse con arqueros.',
    category: 'defense',
    size: 2,
    maxCountByTownHall: [1, 2, 2, 3, 4],
    levels: [
      { cost: { wood: 250, gold: 150 }, buildSeconds: 30, hp: 600, requiresTownHall: 1, damage: 12, range: 7 },
      { cost: { wood: 700, gold: 500 }, buildSeconds: 120, hp: 850, requiresTownHall: 2, damage: 18, range: 8 },
      { cost: { wood: 1800, gold: 1400 }, buildSeconds: 300, hp: 1100, requiresTownHall: 3, damage: 26, range: 9 },
    ],
  },
};

export const BUILDING_TYPES = Object.keys(BUILDING_DEFS) as BuildingType[];

export const VILLAGER_NAMES = [
  'Aldo', 'Berta', 'Ciro', 'Dalia', 'Elio', 'Fausta', 'Gael', 'Hilda', 'Iñigo', 'Juana',
  'Lope', 'Marta', 'Nuño', 'Olga', 'Pedro', 'Quima', 'Ramiro', 'Sancha', 'Tello', 'Urraca',
  'Vela', 'Ximena', 'Yago', 'Zoila', 'Álvar', 'Beltrán', 'Constanza', 'Diego', 'Elvira', 'Fruela',
];

// ---------------------------------------------------------------------------
// Monstruos (campamentos que aparecen alrededor de la aldea)
// ---------------------------------------------------------------------------

export const MONSTERS = ['minion', 'skeletonWarrior', 'skeletonRogue', 'skeletonMage', 'boneLord'] as const;
export type MonsterId = (typeof MONSTERS)[number];

export interface MonsterDef {
  name: string;
  hp: number; // a nivel 1; cada nivel de campamento suma un 35 %
  damage: number;
  range: number;
  speed: number;
  interval: number; // segundos entre ataques
  aggro: number;
  ranged: boolean;
  loot: Cost; // botín que suelta al caer (a nivel 1)
}

export const MONSTER_DEFS: Record<MonsterId, MonsterDef> = {
  minion: { name: 'Esbirro', hp: 55, damage: 7, range: 1, speed: 2.2, interval: 0.9, aggro: 6, ranged: false, loot: { gold: 8 } },
  skeletonWarrior: { name: 'Guerrero esqueleto', hp: 140, damage: 13, range: 1, speed: 1.7, interval: 1.1, aggro: 6, ranged: false, loot: { gold: 20, wood: 10 } },
  skeletonRogue: { name: 'Ballestero esqueleto', hp: 75, damage: 10, range: 6, speed: 1.8, interval: 1.3, aggro: 8, ranged: true, loot: { gold: 15, food: 10 } },
  skeletonMage: { name: 'Nigromante', hp: 90, damage: 16, range: 5, speed: 1.5, interval: 1.6, aggro: 8, ranged: true, loot: { gold: 30, food: 15 } },
  boneLord: { name: 'Señor de los huesos', hp: 520, damage: 28, range: 1.2, speed: 1.4, interval: 1.4, aggro: 7, ranged: false, loot: { gold: 150, wood: 80, food: 80 } },
};

/** Cada cuánto aparece un campamento nuevo (si hay hueco) y cuántos puede haber. */
export const CAMP_SPAWN_SECONDS = 8 * 60;
export const MAX_CAMPS = 3;

/**
 * Claros en el bosque alrededor de la aldea donde acampan los monstruos
 * (coordenadas del mundo, con la parcela de 40×40 centrada en el origen).
 */
export const CAMP_SLOTS: { x: number; z: number }[] = [
  { x: 30, z: 6 },
  { x: -4, z: 31 },
  { x: 25, z: -25 },
  { x: -30, z: 14 },
  { x: 6, z: -31 },
  { x: 29, z: 27 },
];
