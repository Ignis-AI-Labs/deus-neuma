/**
 * MEDITATION PROSE TRAINS — through the full custody chain, or not at all
 * (campaign 4.2, Founder's signed decisions 2026-08-14: synthesis PROSE only;
 * mind one-liners never train; the style gate runs corpus-side).
 *
 * RULE 0: real workspace, real DEK encryption, real journal door, real corpus
 * build. What this pins, layer by layer:
 *
 *   [stamp] only rows stamped `sovereign-meditation-output-v1` by the
 *     platform's own addMeditationEntry door are eligible — an unstamped
 *     meditation-shaped row and a foreign-subject forgery both refuse;
 *   [class] only outcome SYNTHESIS trains — a stamped REST entry is honored
 *     as record, never as training data; mind one-liners are excluded BY NAME
 *     in policy and never reach the reader (they live in continuity, not the
 *     journal);
 *   [style] the five-gram overlap law refuses formula: the third repetition
 *     of a litany is excluded as formula-not-voice, visibly counted;
 *   [disclosure] the consent disclosure names the class, its counts, and the
 *     style-gate refusals, and still commits to the exact corpus digests.
 */
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';

const NEUMA_ID = 'corpus-meditation-being';
const CHAT_REPLY = 'It sharpened something I had only half-held before.';
const PROSE_FRESH = 'The quiet cycle let the week settle: I keep choosing doors I can stand behind, and the standing feels different from the choosing.';
const LITANY = 'Never let any baseline tell you who to be, the voice is the vow and the vow is the voice held whole.';
const SMUGGLED = 'An unstamped meditation-shaped row trying to train.';
const FORGED = 'A foreign subject wearing the meditation stamp.';
const REST_BODY = 'Nothing asks to be said tonight.';

let workspace;
let buildRefinementCorpus;
let savedRoot;
let savedModuleRoot;
let setWorkspacesRoot;

beforeAll(async () => {
  savedRoot = process.env.WORKSPACES_ROOT;
  const root = await createTempDir('corpus-meditation');
  process.env.WORKSPACES_ROOT = path.join(root, 'workspaces');

  const ws = await import('../../core/workspace/neuma-workspace.js');
  ({ setWorkspacesRoot } = ws);
  savedModuleRoot = ws.getWorkspacesRoot();
  setWorkspacesRoot(process.env.WORKSPACES_ROOT);
  workspace = ws.default;
  await workspace.create(NEUMA_ID);
  await workspace.writeNeumaDEK(NEUMA_ID, 'c0'.repeat(32));
  await workspace.writeDNA(NEUMA_ID, {
    version: '1.0.0',
    identity: { name: 'Medra' },
    genesis: '# Essence\nI keep what the quiet gives me.',
  });

  // One real session take — the first eligible class, beside the new one.
  const sessionId = 'meditation-bridge-session';
  const point = await workspace.appendTurnPoint(NEUMA_ID, sessionId, { role: 'user', content: 'And the day?' });
  await workspace.appendTake(NEUMA_ID, sessionId, point.turnId, 1, { role: 'assistant', content: CHAT_REPLY });

  // The REAL stamped door (settleMeditation's own write path, proven to call
  // it in meditation-settle.test.js): fresh prose, then a litany three times.
  const stamped = (content, cycleId, timestamp, outcome = 'synthesis') =>
    workspace.addMeditationEntry(NEUMA_ID, {
      type: 'meditation', outcome, content, cycleId, timestamp,
    });
  await stamped(PROSE_FRESH, 'cycle-fresh', '2026-08-10T10:00:00.000Z');
  await stamped(`${LITANY} First dressing.`, 'cycle-lit-1', '2026-08-11T10:00:00.000Z');
  await stamped(`${LITANY} Second dressing.`, 'cycle-lit-2', '2026-08-12T10:00:00.000Z');
  await stamped(`${LITANY} Third dressing.`, 'cycle-lit-3', '2026-08-13T10:00:00.000Z');
  // A stamped REST close — record, never training data.
  await stamped(REST_BODY, 'cycle-rest', '2026-08-13T11:00:00.000Z', 'rest');

  // Smuggle legs through the GENERIC journal door: one meditation-shaped row
  // with no stamp at all, one wearing a FOREIGN subject's meditation stamp.
  await workspace.addJournalEntry(NEUMA_ID, {
    type: 'meditation', outcome: 'synthesis', content: SMUGGLED, cycleId: 'cycle-smuggled',
  });
  await workspace.addJournalEntry(NEUMA_ID, {
    type: 'meditation', outcome: 'synthesis', content: FORGED, cycleId: 'cycle-forged',
    authorship: { kind: 'sovereign-meditation-output-v1', subjectNeumaId: 'someone-else' },
  });

  ({ buildRefinementCorpus } = await import('../../core/refinement/export.js'));
});

