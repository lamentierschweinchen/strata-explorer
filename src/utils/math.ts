/** Seeded pseudo-random number generator (mulberry32) */
export function seededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Log-normal distribution sample */
export function logNormal(rng: () => number, mu: number, sigma: number): number {
  // Box-Muller transform
  const u1 = rng();
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);
  return Math.exp(mu + sigma * z);
}

/** Generate a random base58 string */
export function randomBase58(rng: () => number, length: number): string {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(rng() * chars.length)];
  }
  return result;
}

/** Generate a position in a cylindrical volume */
export function cylindricalPosition(
  rng: () => number,
  innerRadius: number,
  outerRadius: number,
  height: number,
): { x: number; y: number; z: number } {
  const theta = rng() * Math.PI * 2;
  // Use sqrt for uniform distribution across area
  const r = Math.sqrt(rng() * (outerRadius * outerRadius - innerRadius * innerRadius) + innerRadius * innerRadius);
  const y = (rng() - 0.5) * height;

  // Add slight Gaussian noise for organic clustering
  const noiseX = (rng() - 0.5 + rng() - 0.5) * 3;
  const noiseY = (rng() - 0.5 + rng() - 0.5) * 3;
  const noiseZ = (rng() - 0.5 + rng() - 0.5) * 3;

  return {
    x: r * Math.cos(theta) + noiseX,
    y: y + noiseY,
    z: r * Math.sin(theta) + noiseZ,
  };
}

/** Lerp between two values */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Clamp value between min and max */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
