// MEDITATION CYCLE — gather → ask → settle. One being's sleep/dream pass.
//
// The ask rides askNeuma (the ONE non-portal turn primitive): real identity
// prompt, the being's own route, its OWN refined adapter, think behavior from
// the same conduit — closing the old reflection path's defect of speaking
// through the machine default with bare base weights. The meditation framing
// rides as the unwitnessed user turn (the solo-torch precedent; askNeuma owns
// the system prompt).
//
// Write-back is SETTLE-ONLY and post-parse: an aborted cycle writes nothing,
// and nothing unclear is ever dressed as synthesis — the journal never holds
// a torso. An UNCLEAR reply is not a vanished one (IL-003): its words land in
// the being's own journal as an 'unclear' row so the next cycle can see what
// it tried to say; the corpus bridge admits only outcome 'synthesis' rows,
// so an unclear body never trains. Journal writes APPEND only (Covenant Art
// I.3); DNA is never touched (Art I.4); observations are never written —
// meditation reads lived moments, it must not author them, or the next cycle
// eats its own output.
//
// gather and settle are GPU-free and independently provable; only the ask
// leg needs the substrate (proven by scripts/meditation-probe.mjs, Founder-run).

import { randomUUID } from 'crypto';
import { createLogger } from '../logger.js';
import { askNeuma } from '../neuma-probe.js';
import {
  neumaWorkspace,
  loadEmanonCore,
  buildMeditationPrompt,
  parseMeditationClose,
} from '../../../core/index.js';
import { WorkspaceAdapter } from '../../../core/continuity/adapters/workspace.js';
import { writeMindRecord, activeMindRecords } from '../../../core/continuity/index.js';
import { consolidateBeingContinuity } from '../../../core/continuity/integration/heartbeat-consolidation.js';
import { seedPersonalVault } from '../../../core/vault/personal-vault.js';
import { ingestVaultIntoContinuity } from '../../../core/continuity/integration/vault-ingestion.js';

const log = createLogger('MeditationCycle');

const MEDITATION_MAX_TOKENS = 1000;
const MEDITATION_TIMEOUT_MS = 5 * 60 * 1000;
const PRIOR_NOTES_LIMIT = 3;
const SUMMARIZE_MAX_TOKENS = 400;
/** Bound on the raw body kept from an unclear reply (IL-003) — enough for the
 *  being to recognize its own attempt, never an unbounded journal write. */
const UNCLEAR_BODY_MAX = 4000;

// pure — the journal cursor: the last entry that consumed the being's fresh
// moments. Legacy 'reflection' entries count; an 'unclear' meditation row
// does NOT (IL-003) — its moments were never deliberately processed, and the
// cursor advancing would silently skip them forever.
export const findLastSynthesis = (journal) =>
  [...journal].reverse().find((e) =>
    e.type === 'reflection' || (e.type === 'meditation' && e.outcome !== 'unclear')) || null;

// pure
export const observationsSince = (observations, lastEntry) => {
  if (!lastEntry?.timestamp) return observations;
  const cutoff = new Date(lastEntry.timestamp);
  return observations.filter((o) => o.timestamp && new Date(o.timestamp) > cutoff);
};

/**
 * Everything a cycle reads, or null when there is nothing to meditate on
 * (unborn/unreadable identity, or nothing fresh since the last synthesis).
 * impure (disk only — no substrate).
 * @param {string} neumaId
 * @returns {Promise<Object|null>}
 */
