import { GRID_SIZE } from '@cow/shared';

// La celda (i, j) ocupa en el mundo el cuadrado [i - G/2, i + 1 - G/2] en X
// y lo mismo en Z. Así la aldea queda centrada en el origen.

export function cellToWorld(x: number, y: number, size: number): { x: number; z: number } {
  return { x: x + size / 2 - GRID_SIZE / 2, z: y + size / 2 - GRID_SIZE / 2 };
}

/** Celda de esquina para que un edificio de tamaño `size` quede centrado en el punto. */
export function worldToCell(wx: number, wz: number, size: number): { x: number; y: number } {
  return { x: Math.round(wx + GRID_SIZE / 2 - size / 2), y: Math.round(wz + GRID_SIZE / 2 - size / 2) };
}
