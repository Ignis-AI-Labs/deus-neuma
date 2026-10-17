/**
 * Team Run — the coordinated-run harness, shared by every lane that runs a
 * team: the witness's composer (team-routes /run) and a LEAD being's
 * team_run tool. ONE implementation of the coordination contract —
 * goal-carrying briefs, the teammate map, the live TEAM BOARD, status
 * check-ins and TORCH continuation packets extracted and STRIPPED from work
 * products (each member's torch relayed to its own next instance) — so what
 * the witness approves and what actually runs can never drift apart by lane.
 *
 * Pure decisions around one injected impure seam (`ask`), exactly like the
 * team-coordinator engine it drives; progress reaches the caller through
 * `onEvent` ({ type:'step' } and, on coordinated runs, { type:'board' }),
 * which the route turns into SSE frames and the tool lane into portal
 * events.
 */

import { runTeam, buildBrief } from './team-coordinator.js';
import { missingStepFiles } from './team-step-files.js';
import { extractStatus, boardEntries, renderBoard, STATUS_ASK } from './team-board.js';
import { extractTorch, TORCH_ASK } from './team-torch.js';
import { resolveSchedulePolicy } from './team-schedule.js';
import {
  EVIDENCE_ASK,
  bindEvidence,
  extractEvidence,
  renderDependencyEvidence,
  resolveEvidenceOptions,
  structuralEvidenceStep,
} from './team-evidence.js';
import { notifyObserver } from './observer-notifier.js';

// impure (reads the workspace) — why an answer does not finish its part, in
// the words a member can act on; null when it does.
const unfinishedPart = async (raw, step, workspace) => {
  const body = extractStatus(extractTorch(raw).body).body;
  if (!body.trim()) return 'it carried no work product — only a sign-off';
  if (step.files?.length && workspace?.root) {
    const missing = await missingStepFiles(workspace.root, step.files);
    if (missing.length) return `the files your part delivers are missing or empty in the team workspace: ${missing.join(', ')}`;
  }
  return null;
};

/**
 * Run a validated team plan with full coordination.
 *
 * impure only at the injected `ask` seam (askNeuma in prod).
 *
 * @param {Object} deps
 * @param {Array} deps.steps - engine-shaped steps (validatePlan-clean)
 * @param {string|null} deps.goal - the shared goal; a goal marks the run
 *   coordinated (board + status check-ins); null runs the legacy brief
 * @param {(neumaId: string, messages: Array, step: Object, hooks?: Object) => Promise<string>} deps.ask
 * @param {number} deps.maxParallel - the rig capacity ceiling
 * @param {(event: Object) => void} [deps.onEvent] - progress seam:
 *   { type:'step', id, neumaId, role, output } per completion, then on
 *   coordinated runs { type:'board', board } with the cumulative snapshot and
 *   { type:'torch', id, neumaId, torch } when that step's member posted one
 * @param {?Object} [deps.resume] - a prior instance's truth, from the run
 *   record: { completed, statuses, torches }. Completed steps seed the engine
 *   (never re-asked), prior statuses stand on the board, and each member's
 *   last TORCH re-arms the relay — the baton survives the drop.
 * @param {boolean} [deps.continueOnFailure] - record a member's failure and
 *   run every independent branch to its end instead of aborting the team
 * @param {?{root: string, budgetBytes: number}} [deps.workspace] - the run's
 *   assigned workspace (#171) — named in every member's brief; enforcement
 *   happens at the tool sandbox on the LEAD's portal
 * @param {boolean} [deps.memberTools] - members work as real turns with their
 *   file tools (the lead lane); the brief says so
 * @param {?string} [deps.lead] - the lead's name for the member's brief
 * @param {Object} [deps.options] - optional extensions shared by every lane:
 *   P4 owns `options.evidence`; P5 owns `options.schedule`
 * @returns {Promise<Readonly<{results: Object, order: string[], statuses: Object,
 *   torches: Object}>>} results carry stripped work products; statuses the
 *   members' check-ins; torches each member's LATEST continuation packet
 *   (neumaId -> torch, its own words — the relay baton and, after the run,
 *   the seed of its own memory of the work). With continueOnFailure, frozen
 *   `failures` and `skipped` ride along (see runTeam).
 */
