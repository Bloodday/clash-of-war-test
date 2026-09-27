// PRNG determinista (mulberry32). El estado vive dentro de GameState para que
// cliente y servidor obtengan exactamente los mismos resultados.

export function nextRandom(holder: { rng: number }): number {
  let t = (holder.rng = (holder.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
