// Curvas de easing y pequeñas animaciones procedurales (squash & stretch).

export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

export const ease = {
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t: number, s = 1.9) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2),
  outElastic: (t: number) =>
    t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,
};

/**
 * Deformación de "aparición": el objeto crece desde el suelo con rebote,
 * primero estirado y luego aplastado. Devuelve escalas [xz, y].
 */
export function popScale(t: number): [number, number] {
  if (t >= 1) return [1, 1];
  const s = ease.outElastic(clamp01(t));
  const squash = Math.sin(clamp01(t) * Math.PI * 2.5) * (1 - t) * 0.18;
  return [s * (1 - squash * 0.5), s * (1 + squash)];
}

/** Pequeño salto al seleccionar (como al tocar un edificio en los juegos móviles). */
export function hopScale(t: number): [number, number] {
  if (t >= 1) return [1, 1];
  const k = Math.sin(t * Math.PI) * (1 - t);
  return [1 + k * 0.06, 1 - k * 0.04 + Math.sin(t * Math.PI * 2) * 0.05 * (1 - t)];
}
