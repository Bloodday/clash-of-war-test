import type { BuildingType } from '@cow/shared';
import type { Quality } from '../render/postfx';

const QUALITY_KEY = 'clash-of-war:quality';

/** Calidad guardada por el jugador, o null si nunca la eligió (modo automático). */
function loadQuality(): Quality | null {
  try {
    const q = localStorage.getItem(QUALITY_KEY);
    if (q === 'high' || q === 'medium' || q === 'low') return q;
  } catch {
    /* sin almacenamiento */
  }
  return null;
}

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
  /** Miniaturas renderizadas de cada edificio: clave `${tipo}:${nivel}`. */
  thumbnails = new Map<string, string>();
  private stored = loadQuality();
  quality: Quality = this.stored ?? 'high';
  /** true mientras el jugador no elija calidad: el juego la ajusta según los FPS. */
  qualityAuto = this.stored === null;
  onQualityChange: (q: Quality) => void = () => {};
  /** Recolecta un productor con su animación (lo implementa el mundo 3D). */
  collect: (buildingId: number) => void = () => {};
  /** Herramienta de pruebas: daña edificios al azar para ver las reparaciones. */
  simulateAttack: () => void = () => {};
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

  setQuality(q: Quality, auto = false): void {
    this.quality = q;
    this.qualityAuto = auto;
    if (!auto) {
      try {
        localStorage.setItem(QUALITY_KEY, q);
      } catch {
        /* sin almacenamiento */
      }
    }
    this.onQualityChange(q);
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
