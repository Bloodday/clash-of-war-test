import {
  MAX_OFFLINE_SECONDS,
  TICK_RATE,
  advance,
  createInitialState,
  deserialize,
  executeCommand,
  serialize,
  tick,
  type Command,
  type CommandResult,
  type GameState,
} from '@cow/shared';

const SAVE_KEY = 'clash-of-war:save';
const TICK_MS = 1000 / TICK_RATE;
const AUTOSAVE_MS = 5000;

/**
 * Dueño del estado en el cliente. Ejecuta la simulación a tick fijo,
 * independiente de los FPS del render. Cuando exista backend, `dispatch`
 * enviará el comando al servidor además de aplicarlo localmente.
 */
export class GameController {
  speed = 1;
  private acc = 0;
  private sinceSave = 0;
  private listeners = new Set<() => void>();

  constructor(public state: GameState) {}

  static load(): { game: GameController; offlineSeconds: number } {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(SAVE_KEY);
    } catch {
      /* almacenamiento no disponible */
    }
    const loaded = raw ? deserialize(raw, Date.now()) : null;
    const game = new GameController(loaded?.state ?? createInitialState(Date.now() >>> 0));
    return { game, offlineSeconds: loaded?.offlineSeconds ?? 0 };
  }

  /** Llamar una vez por frame con el tiempo real transcurrido. */
  update(realDtMs: number): void {
    this.sinceSave += realDtMs;
    let changed = false;
    // Pestaña en segundo plano: el navegador pausa el bucle, pero la aldea no.
    if (realDtMs > 1000) {
      const gapMs = Math.min(realDtMs, MAX_OFFLINE_SECONDS * 1000) * this.speed;
      advance(this.state, Math.floor(gapMs / TICK_MS));
      realDtMs = 0;
      changed = true;
    }
    this.acc += realDtMs * this.speed;
    for (let steps = 0; this.acc >= TICK_MS && steps < 2000; steps++) {
      tick(this.state);
      this.acc -= TICK_MS;
      changed = true;
    }
    if (changed) this.notify();
    if (this.sinceSave >= AUTOSAVE_MS) this.save();
  }

  dispatch(cmd: Command): CommandResult {
    const result = executeCommand(this.state, cmd);
    if (result.ok) {
      this.notify();
      this.save();
    }
    return result;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  save(): void {
    this.sinceSave = 0;
    try {
      localStorage.setItem(SAVE_KEY, serialize(this.state, Date.now()));
    } catch {
      /* almacenamiento no disponible */
    }
  }

  reset(): void {
    this.state = createInitialState(Date.now() >>> 0);
    this.save();
    this.notify();
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}
