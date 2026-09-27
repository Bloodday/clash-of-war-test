import type { GameState } from '@cow/shared';
import type { UiStore } from './UiStore';
import { roleLabel, taskLabel } from './format';

export function VillagersPanel({ state, ui, onClose }: { state: GameState; ui: UiStore; onClose: () => void }) {
  return (
    <div class="villagers-panel panel">
      <div class="panel-header">
        <h2>Aldeanos</h2>
        <button class="icon" onClick={onClose} title="Cerrar">
          ✕
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Rol</th>
            <th>Tarea</th>
          </tr>
        </thead>
        <tbody>
          {state.villagers.map((v) => {
            const target = 'buildingId' in v.task ? v.task.buildingId : null;
            return (
              <tr key={v.id} class={target !== null ? 'clickable' : ''} onClick={() => target !== null && ui.select(target)}>
                <td>{v.name}</td>
                <td class={v.role ? `role role-${v.role}` : 'role'}>{roleLabel(v)}</td>
                <td>{taskLabel(state, v)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
