import {
  BATTLE_TICK_RATE,
  applyBattleResult,
  availableArmy,
  baseLoot,
  createBattle,
  executeBattleCommand,
  generateEnemyBase,
  getTownHallLevel,
  stepBattle,
  type BattleCommand,
  type BattleCommandResult,
  type BattleEvent,
  type BattleState,
  type ResourceId,
} from '@cow/shared';
import type { GameController } from './GameController';

const TICK_MS = 1000 / BATTLE_TICK_RATE;

export interface BattleSummary {
  stars: number;
  destruction: number;
  gained: Record<ResourceId, number>;
  fallen: string[];
  reason: string;
}

/**
 * Dueño de una batalla en el cliente: avanza la simulación a tick fijo,
 * acumula los eventos para los efectos y, al terminar, aplica el resultado
 * a la aldea. Cuando exista el servidor, los comandos irán por red.
 */
export class BattleController {
  state: BattleState;
  readonly loot: Record<ResourceId, number>;
  /** Fracción del tick actual transcurrida (para interpolar el render). */
  alpha = 0;
  summary: BattleSummary | null = null;
  /** Multiplicador de tiempo (pruebas). */
  speed = 1;
  private acc = 0;
  private pending: BattleEvent[] = [];
  private listeners = new Set<() => void>();

  constructor(
    private game: GameController,
    readonly seed: number,
  ) {
    const base = generateEnemyBase(seed, Math.max(1, getTownHallLevel(game.state)));
    this.loot = baseLoot(base);
    this.state = createBattle(base, availableArmy(game.state));
  }

  update(realDtMs: number): void {
    if (this.state.phase !== 'fighting') {
      this.alpha = 1;
      return;
    }
    this.acc += Math.min(realDtMs, 250) * this.speed;
    let stepped = false;
    while (this.acc >= TICK_MS && this.state.phase === 'fighting') {
      stepBattle(this.state);
      this.pending.push(...this.state.events);
      this.acc -= TICK_MS;
      stepped = true;
    }
    this.alpha = Math.min(1, this.acc / TICK_MS);
    if (this.ended && !this.summary) this.finish();
    if (stepped) this.notify();
  }

  get ended(): boolean {
    return this.state.phase === 'ended';
  }

  dispatch(cmd: BattleCommand): BattleCommandResult {
    const res = executeBattleCommand(this.state, cmd);
    this.pending.push(...this.state.events);
    this.state.events = [];
    if (res.ok) {
      if (this.ended && !this.summary) this.finish();
      this.notify();
    }
    return res;
  }

  /** Eventos ocurridos desde la última llamada. */
  takeEvents(): BattleEvent[] {
    const e = this.pending;
    this.pending = [];
    return e;
  }

  /** Aplica el resultado a la aldea (una sola vez). */
  private finish(): void {
    const result = this.state.result!;
    const { gained } = applyBattleResult(this.game.state, result);
    const fallen = result.fallen.map((id) => this.game.state.villagers.find((v) => v.id === id)?.name ?? '?');
    this.summary = { stars: result.stars, destruction: result.destruction, gained, fallen, reason: result.reason };
    this.game.save();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}
