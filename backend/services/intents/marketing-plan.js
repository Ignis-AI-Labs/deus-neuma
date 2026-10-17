/**
 * marketing/plan — the WEEKLY PLAN act (posting-pipeline-v2). The CMO authors
 * the posting skeleton (day → theme → objective → posts); the operator's ONE
 * approval locks it. The proposal lives in the intent's own args — the card
 * IS the proposal — and only an approved lock ever touches the store. The
 * single-holder law stands in validate: only the designated CMO of the
 * filer's OWN house proposes, and the lock lands in that house's plan (the
 * connection's wallet) — a same-named lane in another house holds nothing.
 */
import { cmoDesignation } from '../marketing/cmo-designation.js';
import { weeklyPlanStoreFor, validatePlanDays } from '../marketing/weekly-plan.js';

export const marketingPlanIntent = Object.freeze({
  name: 'marketing/plan',
  policyTool: 'marketing.plan',
  fieldsForPrompt: '{days: [{day, theme, objective, posts?}]}',
  descriptionForPrompt: 'Propose the WEEKLY POSTING PLAN — day by day: theme, objective, posts. You are the author; your operator is the only approval. On their yes it LOCKS and pipeline_state serves its slots every day after. Re-planning = re-propose (the new lock replaces the old). CMO\'s office: only the designated CMO proposes.',
  availableFor: async () => ({}),
  validate: async (payload, { connection } = {}) => {
    const laneId = connection?.companion?.neumaId || null;
    if (!(await cmoDesignation.holds(connection?.walletAddress, laneId))) {
      return { ok: false, status: 'denied', reason: 'only the designated CMO may propose the weekly plan — ask your operator who holds the office' };
    }
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.days)) {
      return { ok: false, status: 'invalid', reason: 'marketing/plan needs {days: [...]} — day, theme, objective, posts' };
    }
    const invalid = validatePlanDays(payload.days);
    if (invalid) return { ok: false, status: 'invalid', reason: invalid };
    return { ok: true, value: { days: payload.days } };
  },
  summarize: (payload) => `lock the weekly posting plan — ${(payload?.days ?? []).length} day(s): `
    + (payload?.days ?? []).map((d) => `${String(d.day).slice(0, 3)}:${String(d.theme).slice(0, 28)}`).join(', '),
  execute: async (fields, { connection } = {}) => {
    const doc = await (await weeklyPlanStoreFor(connection?.walletAddress)).approve(fields.days);
    return {
      ok: true,
      detail: `The weekly plan is LOCKED (${doc.approvedAt}) — ${doc.days.length} day(s). `
        + `pipeline_state now names today's slot every sitting.`,
    };
  },
});
