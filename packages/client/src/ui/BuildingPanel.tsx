import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import {
  BUILDING_DEFS,
  RECRUIT_COST,
  RESOURCES,
  ROLE_DEFS,
  TICK_RATE,
  currentLevelDef,
  getBuildingProduction,
  getHousing,
  getIdleCivilians,
  getTownHallLevel,
  getTrainees,
  getWorkers,
  nextRoleLevel,
  roleMaxLevel,
  type Building,
  type Command,
  type GameState,
  type Villager,
} from '@cow/shared';
import type { GameController } from '../game/GameController';
import type { UiStore } from './UiStore';
import { CostView, Progress } from './components';
import { ERROR_MESSAGES, RESOURCE_ICONS, fmtNum, fmtTime, roleLabel } from './format';

interface Props {
  game: GameController;
  ui: UiStore;
  building: Building;
}

export function BuildingPanel({ game, ui, building: b }: Props) {
  const state = game.state;
  const def = BUILDING_DEFS[b.type];
  const cur = currentLevelDef(b);
  const next = def.levels[b.level];

  const run = (cmd: Command, okMsg?: string) => {
    const res = game.dispatch(cmd);
    if (!res.ok) ui.toast(ERROR_MESSAGES[res.error], 'error');
    else if (okMsg) ui.toast(okMsg);
  };

  return (
    <div class="side-panel panel">
      <div class="panel-header">
        {ui.thumbnails.get(`${b.type}:${Math.max(1, b.level)}`) && (
          <img class="panel-thumb" src={ui.thumbnails.get(`${b.type}:${Math.max(1, b.level)}`)} alt="" />
        )}
        <h2>
          {def.name}
          <small>{b.level > 0 ? `Nivel ${b.level}` : 'En obras'}</small>
          {b.level > 0 && <span class="stars">{'★'.repeat(b.level)}<span class="off">{'★'.repeat(def.levels.length - b.level)}</span></span>}
        </h2>
        <button class="icon" onClick={() => ui.select(null)} title="Cerrar">
          ✕
        </button>
      </div>
      <p class="muted">{def.description}</p>

      {b.construction && (
        <section>
          <h3>{b.level === 0 ? 'Construyendo' : `Mejorando a nivel ${b.construction.targetLevel}`}</h3>
          <Progress value={1 - b.construction.remainingTicks / b.construction.totalTicks} />
          <small>
            Quedan {fmtTime(b.construction.remainingTicks / TICK_RATE)} · Constructor:{' '}
            {state.villagers.find((v) => v.id === b.construction!.builderId)?.name ?? '—'}
          </small>
        </section>
      )}

      {cur && <Stats state={state} building={b} />}

      {cur?.workerSlots && <Workers state={state} building={b} run={run} />}

      {def.trainsRole && b.level > 0 && <Training state={state} building={b} run={run} />}

      {b.type === 'townHall' && (
        <section>
          <h3>Aldeanos</h3>
          <div class="row">
            <span>
              {state.villagers.length} / {getHousing(state)} alojados
            </span>
            <button onClick={() => run({ type: 'recruitVillager' }, 'Ha llegado un nuevo aldeano')}>
              Reclutar <CostView cost={RECRUIT_COST} state={state} />
            </button>
          </div>
        </section>
      )}

      <section class="actions">
        {b.level === 0 ? null : next ? (
          <button
            class="primary"
            disabled={b.construction !== null || getTownHallLevel(state) < next.requiresTownHall}
            onClick={() => run({ type: 'upgradeBuilding', buildingId: b.id }, `Mejora de ${def.name} iniciada`)}
          >
            <span>
              Mejorar a nivel {b.level + 1}
              {next.buildSeconds > 0 ? ` · ${fmtTime(next.buildSeconds)}` : ''}
              {next.requiresTownHall > 1 && b.type !== 'townHall' ? ` · Ayto. ${next.requiresTownHall}` : ''}
            </span>
            <CostView cost={next.cost} state={state} />
          </button>
        ) : (
          <span class="muted">Nivel máximo</span>
        )}
        <button onClick={() => ui.setMode({ kind: 'move', buildingId: b.id })}>Mover</button>
      </section>
    </div>
  );
}

