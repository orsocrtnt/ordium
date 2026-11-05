/**
 * Générateur pseudo-aléatoire déterministe (seedé).
 * Indispensable : pour une même stratégie et une même fenêtre, le fractionnement
 * "aléatoire" doit être reproductible (backtest rejouable, exécution auditable).
 */

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

export function mulberry32(seedStr: string): () => number {
  let a = xmur3(seedStr)();
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** N fractions positives sommant à 1, chacune entre ~0,5x et ~1,5x la part égale. */
export function randomFractions(n: number, seed: string): number[] {
  const rand = mulberry32(seed);
  const raw = Array.from({ length: n }, () => 0.5 + rand());
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((v) => v / sum);
}
