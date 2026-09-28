import { useState } from 'preact/hooks';
import { BUILDING_DEFS } from '@cow/shared';
import type { GameController } from '../game/GameController';
import type { UiStore } from './UiStore';
import { useSubscription } from './hooks';
import { TopBar } from './TopBar';
import { BuildMenu } from './BuildMenu';
import { BuildingPanel } from './BuildingPanel';
import { VillagersPanel } from './VillagersPanel';
import { BattleHud } from './BattleHud';
import { availableArmy } from '@cow/shared';
import { QUALITY_LABELS, type Quality } from '../render/postfx';

const SPEEDS = [1, 5, 20];

export function App({ game, ui }: { game: GameController; ui: UiStore }) {
  useSubscription(game);
  useSubscription(ui);
  const [buildOpen, setBuildOpen] = useState(false);
  const [villagersOpen, setVillagersOpen] = useState(false);
  const state = game.state;
  if (ui.battle) return <BattleHud battle={ui.battle} ui={ui} />;
  const army = availableArmy(state).length;
  const selected = ui.selectedId !== null ? state.buildings.find((b) => b.id === ui.selectedId) : undefined;
  const mode = ui.mode;

  let hint =
    'Pasa el ratón por las burbujas para recolectar · Clic: seleccionar · Arrastrar: desplazar · Clic derecho: rotar · Rueda: zoom · 💀 Ataca campamentos de monstruos en el bosque';
  if (mode.kind === 'place') {
    const name = BUILDING_DEFS[mode.building].name;
    hint =
      mode.building === 'wall'
        ? `Colocando ${name} · Clic o arrastra para trazar una línea recta · Esc o clic derecho: cancelar`
        : `Colocando ${name} · Clic para construir · Mayús: en cadena · Esc o clic derecho: cancelar`;
  } else if (mode.kind === 'move') {
    hint = 'Moviendo edificio · Clic en el destino · Esc o clic derecho: cancelar';
  }

  return (
    <>
      <TopBar state={state} />

      <div class="corner panel">
        {ui.backend && <span class="badge" title="Backend de render">{ui.backend}</span>}
        <select
          class="quality"
          title="Calidad gráfica"
          value={ui.quality}
          onChange={(e) => ui.setQuality((e.target as HTMLSelectElement).value as Quality)}
        >
          {(Object.keys(QUALITY_LABELS) as Quality[]).map((q) => (
            <option key={q} value={q}>
              Calidad {QUALITY_LABELS[q]}
            </option>
          ))}
        </select>
        <span class="muted">Velocidad</span>
        {SPEEDS.map((s) => (
          <button
            key={s}
            class={game.speed === s ? 'small active' : 'small'}
            onClick={() => {
              game.speed = s;
              ui.notify();
            }}
          >
            ×{s}
          </button>
        ))}
        <button class="small" title="Daña edificios al azar para probar las reparaciones" onClick={() => ui.simulateAttack()}>
          💥 Simular ataque
        </button>
        <button
          class="small danger"
          onClick={() => {
            if (confirm('¿Reiniciar la aldea? Se perderá el progreso.')) {
              ui.select(null);
              ui.setMode({ kind: 'idle' });
              game.reset();
            }
          }}
        >
          Reiniciar
        </button>
      </div>

      {selected && mode.kind === 'idle' && <BuildingPanel key={selected.id} game={game} ui={ui} building={selected} />}
      {buildOpen && <BuildMenu state={state} ui={ui} onClose={() => setBuildOpen(false)} />}
      {villagersOpen && <VillagersPanel state={state} ui={ui} onClose={() => setVillagersOpen(false)} />}

      <div class="bottom">
        <div class="hint" key={hint}>
          {hint}
        </div>
        <div class="bottom-buttons">
          <button class="big" onClick={() => setVillagersOpen(!villagersOpen)}>
            👥 Aldeanos
          </button>
          <button
            class="big attack"
            disabled={army === 0}
            title={army === 0 ? 'Entrena soldados (cuartel, campo de tiro, templo o taller de asedio) para atacar' : `${army} soldados listos`}
            onClick={() => {
              setBuildOpen(false);
              setVillagersOpen(false);
              ui.startBattle();
            }}
          >
            ⚔️ Atacar
          </button>
          <button
            class="big primary"
            onClick={() => {
              ui.setMode({ kind: 'idle' });
              setBuildOpen(!buildOpen);
            }}
          >
            🔨 Construir
          </button>
        </div>
      </div>

      <div class="toasts">
        {ui.toasts.map((t) => (
          <div key={t.id} class={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </>
  );
}
