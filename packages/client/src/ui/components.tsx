import type { Cost, GameState } from '@cow/shared';
import { RESOURCE_ICONS, costEntries, fmtNum } from './format';

export function CostView({ cost, state }: { cost: Cost; state: GameState }) {
  const entries = costEntries(cost);
  if (entries.length === 0) return <span class="cost">Gratis</span>;
  return (
    <span class="cost">
      {entries.map(([r, n]) => (
        <span key={r} class={state.resources[r] < n ? 'cost-item missing' : 'cost-item'}>
          {RESOURCE_ICONS[r]} {fmtNum(n)}
        </span>
      ))}
    </span>
  );
}

export function Progress({ value }: { value: number }) {
  return (
    <div class="progress">
      <div class="progress-fill" style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />
    </div>
  );
}