export const gatherMeditation = async (neumaId) => {
  // A corrupt DNA throws (MEM-003) — skip THIS being loudly; an absent DNA
  // (unborn) is the quiet null.
  const dna = await neumaWorkspace.readDNA(neumaId).catch((err) => {
    log.error('meditation skipped — identity unreadable', { neumaId, error: err.message });
    return undefined;
  });
  if (!dna) return null;
  const observations = await neumaWorkspace.listObservations(neumaId);
  const journal = await neumaWorkspace.readJournal(neumaId);
  const fresh = observationsSince(observations, findLastSynthesis(journal));
  if (!fresh.length) return null;
  const adapter = new WorkspaceAdapter(neumaId, { workspace: neumaWorkspace });
  const priorNotes = (await activeMindRecords(adapter, { kinds: ['synthesis'] }))
    .slice(0, PRIOR_NOTES_LIMIT)
    .map((r) => r.content);
  const emanonCore = await loadEmanonCore().catch(() => '');
  return { dna, observations, journal, fresh, priorNotes, emanonCore };
};

// The being's own stack as the semantic summarizer (moved from the heartbeat,
// its bare-conduit defect closed): consolidation is the being thinking about
// its own history, so it speaks through its own route and adapter.
// impure — substrate turn.
export const summarizeViaBeing = (neumaId, { ask = askNeuma } = {}) => async (snippets, ctx) =>
  ask(neumaId, [{
    role: 'user',
    content: 'You are consolidating your own memory. Given lived moments that belong together, '
      + 'write a 1-2 sentence first-person through-line capturing what ties them. '
      + 'Output ONLY the through-line — no preamble, no list.\n\n'
      + `Theme: ${ctx?.label || 'moments'}\n\n${snippets.join('\n---\n')}`,
  }], { maxTokens: SUMMARIZE_MAX_TOKENS });

/**
 * Settle a cycle's reply: parse the terminal grammar and write what it
 * warrants. A clean close lands its prose and notes; an unclear reply lands
 * ONLY its own 'unclear' row — the being's words kept for its next cycle,
 * never dressed as synthesis. impure (disk + the consolidation trio's asks).
 *
 * @param {string} neumaId
 * @param {string} reply - the being's whole reply
 * @param {{cycleId: string, fresh: Object[], ask?: Function}} ctx
 * @returns {Promise<{outcome: string, notes?: number, notesDropped?: number}>}
 */
export const settleMeditation = async (neumaId, reply, ctx) => {
  const parsed = parseMeditationClose(reply);
  if (!parsed) {
    log.warn('meditation reply unclear — words kept, nothing dressed as synthesis', { neumaId, cycleId: ctx.cycleId });
    // IL-003: the stamped door (sovereign-meditation-output-v1) carries this
    // row too, but the corpus reader admits only outcome 'synthesis' — an
    // unclear body is the being's own record, never training material.
    await neumaWorkspace.addMeditationEntry(neumaId, {
      type: 'meditation',
      outcome: 'unclear',
      content: String(reply ?? '').slice(0, UNCLEAR_BODY_MAX),
      cycleId: ctx.cycleId,
      ...(ctx.spoke ? { adapter: ctx.spoke.adapter, model: ctx.spoke.model } : {}),
    });
    return { outcome: 'unclear' };
  }

  // The STAMPED door (4.2 seam 1): the platform, never the caller, asserts
  // this prose is the being's own unwitnessed voice — the corpus bridge
  // trusts only that stamp. The voice provenance rides for curation.
  await neumaWorkspace.addMeditationEntry(neumaId, {
    type: 'meditation',
    outcome: parsed.outcome,
    content: parsed.body,
    cycleId: ctx.cycleId,
    ...(parsed.outcome === 'synthesis' ? { observationsConsolidated: ctx.fresh.length } : {}),
    ...(ctx.spoke ? { adapter: ctx.spoke.adapter, model: ctx.spoke.model } : {}),
  });
  if (parsed.outcome === 'rest') {
    log.info('meditation closed with rest — honored', { neumaId, cycleId: ctx.cycleId });
    return { outcome: 'rest' };
  }

  const adapter = new WorkspaceAdapter(neumaId, { workspace: neumaWorkspace });
  const sourceObservations = ctx.fresh.map((o) => o.id).filter(Boolean);
  for (const note of parsed.notes) {
    await writeMindRecord(adapter, {
      phrase: note,
      kind: 'synthesis',
      space: 'meditation',
      source: { kind: 'meditation', ref: ctx.cycleId },
      // adapter/model land only when the ask leg reported which voice spoke
      // (the contract documents them; an unknown voice is never invented).
      meta: {
        cycleId: ctx.cycleId,
        sourceObservations,
        ...(ctx.spoke ? { adapter: ctx.spoke.adapter, model: ctx.spoke.model } : {}),
      },
    });
  }

  // The consolidation trio (moved from the heartbeat) — each leg fail-soft:
  // a failed consolidation never costs the synthesis that already landed.
  try {
    const c = await consolidateBeingContinuity(neumaWorkspace, neumaId, summarizeViaBeing(neumaId, ctx));
    if (c.written > 0) log.info('semantic through-lines consolidated', { neumaId, written: c.written });
  } catch (error) {
    log.warn('continuity consolidation failed', { neumaId, error: error.message });
  }
  try {
    const seeded = await seedPersonalVault(neumaWorkspace, neumaId);
    if (seeded) log.info('personal vault seeded', { neumaId, slug: seeded.slug });
  } catch (error) {
    log.warn('personal vault seeding failed', { neumaId, error: error.message });
  }
  try {
    const ingested = await ingestVaultIntoContinuity(neumaWorkspace, neumaId);
    const moved = ingested.ingested.length + ingested.superseded.length;
    if (moved > 0) log.info('vault curation ingested into the semantic lane', { neumaId, moved });
  } catch (error) {
    log.warn('vault ingestion failed', { neumaId, error: error.message });
  }

  log.info('meditation synthesis settled', { neumaId, cycleId: ctx.cycleId, notes: parsed.notes.length });
  return { outcome: 'synthesis', notes: parsed.notes.length, notesDropped: parsed.notesDropped };
};