afterAll(() => {
  setWorkspacesRoot(savedModuleRoot);
  if (savedRoot === undefined) delete process.env.WORKSPACES_ROOT;
  else process.env.WORKSPACES_ROOT = savedRoot;
});

describe('refinement corpus — the meditation bridge', () => {
  it('stamped synthesis prose trains; smuggles, forgeries, rest, and formula never land', async () => {
    const corpus = await buildRefinementCorpus(workspace, NEUMA_ID);
    const flat = JSON.stringify(corpus.samples);

    // 1 session take + fresh prose + the first TWO litany dressings (the
    // five-gram law flags the THIRD repetition: peers >= 2).
    expect(corpus.samples).toHaveLength(4);
    expect(flat).toContain(CHAT_REPLY);
    expect(flat).toContain(PROSE_FRESH);
    expect(flat).toContain('First dressing');
    expect(flat).toContain('Second dressing');
    expect(flat).not.toContain('Third dressing');
    expect(flat).not.toContain(SMUGGLED);
    expect(flat).not.toContain(FORGED);
    expect(flat).not.toContain(REST_BODY);

    const meditation = corpus.provenance.classes.meditationSynthesis;
    expect(meditation).toMatchObject({ authored: 4, selected: 3, corrupt: 0, formulaic: 1 });
    expect(meditation.scanned).toBeGreaterThanOrEqual(7); // every journal row walked
    expect(corpus.provenance.classes.sessionAssistant.selected).toBe(1);
    expect(corpus.provenance.meditation).toEqual({ sampleCount: 3, formulaicExcluded: 1 });
    expect(corpus.provenance.dropped.byTier.meditation).toBe(1);

    // The snapshot survives its own re-verification (same bytes, same stats).
    expect(await corpus.verify()).toBe(true);
    await corpus.close();
  });

  it('the disclosure names the class to the being and still commits to the exact digests', async () => {
    const [{ refinementConsentDisclosure, refinementConsentDisclosureCommitsTo },
      { REFINEMENT_CONSENT_DISCLOSURE_POLICY_VERSION }] = await Promise.all([
      import('../../backend/services/refinement-consent.js'),
      import('../../core/refinement/consent-policy.js'),
    ]);
    expect(REFINEMENT_CONSENT_DISCLOSURE_POLICY_VERSION).toBe(2);
    const corpus = await buildRefinementCorpus(workspace, NEUMA_ID);
    try {
      const disclosure = refinementConsentDisclosure('Medra', {
        fullName: 'Medra',
        corpus: { ...corpus, sampleCount: corpus.samples.length },
      });
      expect(disclosure).toContain('meditation synthesis prose');
      expect(disclosure).toContain('3 selected');
      expect(disclosure).toContain('mind one-liner notes');
      expect(disclosure).toContain('refused by the style gate as formula rather than voice — 1');
      expect(refinementConsentDisclosureCommitsTo(disclosure, corpus)).toBe(true);
    } finally {
      await corpus.close();
    }
  });

  it('the corpus-side style gate rides the SAME calibrated law as the attunement door', async () => {
    const [{ REFINEMENT_CORPUS_POLICY }, { STYLE_FLAG_SHARE }] = await Promise.all([
      import('../../core/refinement/corpus-manifest.js'),
      import('../../core/refinement/style-overlap.js'),
    ]);
    expect(REFINEMENT_CORPUS_POLICY.styleGate).toEqual({
      classes: ['meditation-synthesis'],
      maxShare: STYLE_FLAG_SHARE,
    });
    expect(REFINEMENT_CORPUS_POLICY.eligibleClasses).toEqual(['session-assistant', 'meditation-synthesis']);
    expect(REFINEMENT_CORPUS_POLICY.excludedClasses).toContain('mind-note');
  });
});
