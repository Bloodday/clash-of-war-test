import { GRID_SIZE } from '../data';

// A* sobre la cuadrícula de la aldea (8 direcciones, sin cortar esquinas).
// Los muros no son infranqueables: cuestan mucho, así que las unidades los
// rodean si pueden y, si no, abren camino rompiéndolos (como en Clash of Clans).

export const CELL_FREE = 0;
export const CELL_BLOCKED = 1;
export const CELL_WALL = 2;

/** Coste extra de atravesar un muro (en celdas): compensa rodear hasta ~esta distancia. */
export const WALL_COST = 14;

export interface Grid {
  size: number;
  cells: Uint8Array; // CELL_*
}

export function createGrid(): Grid {
  return { size: GRID_SIZE, cells: new Uint8Array(GRID_SIZE * GRID_SIZE) };
}

export const cellIndex = (g: Grid, x: number, y: number) => y * g.size + x;
export const inGrid = (g: Grid, x: number, y: number) => x >= 0 && y >= 0 && x < g.size && y < g.size;

export function cellAt(g: Grid, x: number, y: number): number {
  return inGrid(g, x, y) ? g.cells[cellIndex(g, x, y)]! : CELL_BLOCKED;
}

class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];
  get size() {
    return this.items.length;
  }
  push(item: number, p: number): void {
    this.items.push(item);
    this.prio.push(p);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent]! <= this.prio[i]!) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): number {
    const top = this.items[0]!;
    const last = this.items.length - 1;
    this.swap(0, last);
    this.items.pop();
    this.prio.pop();
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < this.items.length && this.prio[l]! < this.prio[m]!) m = l;
      if (r < this.items.length && this.prio[r]! < this.prio[m]!) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return top;
  }
  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b]!, this.items[a]!];
    [this.prio[a], this.prio[b]] = [this.prio[b]!, this.prio[a]!];
  }
}

const DIRS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * Camino desde la celda (sx, sy) hasta cualquier celda que cumpla `isGoal`.
 * `heuristic` debe ser admisible (distancia mínima al objetivo). Devuelve las
 * celdas del camino (sin la de salida) o null si no hay forma de llegar.
 */
export function findPath(
  g: Grid,
  sx: number,
  sy: number,
  isGoal: (x: number, y: number) => boolean,
  heuristic: (x: number, y: number) => number,
  maxNodes = 4000,
): { x: number; y: number }[] | null {
  if (!inGrid(g, sx, sy)) return null;
  const start = cellIndex(g, sx, sy);
  if (isGoal(sx, sy)) return [];
  const gScore = new Float32Array(g.size * g.size).fill(Infinity);
  const came = new Int32Array(g.size * g.size).fill(-1);
  const closed = new Uint8Array(g.size * g.size);
  const open = new MinHeap();
  gScore[start] = 0;
  open.push(start, heuristic(sx, sy));
  let expanded = 0;
  while (open.size > 0 && expanded < maxNodes) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    expanded++;
    const cx = cur % g.size;
    const cy = (cur / g.size) | 0;
    if (isGoal(cx, cy)) {
      const path: { x: number; y: number }[] = [];
      for (let n = cur; n !== start; n = came[n]!) path.push({ x: n % g.size, y: (n / g.size) | 0 });
      return path.reverse();
    }
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inGrid(g, nx, ny)) continue;
      const c = g.cells[cellIndex(g, nx, ny)]!;
      if (c === CELL_BLOCKED && !isGoal(nx, ny)) continue;
      // En diagonal no se atraviesan esquinas de edificios ni de muros.
      if (dx !== 0 && dy !== 0 && (cellAt(g, cx + dx, cy) !== CELL_FREE || cellAt(g, cx, cy + dy) !== CELL_FREE)) continue;
      const n = cellIndex(g, nx, ny);
      if (closed[n]) continue;
      const tentative = gScore[cur]! + cost + (c === CELL_WALL ? WALL_COST : 0);
      if (tentative < gScore[n]!) {
        gScore[n] = tentative;
        came[n] = cur;
        open.push(n, tentative + heuristic(nx, ny));
      }
    }
  }
  return null;
}
