import {
  BUILDING_DEFS,
  RESOURCES,
  ROLE_DEFS,
  type CommandError,
  type Cost,
  type GameState,
  type ResourceId,
  type Villager,
} from '@cow/shared';

export const RESOURCE_ICONS: Record<ResourceId, string> = {
  gold: '🪙',
  wood: '🪵',
  food: '🌾',
};

export const ERROR_MESSAGES: Record<CommandError, string> = {
  invalidCommand: 'Acción no válida.',
  unknownBuilding: 'Ese edificio no existe.',
  unknownVillager: 'Ese aldeano no existe.',
  limitReached: 'Has alcanzado el máximo para tu nivel de ayuntamiento.',
  townHallTooLow: 'Necesitas mejorar el ayuntamiento.',
  cannotAfford: 'No tienes recursos suficientes.',
  areaBlocked: 'No se puede colocar ahí.',
  noIdleBuilder: 'No hay aldeanos libres para construir.',
  busy: 'Está ocupado ahora mismo.',
  maxLevel: 'Ya está al nivel máximo.',
  notWorkplace: 'Este edificio no admite trabajadores.',
  noFreeSlot: 'No quedan huecos libres.',
  notCivilian: 'Los soldados no trabajan en la economía.',
  notTrainingBuilding: 'Este edificio no entrena roles.',
  buildingLevelTooLow: 'Mejora el edificio para entrenar el siguiente nivel.',
  noHousing: 'Construye o mejora casas para alojar a más aldeanos.',
};

export function fmtNum(n: number): string {
  return Math.floor(n).toLocaleString('es-ES');
}

export function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

export function costEntries(cost: Cost): [ResourceId, number][] {
  return RESOURCES.filter((r) => (cost[r] ?? 0) > 0).map((r) => [r, cost[r]!]);
}

export function roleLabel(v: Villager): string {
  return v.role ? `${ROLE_DEFS[v.role].name} ${v.roleLevel}` : 'Civil';
}

export function taskLabel(state: GameState, v: Villager): string {
  const t = v.task;
  const bName = (id: number) => {
    const b = state.buildings.find((x) => x.id === id);
    return b ? BUILDING_DEFS[b.type].name : '?';
  };
  switch (t.kind) {
    case 'idle':
      return v.role ? 'En guardia' : 'Libre';
    case 'work':
      return `Trabajando · ${bName(t.buildingId)}`;
    case 'build':
      return `Construyendo · ${bName(t.buildingId)}`;
    case 'train':
      return `Entrenando ${ROLE_DEFS[t.role].name} ${t.targetLevel}`;
  }
}
