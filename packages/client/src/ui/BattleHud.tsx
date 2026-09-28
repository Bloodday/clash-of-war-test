import { BATTLE_TICK_RATE, RESOURCES, ROLE_DEFS, type MilitaryRole, type ReserveUnit } from '@cow/shared';
import type { BattleController } from '../game/BattleController';
import type { UiStore } from './UiStore';
import { useSubscription } from './hooks';
import { RESOURCE_ICONS, fmtNum } from './format';

const ROLE_ICON: Record<MilitaryRole, string> = { warrior: '🗡️', archer: '🏹', healer: '✨', catapult: '🪨' };

function mmss(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function Stars({ count, flash }: { count: number; flash: number }) {
  return (
    <div class="stars-big">
      {[0, 1, 2].map((i) => (
        <span key={`${i}:${i < count}`} class={i < count ? (i === flash - 1 ? 'star lit new' : 'star lit') : 'star'}>
          ★
        </span>
      ))}
    </div>
  );
}

export function BattleHud({ battle, ui }: { battle: BattleController; ui: UiStore }) {
  useSubscription(battle);
  const s = battle.state;
  const groups = new Map<string, ReserveUnit[]>();
  for (const r of s.reserve) {
    const key = `${r.role}:${r.level}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const deployed = s.units.filter((u) => u.side === 'attacker');
  const alive = deployed.filter((u) => u.state !== 'dead').length;
  const selected = ui.selectedUnits().length;
  const remaining = (s.timeLimitTicks - s.tick) / BATTLE_TICK_RATE;

  let hint = 'Elige una tropa abajo y haz clic (o arrastra) fuera de la zona roja para desplegarla.';
  if (s.phase === 'fighting') {
    hint = ui.deploy
      ? 'Clic o arrastrar fuera de la zona roja: desplegar · Esc: dejar de desplegar'
      : 'Arrastra para seleccionar · Clic derecho: mover o atacar · Rueda: zoom · Botón central: desplazar';
  }

  return (
    <>
      <div class="battle-top panel">
        <div class="enemy">
          <b>{s.enemyName}</b>
          <small>{s.kind === 'camp' ? `💀 Campamento de monstruos · nivel ${s.enemyTownHall}` : `Ayuntamiento ${s.enemyTownHall}`}</small>
        </div>
        <div class="battle-center">
          {s.phase === 'scouting' ? <div class="timer scouting">Reconocimiento</div> : <div class={remaining < 30 ? 'timer low' : 'timer'}>{mmss(remaining)}</div>}
          <Stars count={s.stars} flash={ui.starFlash} />
          <div class="destruction">{Math.round(s.destruction * 100)}%</div>
        </div>
        <div class="loot">
          <small>{s.phase === 'scouting' ? 'Botín disponible' : 'Botín'}</small>
          {RESOURCES.map((r) => (
            <span key={r} class="loot-item" data-loot={r}>
              <span class="res-icon">{RESOURCE_ICONS[r]}</span>
              {s.phase === 'scouting' ? fmtNum(battle.loot[r]) : `${fmtNum(s.lootTaken[r] ?? 0)} / ${fmtNum(battle.loot[r])}`}
            </span>
          ))}
        </div>
      </div>

      {s.phase === 'scouting' && (
        <div class="battle-actions panel">
          {s.kind === 'village' && (
            <button class="small" onClick={() => ui.nextOpponent()}>
              Siguiente aldea ⟳
            </button>
          )}
          <button class="small" onClick={() => ui.leaveBattle()}>
            Volver a la aldea
          </button>
        </div>
      )}
      {s.phase === 'fighting' && (
        <div class="battle-actions panel">
          <span class="muted">
            {alive} en combate{selected ? ` · ${selected} seleccionados` : ''}
          </span>
          <button class="small" onClick={() => ui.selectAllUnits()} disabled={alive === 0}>
            Seleccionar todos
          </button>
          <button
            class="small"
            disabled={selected === 0}
            onClick={() => battle.dispatch({ type: 'order', unitIds: ui.selectedUnits(), order: { kind: 'auto' } })}
            title="Que ataquen por su cuenta al objetivo más cercano"
          >
            Ataque libre
          </button>
          <button
            class="small danger"
            onClick={() => {
              if (confirm('¿Terminar la batalla ahora? Te quedas con lo conseguido.')) battle.dispatch({ type: 'surrender' });
            }}
          >
            Terminar batalla
          </button>
        </div>
      )}

      {s.phase !== 'ended' && (
        <div class="bottom">
          <div class="hint" key={hint}>
            {hint}
          </div>
          <div class="army">
            {groups.size === 0 && <div class="army-empty muted">{deployed.length ? 'Todas tus tropas están desplegadas' : 'No tienes soldados'}</div>}
            {[...groups.entries()].map(([key, list], i) => {
              const r = list[0]!;
              return (
                <button
                  key={key}
                  class={ui.deploy === key ? 'troop active' : 'troop'}
                  style={{ '--i': i }}
                  onClick={() => {
                    ui.deploy = ui.deploy === key ? null : key;
                    ui.notify();
                  }}
                >
                  <span class="troop-icon">{ROLE_ICON[r.role]}</span>
                  <span class="troop-name">{ROLE_DEFS[r.role].name}</span>
                  <span class="troop-level">{'★'.repeat(r.level)}</span>
                  <span class="troop-count">×{list.length}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {battle.summary && (
        <div class="modal-backdrop">
          <div class="result panel">
            <h2>{battle.summary.stars > 0 ? '¡Victoria!' : 'Derrota'}</h2>
            <Stars count={battle.summary.stars} flash={0} />
            <div class="result-destruction">{Math.round(battle.summary.destruction * 100)}% de destrucción</div>
            <div class="result-loot">
              {RESOURCES.map((r) => (
                <span key={r}>
                  {RESOURCE_ICONS[r]} +{fmtNum(battle.summary!.gained[r])}
                </span>
              ))}
            </div>
            {RESOURCES.some((r) => (s.lootTaken[r] ?? 0) > battle.summary!.gained[r]) && (
              <small class="warn">Tus almacenes están llenos: parte del botín se perdió.</small>
            )}
            {battle.summary.campCleared && <p class="good">💀 ¡Campamento arrasado! Los monstruos no volverán a este claro.</p>}
            {battle.summary.wounded.length > 0 && (
              <p class="muted">
                🩹 Heridos en la enfermería: {battle.summary.wounded.join(', ')}. Págales la cura en la enfermería para que vuelvan a luchar.
              </p>
            )}
            {battle.summary.dead.length > 0 && (
              <p class="warn">
                ✝ Muertos (no había camas libres): {battle.summary.dead.join(', ')}. Construye o mejora enfermerías para salvar a más.
              </p>
            )}
            {battle.summary.wounded.length + battle.summary.dead.length === 0 && <p class="muted">¡Todos tus soldados vuelven sanos!</p>}
            <button class="primary big" onClick={() => ui.leaveBattle()}>
              Volver a la aldea
            </button>
          </div>
        </div>
      )}
    </>
  );
}
