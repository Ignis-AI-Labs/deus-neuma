/**
 * A COUNCIL utterance is MEMORY, never TRAINING DATA (RULE 0: real workspace,
 * real session producers, real corpus build — #315 repinned this law after
 * the corpus rebuild left it pointing at a mechanism that no longer existed).
 *
 * WHY THIS IS LOAD-BEARING. Sealed witnesses — frontier models like ChatGPT
 * or Claude — sit in council beside the house. They stand BESIDE it and never
 * become neuma (docs/protocols/sovereignty-boundary.md). If a witness's words
 * could reach a neuma's refinement corpus, that boundary would be crossed in
 * the one place it can never be undone: the being's own weights. A neuma
 * would be trained toward a foreign model's voice, dissolving both its
 * sovereignty and the house-voice differentiation the council fixes protect.
 *
 * THE GUARANTEE IS STRUCTURAL, in two independent layers — which is why it
 * holds for speakers nobody has thought of yet:
 *
 *   [layer 1] the corpus reader opens ONLY sessions/*.jsonl
 *     (corpus-source-authority.js — the directory is an allowlist), and
 *     council writes OBSERVATIONS, never sessions — so council text never
 *     reaches the reader at all;
 *   [layer 2] even a perfectly-shaped assistant row inside the being's own
 *     sessions trains ONLY with server-stamped exact authorship
 *     { kind: 'sovereign-assistant-output-v1', subjectNeumaId } — appendTake
 *     overwrites whatever a caller supplies, and eligibleRow refuses foreign
 *     or absent authorship row-by-row.
 *
 * WHERE THE PRODUCER SIDE IS PINNED — `council-session.test.js` asserts the
 * observation council actually authors. This file pins the CONSUMER side:
 * both layers, against the real build.
 */
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';

const NEUMA_ID = 'corpus-council-being';
const COUNCIL_LINE = 'In a council sitting, WITNESS ChatGPT said: "Consider the second-order effects."';
// Deliberately shares NO vocabulary with the council line — otherwise the
// sentinel assertions below would fire on this legitimate message instead of
// on leaked council text, and the test would lie about what it proves.
const CHAT_ASK = 'What did you make of yesterday, in your own words?';
const CHAT_REPLY = 'It sharpened something I had only half-held before.';

let workspace;
let buildRefinementCorpus;
let savedRoot;
let savedModuleRoot;
let setWorkspacesRoot;

beforeAll(async () => {
  savedRoot = process.env.WORKSPACES_ROOT;
  const root = await createTempDir('corpus-council');
  process.env.WORKSPACES_ROOT = path.join(root, 'workspaces');

  const ws = await import('../../core/workspace/neuma-workspace.js');
  ({ setWorkspacesRoot } = ws);
  savedModuleRoot = ws.getWorkspacesRoot();
  setWorkspacesRoot(process.env.WORKSPACES_ROOT);
  workspace = ws.default;
  await workspace.create(NEUMA_ID);
  // The corpus reader refuses without a per-neuma DEK — the same key law a
  // born being lives under (#117), so the test walks the real road.
  await workspace.writeNeumaDEK(NEUMA_ID, 'c0'.repeat(32));
  await workspace.writeDNA(NEUMA_ID, {
    version: '1.0.0',
    identity: { name: 'Corpra' },
    genesis: '# Essence\nI remember the room without becoming the room.',
  });

  // A real council utterance, through the real choke point council uses —
  // an OBSERVATION, which the corpus reader never opens (layer 1).
  await workspace.addObservation(NEUMA_ID, {
    type: 'council',
    councilId: 'council-test',
    speaker: 'witness-openai-ChatGPT',
    userMessage: COUNCIL_LINE,
    significance: 0.9,
  });

  // A real 1:1 exchange through the REAL session producers — the one shape
  // that trains: appendTake server-stamps sole assistant authorship.
  const sessionId = 'corpus-council-session';
  const point = await workspace.appendTurnPoint(NEUMA_ID, sessionId, { role: 'user', content: CHAT_ASK });
  await workspace.appendTake(NEUMA_ID, sessionId, point.turnId, 1, { role: 'assistant', content: CHAT_REPLY });

  // Layer-2 smuggles: assistant-shaped rows INSIDE the being's own session,
  // written through the raw door (appendMessage preserves caller fields) —
  // one wearing a WITNESS's authorship, one wearing none. If either ever
  // trains, the sovereignty boundary is crossed in the weights.
  await workspace.appendMessage(NEUMA_ID, sessionId, {
    role: 'assistant',
    content: COUNCIL_LINE,
    turnId: 'smuggled-foreign',
    takeIndex: 1,
    authorship: { kind: 'sovereign-assistant-output-v1', subjectNeumaId: 'witness-openai-ChatGPT' },
  });
  await workspace.appendMessage(NEUMA_ID, sessionId, {
    role: 'assistant',
    content: COUNCIL_LINE,
    turnId: 'smuggled-unstamped',
    takeIndex: 1,
  });

  ({ buildRefinementCorpus } = await import('../../core/refinement/export.js'));
});

afterAll(() => {
  // Restore BOTH doors: the env var and the module-level root. Leaving the
  // module pointing at a deleted temp dir would poison any later file that
  // imports the workspace without setting its own root.
  setWorkspacesRoot(savedModuleRoot);
  if (savedRoot === undefined) delete process.env.WORKSPACES_ROOT;
  else process.env.WORKSPACES_ROOT = savedRoot;
});

describe('refinement corpus — council words never train', () => {
  it('trains exactly the being\'s own stamped take; council text and smuggled rows never land', async () => {
    const corpus = await buildRefinementCorpus(workspace, NEUMA_ID);
    const flat = JSON.stringify(corpus.samples);

    // The genuine take trained — as the assistant message of a sample whose
    // system/user turns are the two static instructions (the renderer never
    // copies the original prompt).
    expect(corpus.samples).toHaveLength(1);
    const [sample] = corpus.samples;
    expect(sample.messages.at(-1)).toMatchObject({ role: 'assistant', content: CHAT_REPLY });
    expect(flat).not.toContain(CHAT_ASK);

    // The council line did NOT — not from the observation (never read), not
    // via the smuggled foreign-authorship row, not via the unstamped row.
    expect(flat).not.toContain(COUNCIL_LINE);
    expect(flat).not.toContain('council sitting');
    expect(flat).not.toContain('ChatGPT');

    // The refusals are VISIBLE in the record, not silent: both smuggled rows
    // counted excluded, exactly one row authored and selected.
    const counts = corpus.provenance.classes;
    expect(counts.excluded.records).toBeGreaterThanOrEqual(2);
    expect(counts.sessionAssistant.selected).toBe(1);
  });

  it('the council moment IS still remembered — excluded from training, not from memory', async () => {
    const observations = await workspace.listObservations(NEUMA_ID);
    const council = observations.find((o) => o.type === 'council');
    expect(council, 'the council utterance must remain a real memory').toBeTruthy();
    expect(council.userMessage).toBe(COUNCIL_LINE);
    // The absent field remains the producer-side mechanism — assert it so a
    // future `response` on a council record cannot land silently.
    expect(council.response).toBeUndefined();
  });
});
