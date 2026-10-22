// Deterministic Mulberry32 Seeded PRNG

export interface SeededPrng {
  next(): number; // 0.0 to 1.0
  nextInt(min: number, max: number): number; // inclusive min, inclusive max
  pick<T>(items: T[]): T;
  chance(probability: number): boolean;
  getSeed(): number;
}

export function createPrng(seed: number): SeededPrng {
  let s = Math.floor(seed) >>> 0;

  function next(): number {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next,
    nextInt(min: number, max: number): number {
      return Math.floor(next() * (max - min + 1)) + min;
    },
    pick<T>(items: T[]): T {
      if (items.length === 0) throw new Error('Cannot pick from empty array');
      const idx = Math.floor(next() * items.length);
      return items[idx];
    },
    chance(probability: number): boolean {
      return next() < probability;
    },
    getSeed(): number {
      return seed;
    },
  };
}
