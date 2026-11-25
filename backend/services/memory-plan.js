// memory-plan — where a model's bytes live: all on the graphics card, or part of it in system RAM. Pure.
//
// Design note, 2026-11-11: […] A model that does not fit the card's share
// used to fail its load; now the layers that do not fit run from RAM on the processor (llama.cpp's
// own placement, `--fit on`), inside two budgets: the operator's share of the card, and a share of
// RAM that always leaves the rest of the machine room. docs/work/ram-offload.md.
//
// Spilling costs speed: decode reads every weight once a token, and RAM is read many times slower
// than the card. It is the way a model runs AT ALL on a card that cannot hold it, never the fast path.

/** The share of the machine's RAM a spilled model may take when the operator names none. */
export const RAM_SHARE_DEFAULT = 0.5;
/** Always left free in RAM beyond the spill: the desktop, the browser, the platform itself. */
export const RAM_RESERVE_MIB = 8192;
/** The pool a spilled serving gets (tokens): room for real chats, kept modest because every token
 *  of pool on a spilled layer lives in RAM too. */
export const SPILL_POOL = 32_768;

/**
 * pure — the operator's RAM share from their saved choice, a percent (20-80); anything else reads
 * as the default. A choice made in the app, never an environment variable.
 */
export const ramShareFrom = (saved) => {
  const pct = Number(saved?.ramSharePct);
  return Number.isFinite(pct) && pct >= 20 && pct <= 80 ? pct / 100 : RAM_SHARE_DEFAULT;
};

/**
 * pure — the RAM a spilled model may take: the operator's share of the total, never more than
 * what leaves RAM_RESERVE_MIB of what is available right now.
 * @param {{totalMiB: number, availableMiB: number}} ram
 * @param {number} [share]
 */
export const ramBudgetMiB = (ram, share = RAM_SHARE_DEFAULT) => {
  if (!(ram?.totalMiB > 0) || !(ram?.availableMiB >= 0)) return 0;
  return Math.max(0, Math.min(Math.floor(ram.totalMiB * share), Math.floor(ram.availableMiB - RAM_RESERVE_MIB)));
};

/**
 * pure — the spill a serving needs: what does not fit the card's room goes to RAM, and it must
 * fit the RAM budget.
 * @param {{needMiB: number, cardRoomMiB: number, ramBudgetMiB: number}} input - needMiB: the whole
 *   serving at its pool (weights, KV, buffers); cardRoomMiB: what the card may hold for it
 * @returns {{fits: true, cardMiB: number, ramMiB: number}|{fits: false, ramMiB: number, reason: string}}
 */
export const spillPlan = ({ needMiB, cardRoomMiB, ramBudgetMiB: budget }) => {
  const cardMiB = Math.max(0, Math.min(needMiB, cardRoomMiB));
  const ramMiB = Math.ceil(needMiB - cardMiB);
  if (ramMiB > budget) {
    return Object.freeze({
      fits: false,
      ramMiB,
      reason: `the model needs ${ramMiB} MiB of RAM beside the card; the RAM share allows ${budget} MiB`,
    });
  }
  return Object.freeze({ fits: true, cardMiB: Math.floor(cardMiB), ramMiB });
};

/**
 * pure — the margin llama.cpp's placement must leave free on the card (`--fit-target`, MiB), so
 * the server stays under the operator's ceiling: everything above the ceiling, the allocator's
 * margin, and what the placement does not count itself (the vision projector).
 * @param {{totalMiB: number, ceilingMiB: number, marginMiB: number, uncountedMiB?: number}} input
 */
export const fitTargetMiB = ({ totalMiB, ceilingMiB, marginMiB, uncountedMiB = 0 }) =>
  Math.max(0, Math.ceil(totalMiB - ceilingMiB + marginMiB + uncountedMiB));

/**
 * pure — the machine's RAM from /proc/meminfo text, or null where it cannot be read.
 * @param {string} text
 * @returns {{totalMiB: number, availableMiB: number}|null}
 */
export const parseMeminfo = (text) => {
  const kib = (key) => Number(new RegExp(`^${key}:\\s+(\\d+)\\s+kB`, 'm').exec(String(text))?.[1]);
  const total = kib('MemTotal');
  const available = kib('MemAvailable');
  return Number.isFinite(total) && Number.isFinite(available)
    ? Object.freeze({ totalMiB: Math.floor(total / 1024), availableMiB: Math.floor(available / 1024) })
    : null;
};
