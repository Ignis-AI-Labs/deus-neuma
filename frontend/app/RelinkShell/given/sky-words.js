// sky-words.js — the small words every sky guide speaks with. Pure.

/** An English ordinal: 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st. Pure. */
export const ord = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

/** Degrees and minutes of arc within a sign: 22°34′ (the minutes carried, never 60). Pure. */
export const degIn = (deg) => {
  const m = Math.round(deg * 60);
  return `${Math.floor(m / 60)}°${String(m % 60).padStart(2, '0')}′`;
};