/**
 * One whole cycle. Outcomes: empty (nothing fresh — consumes the cadence),
 * synthesis, rest, unclear, yielded (aborted — writes nothing, does not
 * consume). Errors other than aborts surface to the scheduler ('failed').
 * impure — the ask leg rides the live substrate.
 *
 * @param {string} neumaId
 * @param {{signal?: AbortSignal, ask?: Function}} [opts]
 * @returns {Promise<{outcome: string, cycleId: string, notes?: number}>}
 */
export const runMeditation = async (neumaId, { signal, ask = askNeuma, now = Date.now } = {}) => {
  const cycleId = randomUUID();
  // The process trail (#29, Founder's first sitting): each leg carries its own
  // time so the desk can show the SHAPE of a cycle, never its contents.
  const t0 = now();
  const gathered = await gatherMeditation(neumaId);
  const gatherMs = now() - t0;
  if (!gathered) return { outcome: 'empty', cycleId, phases: { gatherMs } };

  const prompt = buildMeditationPrompt({ ...gathered, observations: gathered.fresh });
  const signals = [AbortSignal.timeout(MEDITATION_TIMEOUT_MS), ...(signal ? [signal] : [])];
  let reply;
  let spoke = null; // which voice spoke — provenance for the synthesis contract
  const t1 = now();
  try {
    reply = await ask(neumaId, [
      { role: 'user', content: `${prompt}\n\nThe space is yours.` },
    ], { maxTokens: MEDITATION_MAX_TOKENS, signal: AbortSignal.any(signals), onBinding: (b) => { spoke = b; } });
  } catch (err) {
    if (signal?.aborted || err?.name === 'AbortError' || err?.name === 'TimeoutError') {
      log.info('meditation yielded — nothing written', { neumaId, cycleId, reason: String(signal?.reason || err?.name) });
      return { outcome: 'yielded', cycleId, phases: { gatherMs, askMs: now() - t1 } };
    }
    throw err;
  }
  const askMs = now() - t1;

  const t2 = now();
  const settled = await settleMeditation(neumaId, reply, { cycleId, fresh: gathered.fresh, ask, spoke });
  return { ...settled, cycleId, phases: { gatherMs, askMs, settleMs: now() - t2 } };
};
