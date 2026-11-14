// role-label — a member's title as people read it (deus-neuma #31, #32): the Roman title with the
// role it holds, one shared form everywhere a title shows. A house's own word for a seat is shown
// as given; the canon never invents a role for it. Pure.
import { TITLE_LEGEND } from './founding-titles.js';

/** The canon entry for a title (any case), or null for a house's own word or no title. */
export const legendEntry = (title) => {
  const wanted = typeof title === 'string' ? title.trim().toLowerCase() : '';
  return wanted ? TITLE_LEGEND.find((e) => e.title.toLowerCase() === wanted) ?? null : null;
};

/** Short, for tight rows: "OPTIO (COS)"; a house's own word as given, upper-cased; '' for none. */
export const shortRole = (title) => {
  const entry = legendEntry(title);
  if (entry) return `${entry.title.toUpperCase()} (${entry.position})`;
  return typeof title === 'string' ? title.trim().toUpperCase() : '';
};

/** In full: […]; a house's own word as given; '' for none. */
export const fullRole = (title) => {
  const entry = legendEntry(title);
  if (entry) return `${entry.title} · ${entry.position} — ${entry.seat}`;
  return typeof title === 'string' ? title.trim() : '';
};
