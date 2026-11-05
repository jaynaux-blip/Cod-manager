/**
 * Deterministic seeded random number generator (mulberry32).
 *
 * Every simulation takes an Rng so a given seed always replays the exact same
 * match. That is what lets us tune balance with thousands of fake seasons and
 * lets players share a "seed" to reproduce a legendary series.
 */
export class Rng {
  private state: number;

  constructor(seed: number | string) {
    this.state = (typeof seed === "string" ? hashString(seed) : seed) >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max], inclusive on both ends. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("pick() from empty array");
    return items[Math.floor(this.next() * items.length)];
  }

  /** Pick one item with probability proportional to weight(item). */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T {
    if (items.length === 0) throw new Error("weighted() from empty array");
    const weights = items.map((it) => Math.max(0, weight(it)));
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return this.pick(items);
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r < 0) return items[i];
    }
    return items[items.length - 1];
  }

  /** Normally distributed sample (Box-Muller). */
  gaussian(mean = 0, sd = 1): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return mean + z * sd;
  }

  /** Shuffle a copy of the array (Fisher-Yates). */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /** Derive an independent child generator, e.g. one per map in a series. */
  fork(label: string): Rng {
    return new Rng(hashString(`${this.state}:${label}`));
  }
}

/** FNV-1a 32-bit string hash. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));
