import * as THREE from 'three/webgpu';
import { fmtTime } from '../ui/format';

// Barras de progreso HTML ancladas a posiciones 3D (obras y entrenamientos).

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

export class Overlays {
  private entries = new Map<string, Entry>();
  private v = new THREE.Vector3();

  constructor(
    private root: HTMLElement,
    private camera: THREE.Camera,
    private viewport: HTMLElement,
  ) {}

  update(items: OverlayItem[]): void {
    const seen = new Set<string>();
    const w = this.viewport.clientWidth;
    const h = this.viewport.clientHeight;
    for (const item of items) {
      seen.add(item.key);
      let e = this.entries.get(item.key);
      if (!e) {
        e = this.create(item.kind);
        this.entries.set(item.key, e);
      }
      this.v.copy(item.pos).project(this.camera);
      const visible = this.v.z < 1 && Math.abs(this.v.x) < 1.1 && Math.abs(this.v.y) < 1.1;
      e.el.style.display = visible ? '' : 'none';
      if (!visible) continue;
      e.el.style.transform = `translate(${((this.v.x + 1) / 2) * w}px, ${((1 - this.v.y) / 2) * h}px) translate(-50%, -100%)`;
      e.label.textContent = `${item.label} · ${fmtTime(item.seconds)}`;
      e.fill.style.width = `${Math.round(Math.min(1, Math.max(0, item.progress)) * 100)}%`;
    }
    for (const [key, e] of this.entries) {
      if (!seen.has(key)) {
        e.el.remove();
        this.entries.delete(key);
      }
    }
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
