import { TICK_RATE } from './data';
import { advance } from './sim';
import type { GameState } from './state';

// Serialización local. Cuando exista backend, el servidor será quien guarde
// el estado y calcule el progreso offline con esta misma lógica.

export interface SaveFile {
  savedAt: number; // ms epoch
  state: GameState;
}

export const MAX_OFFLINE_SECONDS = 8 * 60 * 60;

export function serialize(state: GameState, now: number): string {
  const file: SaveFile = { savedAt: now, state };
  return JSON.stringify(file);
}

/** Devuelve el estado guardado ya avanzado con el tiempo transcurrido offline. */
export function deserialize(json: string, now: number): { state: GameState; offlineSeconds: number } | null {
  try {
    const file = JSON.parse(json) as SaveFile;
    if (!file?.state || file.state.version !== 1) return null;
    const elapsed = Math.max(0, Math.min(MAX_OFFLINE_SECONDS, (now - file.savedAt) / 1000));
    advance(file.state, elapsed * TICK_RATE);
    return { state: file.state, offlineSeconds: elapsed };
  } catch {
    return null;
  }
}
