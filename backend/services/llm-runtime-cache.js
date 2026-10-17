/** Runtime metadata generations keep expired requests from repopulating current caches. */
export const CAPS_CACHE_TTL_MS = 60_000;
let current = { caps: new Map(), think: new Map(), lastGood: new Map() };

/** Pure TTL predicate shared by capability readers and boundary tests. */
export const capsCacheFresh = (entry, now, ttl = CAPS_CACHE_TTL_MS) =>
  Boolean(entry) && now - entry.at < ttl;

/** impure — capture once before awaiting a probe; later writes stay in that generation. */
export const runtimeModelCaches = () => current;

/** impure — preserve completed fallback values without sharing old writable maps. */
export const expireRuntimeModelCaches = () => {
  current = { caps: new Map(), think: new Map(), lastGood: new Map(current.lastGood) };
};

/** impure — expire capability TTLs while retaining completed reasoning and fallback values. */
export const _expireCapsCache = () => {
  current = { caps: new Map(), think: new Map(current.think), lastGood: new Map(current.lastGood) };
};

/** impure — discard capability readings and fallback history for a fresh resolution. */
export const _resetCapsCache = () => {
  current = { caps: new Map(), think: new Map(current.think), lastGood: new Map() };
};
