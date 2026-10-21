// Seeded randomness. Everything the generator does is a pure function of the
// project document and its seeds, so a cue can always be reproduced exactly.

export function hashSeed(seed) {
  if (typeof seed === 'number') return seed >>> 0;
  let h = 2166136261; // FNV-1a
  for (const ch of String(seed)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32: small, fast, good enough for musical choices.
export function makeRng(seed) {
  let a = hashSeed(seed);
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = (rng, items) => items[Math.floor(rng() * items.length)];

// Short seeds so people can read them out or note them down.
export function randomSeed() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return (a[0] % 999999) + 1;
}
