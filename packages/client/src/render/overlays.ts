import * as THREE from 'three/webgpu';
import { fmtTime } from '../ui/format';

// Elementos HTML anclados a posiciones 3D: barras de progreso (obras y
// entrenamientos) y textos flotantes ("+12 🌾", "¡Nivel 2!").

export interface OverlayItem {
  key: string;
  pos: THREE.Vector3;
  label: string;
  seconds: number;
  progress: number;
  kind: 'build' | 'train';
}

interface Entry {
  el: HTMLDivElement;
  label: HTMLSpanElement;
  fill: HTMLDivElement;
}

interface Floater {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  age: number;
  life: number;
}

export class Overlays {
  private entries = new Map<string, Entry>();
  private floaters: Floater[] = [];
  private v = new THREE.Vector3();

  constructor(
    private root: HTMLElement,
    private camera: THREE.Camera,
    private viewport: HTMLElement,
  ) {}

  /** Texto que sube y se desvanece. `kind` elige el estilo (recurso o anuncio grande). */
  floatText(pos: THREE.Vector3, text: string, kind: string): void {
    const el = document.createElement('div');
    el.className = `floater floater-${kind}`;
    el.textContent = text;
    this.root.appendChild(el);
    this.floaters.push({ el, pos: pos.clone(), age: 0, life: kind === 'big' ? 2.6 : 1.8 });
  }

  update(items: OverlayItem[], dt: number): void {
    const seen = new Set<string>();
    for (const item of items) {
      seen.add(item.key);
      let e = this.entries.get(item.key);
      if (!e) {
        e = this.create(item.kind);
        this.entries.set(item.key, e);
      }
      if (!this.place(e.el, item.pos, 0)) continue;
      e.label.textContent = `${item.label} · ${fmtTime(item.seconds)}`;
      e.fill.style.width = `${Math.round(Math.min(1, Math.max(0, item.progress)) * 100)}%`;
    }
    for (const [key, e] of this.entries) {
      if (!seen.has(key)) {
        e.el.remove();
        this.entries.delete(key);
      }
    }

    this.floaters = this.floaters.filter((f) => {
      f.age += dt;
      const t = f.age / f.life;
      if (t >= 1) {
        f.el.remove();
        return false;
      }
      const rise = (1 - Math.pow(1 - Math.min(1, t * 1.4), 3)) * 46;
      if (this.place(f.el, f.pos, rise)) {
        const scale = t < 0.12 ? 0.6 + (t / 0.12) * 0.55 : t < 0.22 ? 1.15 - ((t - 0.12) / 0.1) * 0.15 : 1;
        f.el.style.transform += ` scale(${scale.toFixed(3)})`;
        f.el.style.opacity = String(t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1);
      }
      return true;
    });
  }

  /** Proyecta y coloca el elemento; devuelve false si queda fuera de pantalla. */
  private place(el: HTMLElement, pos: THREE.Vector3, riseY: number): boolean {
    this.v.copy(pos).project(this.camera);
    const visible = this.v.z < 1 && Math.abs(this.v.x) < 1.1 && Math.abs(this.v.y) < 1.1;
    el.style.display = visible ? '' : 'none';
    if (!visible) return false;
    const x = ((this.v.x + 1) / 2) * this.viewport.clientWidth;
    const y = ((1 - this.v.y) / 2) * this.viewport.clientHeight - riseY;
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    return true;
  }

  private create(kind: OverlayItem['kind']): Entry {
    const el = document.createElement('div');
    el.className = `bar bar-${kind}`;
    const label = document.createElement('span');
    const track = document.createElement('div');
    track.className = 'bar-track';
    const fill = document.createElement('div');
    fill.className = 'bar-fill';
    track.appendChild(fill);
    el.append(label, track);
    this.root.appendChild(el);
    return { el, label, fill };
  }
}