function Stats({ state, building: b }: { state: GameState; building: Building }) {
  const cur = currentLevelDef(b)!;
  const rows: [string, string][] = [['Vida', fmtNum(cur.hp)]];
  if (cur.housing) rows.push(['Alojamiento', `${cur.housing} aldeanos`]);
  if (cur.storage) rows.push(['Almacena', RESOURCES.map((r) => `${RESOURCE_ICONS[r]} ${fmtNum(cur.storage![r] ?? 0)}`).join('  ')]);
  if (cur.productionPerWorker) {
    const prod = getBuildingProduction(state, b);
    const per = RESOURCES.filter((r) => cur.productionPerWorker![r]).map(
      (r) => `${RESOURCE_ICONS[r]} ${fmtNum((cur.productionPerWorker![r] ?? 0) * 60)}/min por trabajador`,
    );
    rows.push(['Rendimiento', per.join(' ')]);
    rows.push(['Produciendo', RESOURCES.filter((r) => prod[r]).map((r) => `${RESOURCE_ICONS[r]} ${fmtNum(prod[r]! * 60)}/min`).join(' ') || 'nada']);
  }
  if (cur.trainingSlots) rows.push(['Plazas de entrenamiento', String(cur.trainingSlots)]);
  if (cur.damage) rows.push(['Daño / alcance', `${cur.damage} / ${cur.range}`]);
  return (
    <section>
      <dl class="stats">
        {rows.map(([k, v]) => (
          <Fragment key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </Fragment>
        ))}
      </dl>
    </section>
  );
}

type Run = (cmd: Command, okMsg?: string) => void;

function Workers({ state, building: b, run }: { state: GameState; building: Building; run: Run }) {
  const slots = currentLevelDef(b)?.workerSlots ?? 0;
  const workers = getWorkers(state, b.id);
  const idle = getIdleCivilians(state);
  return (
    <section>
      <h3>
        Trabajadores {workers.length}/{slots}
      </h3>
      <ul class="list">
        {workers.map((v) => (
          <li key={v.id}>
            <span>{v.name}</span>
            <button class="small" onClick={() => run({ type: 'unassignWorker', villagerId: v.id })}>
              Retirar
            </button>
          </li>
        ))}
      </ul>
      {workers.length < slots && (
        <button
          disabled={idle.length === 0}
          onClick={() => idle[0] && run({ type: 'assignWorker', villagerId: idle[0].id, buildingId: b.id })}
        >
          + Asignar aldeano libre ({idle.length})
        </button>
      )}
    </section>
  );
}

function Training({ state, building: b, run }: { state: GameState; building: Building; run: Run }) {
  const role = BUILDING_DEFS[b.type].trainsRole!;
  const roleDef = ROLE_DEFS[role];
  const slots = currentLevelDef(b)?.trainingSlots ?? 0;
  const trainees = getTrainees(state, b.id);
  // Primero los que se pueden entrenar ya, y entre ellos los libres antes que los que trabajan.
  const rank = (v: Villager) => (b.level < nextRoleLevel(v, role) ? 2 : 0) + (v.task.kind === 'work' ? 1 : 0);
  const candidates = state.villagers
    .filter(
      (v) =>
        (v.task.kind === 'idle' || v.task.kind === 'work') &&
        (v.role === null || v.role === role) &&
        nextRoleLevel(v, role) <= roleMaxLevel(role),
    )
    .sort((x, y) => rank(x) - rank(y));
  const [selected, setSelected] = useState<number | null>(null);
  const chosen: Villager | undefined = candidates.find((v) => v.id === selected) ?? candidates[0];
  const target = chosen ? nextRoleLevel(chosen, role) : 0;
  const levelDef = chosen ? roleDef.levels[target - 1] : undefined;

  return (
    <section>
      <h3>
        Entrenamiento de {roleDef.name.toLowerCase()} {trainees.length}/{slots}
      </h3>
      <p class="muted">{roleDef.description}</p>
      <ul class="list">
        {trainees.map((v) =>
          v.task.kind === 'train' ? (
            <li key={v.id} class="col">
              <span>
                {v.name} → {roleDef.name} {v.task.targetLevel} · {fmtTime(v.task.remainingTicks / TICK_RATE)}
              </span>
              <Progress value={1 - v.task.remainingTicks / v.task.totalTicks} />
            </li>
          ) : null,
        )}
      </ul>
      {candidates.length === 0 ? (
        <p class="muted">No hay aldeanos disponibles para entrenar.</p>
      ) : (
        <div class="train-form">
          <select value={chosen?.id} onChange={(e) => setSelected(Number((e.target as HTMLSelectElement).value))}>
            {candidates.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} ({roleLabel(v)}
                {v.task.kind === 'work' ? ', trabajando' : ''}) → {roleDef.name} {nextRoleLevel(v, role)}
              </option>
            ))}
          </select>
          {levelDef && (
            <button
              class="primary"
              disabled={trainees.length >= slots || b.construction !== null || b.level < target}
              onClick={() => chosen && run({ type: 'trainVillager', villagerId: chosen.id, buildingId: b.id })}
            >
              <span>
                Entrenar · {fmtTime(levelDef.trainSeconds)}
                {b.level < target ? ` · requiere nivel ${target}` : ''}
              </span>
              <CostView cost={levelDef.cost} state={state} />
            </button>
          )}
        </div>
      )}
    </section>
  );
}