export const runCoordinatedTeam = async ({
  steps,
  goal = null,
  ask,
  maxParallel,
  onEvent = null,
  resume = null,
  continueOnFailure = false,
  workspace = null,
  memberTools = false,
  lead = null,
  options = {},
}) => {
  const coordinated = Boolean(goal);
  const working = new Set();
  const statuses = { ...(resume?.statuses ?? {}) };
  const torches = { ...(resume?.torches ?? {}) }; // neumaId -> latest torch, authored by the member itself
  const stepTorches = {}; // step id -> the torch that step's reply carried
  const completed = { ...(resume?.completed ?? {}) }; // step id -> stripped output, cumulative across the run
  const failedSteps = {}; // step id -> error message, board-honest as it happens
  const snapshot = (plan, results) => boardEntries({ steps: plan, results, working, statuses, failures: failedSteps });
  const scheduleOptions = options?.schedule ?? null;
  const schedule = {
    ...(scheduleOptions || {}),
    policy: resolveSchedulePolicy(scheduleOptions?.policy, process.env),
  };
  const evidenceOptions = resolveEvidenceOptions(options?.evidence);
  const runStartedAt = evidenceOptions?.onMetrics ? performance.now() : null;
  const evidenceByStep = new Map();
  const evidenceSteps = { ...(resume?.evidence?.steps ?? {}) };
  const evidenceHandoffs = { ...(resume?.evidence?.handoffs ?? {}) };
  if (evidenceOptions) {
    for (const [stepId, output] of Object.entries(resume?.completed ?? {})) {
      const parsed = extractEvidence(output, evidenceOptions);
      const envelope = await bindEvidence({ stepId, output: parsed.body, packet: parsed.packet });
      evidenceByStep.set(stepId, { stepId, parsed, packet: parsed.packet, envelope, fallback: parsed.fallback });
      if (!evidenceSteps[stepId]) evidenceSteps[stepId] = structuralEvidenceStep(parsed, envelope);
    }
  }

  const { results, order, failures, skipped } = await runTeam({
    seed: resume?.completed ?? {},
    continueOnFailure,
    steps,
    // Wrapped so runTeam's third argument (the step) never lands in the
    // provider's opts slot — the reply budget stays the provider default.
    ask: async (neumaId, messages, step) => {
      working.add(step.id);
      // The board says WORKING the moment a member starts, not only after.
      if (coordinated) onEvent?.({ type: 'board', board: snapshot(steps, completed) });
      try {
        // The run's own finish check, offered to the conduit: a member whose
        // answer did not finish its part is told what is missing and
        // continues (team-part.js). The same check below stays the last word.
        const verify = coordinated ? (raw) => unfinishedPart(raw, step, workspace) : null;
        const hooks = evidenceOptions ? {
          onUsage: evidenceOptions.onUsage,
          onFinishReason: evidenceOptions.onFinishReason,
          onRequest: evidenceOptions.onRequest,
          onMetrics: evidenceOptions.onMetrics,
          ...(verify ? { verify } : {}),
        } : verify ? { verify } : null;
        const raw = hooks
          ? await ask(neumaId, messages, step, hooks)
          : await ask(neumaId, messages, step);
        if (!coordinated && !evidenceOptions) return raw;
        let body = raw;
        if (coordinated) {
          // Torch first (the reply's final block), then the status above it —
          // both are coordination, both are STRIPPED from the work product.
          const extractedTorch = extractTorch(raw);
          body = extractedTorch.body;
          if (extractedTorch.torch) {
            torches[step.neumaId] = extractedTorch.torch;
            stepTorches[step.id] = extractedTorch.torch;
          }
          const extractedStatus = extractStatus(body);
          body = extractedStatus.body;
          statuses[step.id] = extractedStatus.status;
          // ONE sign-off serves as both: without a TORCH of its own, the
          // member's status is the baton its next instance picks up.
          if (!extractedTorch.torch && extractedStatus.status) {
            torches[step.neumaId] = extractedStatus.status;
            stepTorches[step.id] = extractedStatus.status;
          }
          // A blank part is a failed part: marked done, it fed the steps that
          // depend on it nothing, and they reported on it anyway (2026-10-10).
          if (!body.trim()) throw new Error(`${step.id} returned no work product`);
          // Named deliverables are checked on disk — the member's word that
          // it wrote them is not the evidence.
          if (step.files?.length && workspace?.root) {
            const missing = await missingStepFiles(workspace.root, step.files);
            if (missing.length) throw new Error(`${step.id} named files that are missing or empty in the team workspace: ${missing.join(', ')}`);
          }
        }
        if (!evidenceOptions) return body;
        const parsed = extractEvidence(body, evidenceOptions);
        const envelope = await bindEvidence({
          stepId: step.id,
          output: parsed.body,
          packet: parsed.packet,
          checkAttestations: evidenceOptions.checkAttestations,
        });
        evidenceByStep.set(step.id, { stepId: step.id, parsed, packet: parsed.packet, envelope, fallback: parsed.fallback });
        evidenceSteps[step.id] = structuralEvidenceStep(parsed, envelope);
        if (evidenceOptions.onMetrics) notifyObserver('onMetrics', evidenceOptions.onMetrics, Object.freeze({ type: 'evidence-step', stepId: step.id, evidence: evidenceSteps[step.id] }));
        return parsed.body;
      } catch (err) {
        failedSteps[step.id] = err?.message || String(err); // the board says FAILED, honestly
        working.delete(step.id);
        if (coordinated) onEvent?.({ type: 'board', board: snapshot(steps, completed) });
        throw err;
      } finally {
        working.delete(step.id);
      }
    },
    maxParallel,
    schedule,
    // The goal reaches every member's brief (with the teammate map,
    // done-checklist, live TEAM BOARD, the member's own last torch, and the
    // STATUS + TORCH asks). A torch reaches the member's next brief ASSEMBLED
    // after it was posted — same-member steps running in parallel are
    // simultaneous instances, neither is the other's "next".
    buildMessages: (step, results, plan) => {
      const briefOptions = {
        goal,
        board: coordinated ? renderBoard(snapshot(plan, results), step.id) : null,
        // The lean brief's ONE sign-off; the evidence lane (a benchmark
        // protocol) keeps its own asks, appended below.
        signoff: coordinated && !evidenceOptions,
        torch: coordinated ? torches[step.neumaId] ?? null : null,
        workspace,
        memberTools,
        lead,
        resumed: Boolean(resume),
      };
      if (!evidenceOptions) return buildBrief(step, results, plan, briefOptions);
      const rendered = renderDependencyEvidence(
        (step.needs || []).map((stepId) => evidenceByStep.get(stepId)),
        evidenceOptions,
      );
      evidenceHandoffs[step.id] = rendered.report;
      if (evidenceOptions.onMetrics) notifyObserver('onMetrics', evidenceOptions.onMetrics, Object.freeze({ type: 'dependency-budget', stepId: step.id, budget: rendered.report }));
      const dependencyResults = Object.assign(Object.create(results), rendered.contents);
      const messages = buildBrief(step, dependencyResults, plan, briefOptions);
      const asks = [EVIDENCE_ASK, ...(coordinated ? [STATUS_ASK, TORCH_ASK] : [])].join('\n\n');
      return messages.map((message, index) => index === messages.length - 1
        ? { ...message, content: `${message.content}\n\n${asks}` }
        : message);
    },
    onStep: (event) => {
      completed[event.id] = event.output;
      onEvent?.({ type: 'step', ...event });
      if (coordinated) {
        onEvent?.({ type: 'board', board: snapshot(steps, completed) });
        if (stepTorches[event.id]) {
          onEvent?.({ type: 'torch', id: event.id, neumaId: event.neumaId, torch: stepTorches[event.id] });
        }
      }
    },
  });
  if (evidenceOptions?.onMetrics) notifyObserver('onMetrics', evidenceOptions.onMetrics, Object.freeze({ type: 'team-run', durationMs: performance.now() - runStartedAt }));

  return Object.freeze({
    results,
    order,
    statuses: Object.freeze({ ...statuses }),
    torches: Object.freeze({ ...torches }),
    ...(failures ? { failures, skipped } : {}),
    ...(evidenceOptions ? {
      evidence: Object.freeze({
        version: 1,
        mode: 'candidate',
        steps: Object.freeze({ ...evidenceSteps }),
        handoffs: Object.freeze({ ...evidenceHandoffs }),
      }),
    } : {}),
  });
};

