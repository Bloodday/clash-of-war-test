import type { BuildingType } from '@cow/shared';

// Estado de interacción del jugador (no forma parte de la simulación).

export type InteractionMode =
  | { kind: 'idle' }
  | { kind: 'place'; building: BuildingType }
  | { kind: 'move'; buildingId: number };

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

export class UiStore {
  mode: InteractionMode = { kind: 'idle' };
  selectedId: number | null = null;
  toasts: Toast[] = [];
  backend = '';
  private nextToast = 1;
  private listeners = new Set<() => void>();

  setMode(mode: InteractionMode): void {
    this.mode = mode;
    this.notify();
  }

  select(id: number | null): void {
    this.selectedId = id;
    this.notify();
  }

  toast(text: string, kind: Toast['kind'] = 'info'): void {
    const t = { id: this.nextToast++, text, kind };
    this.toasts = [...this.toasts.slice(-3), t];
    this.notify();
    setTimeout(() => {
      this.toasts = this.toasts.filter((x) => x.id !== t.id);
      this.notify();
    }, 3000);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(): void {
    for (const fn of this.listeners) fn();
  }
}
