import {
  RESOURCES,
  RESOURCE_NAMES,
  getHousing,
  getIdleBuilders,
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
  const builders = state.villagers.filter((v) => v.role === 'builder').length;
  const idleBuilders = getIdleBuilders(state).length;
  const unformed = state.villagers.filter((v) => v.role === null).length;
  const soldiersOnly = state.villagers.filter((v) => v.role !== null && v.role !== 'builder').length;
  const wounded = state.villagers.filter((v) => v.task.kind === 'wounded').length;
  return (
    <div class="topbar panel">
      <div class="stat" title="Nivel del ayuntamiento">
        🏰 <b>{getTownHallLevel(state)}</b>
      </div>
      {RESOURCES.map((r) => (
        <div class="stat resource" key={r} title={RESOURCE_NAMES[r]} data-res={r}>
          <span class="res-icon">{RESOURCE_ICONS[r]}</span>
          <div class="resource-body">
            <div>
              <AnimatedNumber value={state.resources[r]} />
              <small> / {fmtNum(cap[r])}</small>
            </div>
            <div class="meter">
              <div class="meter-fill" style={{ width: `${Math.min(100, (state.resources[r] / Math.max(1, cap[r])) * 100)}%` }} />
            </div>
            <small class="rate" title="Producción de tus edificios (hay que recolectarla)">
              {rates[r] > 0 ? `+${fmtNum(rates[r] * 60)}/min` : '—'}
            </small>
          </div>
        </div>
      ))}
      <div class="stat" title="Aldeanos / alojamiento">
        👥 <b>{state.villagers.length}</b>
        <small> / {getHousing(state)}</small>
      </div>
      <div class={idleBuilders === 0 ? 'stat busy' : 'stat'} title="Albañiles libres / albañiles">
        🔨 <b>{idleBuilders}</b>
        <small> / {builders}</small>
      </div>
      <div class={unformed > 0 ? 'stat waiting' : 'stat'} title="Aldeanos sin formar: mándalos al taller o a un edificio militar">
        🧑 <b>{unformed}</b>
      </div>
      <div class="stat" title="Soldados entrenados">
        ⚔️ <b>{soldiersOnly}</b>
      </div>
      {wounded > 0 && (
        <div class="stat waiting" title="Heridos en la enfermería: págales la cura para que vuelvan a luchar">
          🩹 <b>{wounded}</b>
        </div>
      )}
    </div>
  );
}
