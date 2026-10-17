/**
 * Barrel — the local-day law lives in the neutral leaf core/time/day-key.js
 * (Wave-3 direction law, 2026-08-31: core/tasks must not import core/vessel,
 * so the shared time law moved out of the vessel domain). Path-pinned
 * importers keep this door; new code imports core/time/day-key.js directly.
 */
export { localDayKey } from '../time/day-key.js';
