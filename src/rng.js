// Moonlit Knight — seedable RNG helpers (Stage 1).
// No build step: plain ESM, vendored in-repo. The engine uses Math.random by
// default; tests (and later deterministic replays) can pass a seed instead.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher–Yates shuffle. `rand` defaults to Math.random. Shuffles in place
// and returns the same array.
export function shuffle(array, rand = Math.random) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
