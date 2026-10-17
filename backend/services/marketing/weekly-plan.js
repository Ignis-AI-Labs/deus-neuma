/**
 * THE WEEKLY PLAN — the house's posting skeleton, CMO-authored, operator-locked.
 *
 * The beings' own report (posting-pipeline-v2): without a plan, every post
 * starts from blank deliberation — […] re-litigated
 * each time. The plan answers it once: day → theme → objective → posts. The CMO
 * authors it; the operator's ONE approval locks it (the `marketing/plan` intent's
 * card — the same single-card shape as every consequential act); a locked plan
 * is the truth `pipeline_state` serves as today's slot. Re-planning = re-propose,
 * re-approve; an unlocked proposal never touches this store (proposals live in
 * the intent's own args — the card IS the proposal).
 *
 * ONE PLAN PER HOUSE (Design note, 2026-10-16: each house's plan lives in its own
 * office, `<realm>/<wallet>/offices/marketing/marketing-weekly-plan.json`
 * (house-office.js); the machine-wide plan moves once to its house.
 * Governance record, not a secret: plain JSON, 0600/0700 posture,
 * write-chain serialized — the sibling marketing stores' shape.
 */
import fs from 'fs/promises';
import { join, dirname } from 'path';
import { getSettingsDir } from '../data-root.js';
import { createWriteChain } from '../write-chain.js';
import { createHouseStore } from '../house-office.js';
import { legacyCmoPath } from './cmo-designation.js';

const DEFAULT_LEGACY_PATH = join(getSettingsDir(), 'marketing-weekly-plan.json');
// The pre-2026-10-16 machine plan, read per call so tests never touch the live one.
const legacyPlanPath = () => process.env.NEUMA_WEEKLY_PLAN_PATH || DEFAULT_LEGACY_PATH;

export const WEEKDAYS = Object.freeze([
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
]);

/** Pure — the shape law for a proposed plan's days. An empty array IS a plan
 *  (a quiet week is a decision); garbage is not. */
export const validatePlanDays = (days) => {
  if (!Array.isArray(days)) return 'days must be a list — one entry per day you are planning';
  if (days.length > 7) return 'at most 7 day entries';
  for (const day of days) {
    if (!day || typeof day !== 'object') return 'each day entry must be an object';
    if (!WEEKDAYS.includes(String(day.day || '').toLowerCase())) {
      return `day must be one of: ${WEEKDAYS.join(', ')}`;
    }
    if (typeof day.theme !== 'string' || !day.theme.trim()) return `the ${day.day} entry needs a theme`;
    if (day.theme.length > 80) return `the ${day.day} theme is over 80 characters — a theme is a lane, not an essay`;
    if (typeof day.objective !== 'string' || !day.objective.trim()) return `the ${day.day} entry needs an objective`;
    if (day.objective.length > 200) return `the ${day.day} objective is over 200 characters`;
    const posts = day.posts ?? 1;
    if (!Number.isInteger(posts) || posts < 0 || posts > 12) return `the ${day.day} posts must be an integer 0–12`;
  }
  return null;
};

export const createWeeklyPlanStore = ({ path }) => {
  const serialize = createWriteChain();
  const target = () => (typeof path === 'function' ? path() : path);

  // impure — missing file = no plan yet (null, not an error).
  const load = async () => {
    try {
      const parsed = JSON.parse(await fs.readFile(target(), 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  };

  // impure — the operator's approval, persisted. Serialized.
  const approve = async (days) =>
    serialize(async () => {
      const doc = {
        status: 'approved',
        approvedAt: new Date().toISOString(),
        days: days.map((d) => ({
          day: String(d.day).toLowerCase(),
          theme: d.theme.trim(),
          objective: d.objective.trim(),
          posts: d.posts ?? 1,
        })),
      };
      const file = target();
      await fs.mkdir(dirname(file), { recursive: true, mode: 0o700 });
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600 });
      await fs.rename(tmp, file);
      return doc;
    });

  // Pure over the loaded doc — today's slot, or null (no plan / not today).
  const todaysSlot = async (now = new Date()) => {
    const doc = await load();
    if (!doc || doc.status !== 'approved' || !Array.isArray(doc.days)) return null;
    const today = WEEKDAYS[(now.getUTCDay() + 6) % 7]; // monday-first
    return doc.days.find((d) => d.day === today) ?? null;
  };

  return { load, approve, todaysSlot };
};

// A house's own plan — the marketing/plan intent and pipeline_state open it
// for the house in question. impure.
export const weeklyPlanStoreFor = createHouseStore({
  office: 'marketing',
  name: 'marketing-weekly-plan.json',
  legacyPath: legacyPlanPath,
  legacySeatPath: legacyCmoPath,
  create: createWeeklyPlanStore,
});
