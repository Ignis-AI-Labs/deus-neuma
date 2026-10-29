/**
 * marketing/board-arrange — the CMO seat lays out the operator's MARKETING
 * board at one level (marketing-panel-plan.md §4, slice 5). The seat sends the
 * WHOLE board for the level, in order: one file, judged by the same pure law
 * the operator's own save is (board-shape.js) and the pin rule as the CMO —
 * the operator's pinned panels stay where they are, unchanged, and only the
 * operator pins. A refused board changes nothing and names every reason, one
 * line each, so the seat fixes the same file and it is answered again.
 *
 * Display only (owner, 2026-10-24): arranging the board changes what the
 * operator sees and nothing else, so it needs no mandate and no card — it
 * writes the board file of the filer's OWN house (the connection's wallet)
 * and nothing more. Offered to, and re-verified for, the house's seated CMO.
 */
import { cmoDesignation } from '../marketing/cmo-designation.js';
import { boardStoreFor } from '../marketing/board-store.js';
import { boardRefusals, pinRefusals } from '../marketing/board-shape.js';
import { BOARD_LEVEL, boardHouseOf, levelRefusal } from '../marketing/board-house.js';
import { arrangedBoard } from '../marketing/board-lines.js';

const laneOf = (connection) => connection?.companion?.neumaId || null;
const invalid = (reasons) => ({ ok: false, status: 'invalid', reason: reasons.map((r) => `- ${r}`).join('\n') });

export const marketingBoardArrangeIntent = Object.freeze({
  name: 'marketing/board-arrange',
  policyTool: 'marketing.board-arrange',
  fieldsForPrompt: '{level, panels: [{kind, span, scope?, show?, window?, sort?, count?, id?}]}',
  descriptionForPrompt: 'Lay out your operator\'s MARKETING board at one level ("house" or a company id): the whole board, in order (board_read shows it and what the level may hold). scope names only what the kind reads (campaignId, platform, accountId, company); the level and the ids fill themselves. It changes only what your operator sees, so it asks no one. Their pinned panels are theirs: keep each in its place, unchanged. A refused board changes nothing and names every reason.',
  // Offered to the house's seated CMO alone.
  availableFor: async ({ laneId, connection }) => (laneId && await cmoDesignation.holds(connection?.walletAddress, laneId) ? {} : null),
  validate: async (payload, { connection } = {}) => {
    const wallet = connection?.walletAddress;
    if (!wallet || !(await cmoDesignation.holds(wallet, laneOf(connection)))) {
      return { ok: false, status: 'denied', reason: 'only the house\'s seated CMO lays out the operator\'s marketing board — ask your operator who holds the office' };
    }
    const level = typeof payload?.level === 'string' ? payload.level.trim() : '';
    if (!BOARD_LEVEL.test(level)) return invalid(['level is "house" or one of the house\'s company ids (board_read lists them)']);
    if (!Array.isArray(payload?.panels)) return invalid(['panels is the whole board, a list of panels in order']);
    const ctx = await boardHouseOf(wallet, level);
    const refused = levelRefusal(ctx);
    if (refused) return invalid([refused]);
    const previous = (await (await boardStoreFor(wallet)).load(level)) || [];
    const panels = arrangedBoard(payload.panels, { level, previous });
    const shape = boardRefusals(panels, ctx);
    const reasons = shape.length ? shape : pinRefusals(previous, panels, 'cmo');
    return reasons.length ? invalid(reasons) : { ok: true, value: { level, panels } };
  },
  summarize: (payload) => `arrange the marketing board at ${String(payload?.level ?? '?').slice(0, 64)} — ${Array.isArray(payload?.panels) ? payload.panels.length : 0} panel(s)`,
  execute: async ({ level, panels }, { connection } = {}) => {
    const wallet = connection?.walletAddress;
    // The house as it stands NOW: the store judges the board again, under its lock, against the board it replaces.
    const saved = await (await boardStoreFor(wallet)).save(level, panels, { ...await boardHouseOf(wallet, level), setBy: 'cmo' });
    if (!saved.ok) return { ok: false, reason: saved.reasons.map((r) => `- ${r}`).join('\n') };
    const mine = saved.panels.filter((p) => p.setBy === 'cmo').length;
    const pinned = saved.panels.filter((p) => p.pinned).length;
    return { ok: true, detail: `Board ${level}: ${saved.panels.length} panel(s) saved; ${mine} set by you; ${pinned} pinned by the operator, kept.` };
  },
});
