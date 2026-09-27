import {
  RESOURCES,
  RESOURCE_NAMES,
  getHousing,
  getProductionRates,
  getStorageCapacity,
  getTownHallLevel,
  type GameState,
} from '@cow/shared';
import { RESOURCE_ICONS, fmtNum } from './format';
import { AnimatedNumber } from './AnimatedNumber';

export function TopBar({ state }: { state: GameState }) {
  const cap = getStorageCapacity(state);
  const rates = getProductionRates(state);
  const soldiers = state.villagers.filter((v) => v.role !== null).length;
  return (
    <div class="topbar panel">
      <div class="stat" title="Nivel del ayuntamiento">
        🏰 <b>{getTownHallLevel(state)}</b>
      </div>
      {RESOURCES.map((r) => (
        <div class="stat resource" key={r} title={RESOURCE_NAMES[r]}>
          <span class="res-icon">{RESOURCE_ICONS[r]}</span>
          <div class="resource-body">
            <div>
              <AnimatedNumber value={state.resources[r]} />
              <small> / {fmtNum(cap[r])}</small>
            </div>
            <div class="meter">
              <div class="meter-fill" style={{ width: `${Math.min(100, (state.resources[r] / Math.max(1, cap[r])) * 100)}%` }} />
            </div>
            <small class="rate">{rates[r] > 0 ? `+${fmtNum(rates[r] * 60)}/min` : '—'}</small>
          </div>
        </div>
      ))}
      <div class="stat" title="Aldeanos / alojamiento">
        👥 <b>{state.villagers.length}</b>
        <small> / {getHousing(state)}</small>
      </div>
      <div class="stat" title="Soldados entrenados">
        ⚔️ <b>{soldiers}</b>
      </div>
    </div>
  );
}
