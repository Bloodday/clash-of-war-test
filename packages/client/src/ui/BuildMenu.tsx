import { useState } from 'preact/hooks';
import {
  BUILDING_DEFS,
  BUILDING_TYPES,
  canAfford,
  countBuildings,
  getTownHallLevel,
  maxBuildings,
  type BuildingCategory,
  type GameState,
} from '@cow/shared';
import type { UiStore } from './UiStore';
import { CostView } from './components';
import { fmtTime } from './format';

const CATEGORIES: { id: BuildingCategory; name: string }[] = [
  { id: 'core', name: 'Aldea' },
  { id: 'economy', name: 'Economía' },
  { id: 'military', name: 'Militar' },
  { id: 'defense', name: 'Defensa' },
];

export function BuildMenu({ state, ui, onClose }: { state: GameState; ui: UiStore; onClose: () => void }) {
  const [tab, setTab] = useState<BuildingCategory>('core');
  const th = getTownHallLevel(state);
  const types = BUILDING_TYPES.filter((t) => BUILDING_DEFS[t].category === tab && t !== 'townHall');

  return (
    <div class="build-menu panel">
      <div class="panel-header">
        <h2>Construir</h2>
        <button class="icon" onClick={onClose} title="Cerrar">
          ✕
        </button>
      </div>
      <div class="tabs">
        {CATEGORIES.map((c) => (
          <button key={c.id} class={c.id === tab ? 'tab active' : 'tab'} onClick={() => setTab(c.id)}>
            {c.name}
          </button>
        ))}
      </div>
      <div class="cards">
        {types.map((type) => {
          const def = BUILDING_DEFS[type];
          const first = def.levels[0]!;
          const count = countBuildings(state, type);
          const max = maxBuildings(state, type);
          let reason = '';
          if (th < first.requiresTownHall) reason = `Requiere ayuntamiento ${first.requiresTownHall}`;
          else if (count >= max) reason = max === 0 ? `Requiere mejorar el ayuntamiento` : 'Límite alcanzado';
          else if (!canAfford(state, first.cost)) reason = 'Faltan recursos';
          const disabled = reason !== '' && reason !== 'Faltan recursos';
          return (
            <button
              key={type}
              class={disabled ? 'card disabled' : 'card'}
              disabled={disabled}
              onClick={() => {
                ui.select(null);
                ui.setMode({ kind: 'place', building: type });
                onClose();
              }}
            >
              <div class="card-title">
                {def.name}
                <small>
                  {count}/{max}
                </small>
              </div>
              <div class="card-desc">{def.description}</div>
              <div class="card-meta">
                <CostView cost={first.cost} state={state} />
                <small>
                  {def.size}×{def.size} · {first.buildSeconds > 0 ? fmtTime(first.buildSeconds) : 'instantáneo'}
                </small>
              </div>
              {reason && <div class="card-reason">{reason}</div>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