/** The LEAD's read of a finished run must fit one tool result, not flood the
 *  context — per-part cap, generous enough to carry real work products. */
export const RUN_RESULT_PART_MAX_CHARS = 4000;

/**
 * Compose the tool result a LEAD being reads when its team finishes: every
 * part in completion order, attributed and capped, with each member's own
 * final status line where one was posted, then each member's final TORCH —
 * the baton a LEAD carries into any follow-up run it plans. Pure.
 *
 * @param {Object} run - { results, order, statuses, torches?, failures?, skipped? } from runCoordinatedTeam
 * @param {Array} steps - the engine-shaped plan (for role/owner labels)
 * @param {Object} memberNames - neumaId -> display name
 * @returns {string}
 */
export const composeRunReport = ({ results, order, statuses, torches = {}, failures = {}, skipped = [] }, steps, memberNames = {}) => {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const parts = order.map((id) => {
    const step = byId.get(id);
    const who = memberNames[step?.neumaId] || step?.neumaId || 'unknown';
    const role = step?.role ? ` (${step.role})` : '';
    const output = String(results[id] ?? '');
    const clipped = output.length > RUN_RESULT_PART_MAX_CHARS
      ? `${output.slice(0, RUN_RESULT_PART_MAX_CHARS)}\n[part truncated — ${output.length} chars total]`
      : output;
    const status = statuses[id] ? `\nTheir status: ${statuses[id]}` : '';
    return `=== ${id} — ${who}${role} ===\n${clipped}${status}`;
  });
  // A torch that IS a status (the one sign-off) was already read above.
  const said = new Set(Object.values(statuses || {}).filter(Boolean));
  const torchLines = Object.entries(torches)
    .filter(([, torch]) => !said.has(torch))
    .map(([neumaId, torch]) => `— ${memberNames[neumaId] || neumaId}: ${torch}`);
  const torchBlock = torchLines.length
    ? `\n\nTorches — each member's own note to its next instance; hand these back if you run a follow-up:\n${torchLines.join('\n')}`
    : '';
  const failed = Object.entries(failures);
  if (!failed.length && !skipped.length) {
    return `Your team finished all ${order.length} steps. Each part, in completion order:\n\n${parts.join('\n\n')}${torchBlock}`;
  }
  // A partial run says what did NOT happen first — the lead must never read
  // a missing part as a finished one.
  const failedLines = failed.map(([id, why]) => `— ${id} (${memberNames[byId.get(id)?.neumaId] || byId.get(id)?.neumaId || 'unknown'}): FAILED — ${why}`);
  const skippedLines = skipped.map((id) => `— ${id}: NEVER STARTED — it depends on failed work`);
  return `Your team did not finish: ${order.length} of ${steps.length} steps completed.\n${[...failedLines, ...skippedLines].join('\n')}\n\nThe completed parts, in completion order:\n\n${parts.join('\n\n')}${torchBlock}`;
};
