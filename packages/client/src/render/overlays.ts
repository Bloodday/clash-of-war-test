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
  kind: 'build' | 'train' | 'hp';
}

/** Burbuja de recurso listo para recolectar sobre un productor. */
export interface Bubble {
  key: string;
  pos: THREE.Vector3;
  icon: string;
  full: boolean;
  onHover: () => void;
}

/** Etiqueta clicable (p. ej. campamentos de monstruos). */
export interface Marker {
  key: string;
  pos: THREE.Vector3;
  title: string;
  sub: string;
  onClick: () => void;
}

interface Flyer {
  el: HTMLDivElement;
  from: { x: number; y: number };
  to: { x: number; y: number };
  target: Element | null;
  age: number;
  delay: number;
  duration: number;
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
  private bubbles = new Map<string, { el: HTMLDivElement; bubble: Bubble }>();
  private flyers: Flyer[] = [];
  private markers = new Map<string, { el: HTMLButtonElement; marker: Marker }>();
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

  /** Posición en pantalla (px) de un punto 3D. */
  toScreen(pos: THREE.Vector3): { x: number; y: number } {
    this.v.copy(pos).project(this.camera);
    return { x: ((this.v.x + 1) / 2) * this.viewport.clientWidth, y: ((1 - this.v.y) / 2) * this.viewport.clientHeight };
  }

  /** Iconos que salen del edificio y vuelan en arco hasta el contador del HUD. */
  flyToHud(from: THREE.Vector3, icon: string, target: Element | null, count: number): void {
    const start = this.toScreen(from);
    const rect = target?.getBoundingClientRect();
    const to = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: 60, y: 30 };
    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      el.className = 'flyer';
      el.textContent = icon;
      el.style.opacity = '0';
      this.root.appendChild(el);
      this.flyers.push({
        el,
        from: { x: start.x + (Math.random() - 0.5) * 50, y: start.y + (Math.random() - 0.5) * 30 },
        to,
        target,
        age: 0,
        delay: i * 0.045,
        duration: 0.65 + Math.random() * 0.2,
      });
    }
  }

  setBubbles(list: Bubble[]): void {
    const seen = new Set<string>();
    for (const b of list) {
      seen.add(b.key);
      let entry = this.bubbles.get(b.key);
      if (!entry) {
        const el = document.createElement('div');
        el.className = 'bubble';
        // El contenedor solo se posiciona; la forma y las animaciones van dentro
        // (rotate/scale de CSS se aplican antes que transform y moverían la posición).
        el.innerHTML = '<div class="bubble-body"><span class="bubble-icon"></span></div>';
        // Pasar el ratón por encima recolecta; tocar también (pantallas táctiles).
        el.addEventListener('pointerenter', () => entry?.bubble.onHover());
        el.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          entry?.bubble.onHover();
        });
        this.root.appendChild(el);
        entry = { el, bubble: b };
        this.bubbles.set(b.key, entry);
      }
      entry.bubble = b;
      entry.el.querySelector('.bubble-icon')!.textContent = b.icon;
      entry.el.classList.toggle('full', b.full);
      this.place(entry.el, b.pos, 0);
    }
    for (const [key, e] of this.bubbles) {
      if (!seen.has(key)) {
        e.el.classList.add('pop');
        setTimeout(() => e.el.remove(), 250);
        this.bubbles.delete(key);
      }
    }
  }

  setMarkers(list: Marker[]): void {
    const seen = new Set<string>();
    for (const m of list) {
      seen.add(m.key);
      let entry = this.markers.get(m.key);
      if (!entry) {
        const el = document.createElement('button');
        el.className = 'marker';
        el.innerHTML = '<b></b><small></small><span class="marker-cta">⚔️ Atacar</span>';
        el.addEventListener('pointerdown', (e) => e.stopPropagation());
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          entry?.marker.onClick();
        });
        this.root.appendChild(el);
        entry = { el, marker: m };
        this.markers.set(m.key, entry);
      }
      entry.marker = m;
      entry.el.querySelector('b')!.textContent = m.title;
      entry.el.querySelector('small')!.textContent = m.sub;
      this.place(entry.el, m.pos, 0);
    }
    for (const [key, e] of this.markers) {
      if (!seen.has(key)) {
        e.el.remove();
        this.markers.delete(key);
      }
    }
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
      e.label.textContent = item.kind === 'hp' ? item.label : `${item.label} · ${fmtTime(item.seconds)}`;
      e.fill.style.width = `${Math.round(Math.min(1, Math.max(0, item.progress)) * 100)}%`;
    }
    for (const [key, e] of this.entries) {
      if (!seen.has(key)) {
        e.el.remove();
        this.entries.delete(key);
      }
    }

    this.updateFlyers(dt);
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

  private updateFlyers(dt: number): void {
    this.flyers = this.flyers.filter((f) => {
      f.age += dt;
      const t = (f.age - f.delay) / f.duration;
      if (t < 0) return true;
      if (t >= 1) {
        f.el.remove();
        // El contador del HUD "recibe" el icono.
        if (f.target) {
          f.target.classList.remove('hit');
          void (f.target as HTMLElement).offsetWidth;
          f.target.classList.add('hit');
        }
        return false;
      }
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      // Curva de Bézier cuadrática con el punto de control por encima del origen.
      const cx = f.from.x + (f.to.x - f.from.x) * 0.2;
      const cy = Math.min(f.from.y, f.to.y) - 120;
      const x = (1 - e) * (1 - e) * f.from.x + 2 * (1 - e) * e * cx + e * e * f.to.x;
      const y = (1 - e) * (1 - e) * f.from.y + 2 * (1 - e) * e * cy + e * e * f.to.y;
      const scale = t < 0.15 ? 0.4 + (t / 0.15) * 0.9 : 1.3 - t * 0.5;
      f.el.style.opacity = '1';
      f.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${scale.toFixed(2)}) rotate(${(t * 240).toFixed(0)}deg)`;
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
