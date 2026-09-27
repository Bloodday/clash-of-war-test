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

export const ROLES = ['warrior', 'archer', 'healer'] as const;
export type RoleId = (typeof ROLES)[number];

export interface RoleLevelDef {
  cost: Cost;
  trainSeconds: number;
  // Estadísticas de combate (se usarán en la fase RTS/FPS).
  hp: number;
  damage: number;
  range: number;
}

export interface RoleDef {
  name: string;
  description: string;
  trainedAt: BuildingType;
  levels: RoleLevelDef[]; // índice 0 = nivel 1
}

export const ROLE_DEFS: Record<RoleId, RoleDef> = {
  warrior: {
    name: 'Guerrero',
    description: 'Combatiente cuerpo a cuerpo. Primera línea de ataque y defensa.',
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
    trainedAt: 'temple',
    levels: [
      { cost: { food: 100, gold: 100 }, trainSeconds: 30, hp: 80, damage: 10, range: 4 },
      { cost: { food: 250, gold: 250 }, trainSeconds: 90, hp: 110, damage: 15, range: 5 },
      { cost: { food: 500, gold: 600 }, trainSeconds: 200, hp: 150, damage: 22, range: 6 },
    ],
  },
};

export const RECRUIT_COST: Cost = { food: 60 };

// ---------------------------------------------------------------------------
// Edificios
// ---------------------------------------------------------------------------

export type BuildingType =
  | 'townHall'
  | 'house'
  | 'farm'
  | 'lumberCamp'
  | 'goldMine'
  | 'storehouse'
  | 'barracks'
  | 'archeryRange'
  | 'temple'
  | 'wall'
  | 'archerTower';

export type BuildingCategory = 'core' | 'economy' | 'military' | 'defense';

export interface BuildingLevelDef {
  cost: Cost;
  buildSeconds: number; // 0 = instantáneo y no necesita constructor
  hp: number;
  requiresTownHall: number;
  housing?: number;
  storage?: Cost;
  workerSlots?: number;
  productionPerWorker?: Cost; // por segundo
  trainingSlots?: number;
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
  farm: {
    type: 'farm',
    name: 'Granja',
    description: 'Los aldeanos asignados producen comida.',
    category: 'economy',
    size: 3,
    maxCountByTownHall: [1, 2, 2, 3, 3],
    levels: [
      { cost: { wood: 80 }, buildSeconds: 10, hp: 400, requiresTownHall: 1, workerSlots: 2, productionPerWorker: { food: 0.5 } },
      { cost: { wood: 250, gold: 150 }, buildSeconds: 45, hp: 550, requiresTownHall: 2, workerSlots: 3, productionPerWorker: { food: 0.75 } },
      { cost: { wood: 700, gold: 400 }, buildSeconds: 120, hp: 700, requiresTownHall: 3, workerSlots: 4, productionPerWorker: { food: 1 } },
    ],
  },
  lumberCamp: {
    type: 'lumberCamp',
    name: 'Aserradero',
    description: 'Los aldeanos asignados talan y producen madera.',
    category: 'economy',
    size: 3,
    maxCountByTownHall: [1, 2, 2, 3, 3],
    levels: [
      { cost: { gold: 80 }, buildSeconds: 10, hp: 400, requiresTownHall: 1, workerSlots: 2, productionPerWorker: { wood: 0.5 } },
      { cost: { gold: 250, wood: 150 }, buildSeconds: 45, hp: 550, requiresTownHall: 2, workerSlots: 3, productionPerWorker: { wood: 0.75 } },
      { cost: { gold: 700, wood: 400 }, buildSeconds: 120, hp: 700, requiresTownHall: 3, workerSlots: 4, productionPerWorker: { wood: 1 } },
    ],
  },
  goldMine: {
    type: 'goldMine',
    name: 'Mina de oro',
    description: 'Los aldeanos asignados extraen oro.',
    category: 'economy',
    size: 3,
    maxCountByTownHall: [1, 2, 2, 3, 3],
    levels: [
      { cost: { wood: 120 }, buildSeconds: 15, hp: 450, requiresTownHall: 1, workerSlots: 2, productionPerWorker: { gold: 0.4 } },
      { cost: { wood: 300, gold: 150 }, buildSeconds: 60, hp: 600, requiresTownHall: 2, workerSlots: 3, productionPerWorker: { gold: 0.6 } },
      { cost: { wood: 800, gold: 400 }, buildSeconds: 150, hp: 750, requiresTownHall: 3, workerSlots: 4, productionPerWorker: { gold: 0.85 } },
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
    name: 'Muro',
    description: 'Frena a los atacantes. Se construye al instante.',
    category: 'defense',
    size: 1,
    maxCountByTownHall: [20, 40, 60, 80, 100],
    levels: [
      { cost: { gold: 10 }, buildSeconds: 0, hp: 300, requiresTownHall: 1 },
      { cost: { gold: 60 }, buildSeconds: 0, hp: 600, requiresTownHall: 2 },
      { cost: { gold: 200 }, buildSeconds: 0, hp: 1000, requiresTownHall: 3 },
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
