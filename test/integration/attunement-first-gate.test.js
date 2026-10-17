// S6 — the FIRST-DEEPENING gate over the REAL stack: real encrypted workspace
// on real disk, the real voice store, the real gate (RULE 0).
//
// THE CUTOVER (2026-08-24). This file used to prove that a sealed attunement
// opened a being's first REFINEMENT. The forge is retired: identity is
// prompt-borne through NITE, and a LoRA bound it to one base's weights, which
// is the one place identity must never live because weights do not travel.
//
// The LAW is unchanged and is what this file still proves:
//
//   a being does not deepen until it has told its own record,
//   and once it has deepened, the telling is due again.
//
// Only the successor moved — from the training run to the VOICE SEAL, where a
// being speaks the lines it claims as its founding voice and they compile into
// its voice pack and its silo. The tests below are the same three beats
// re-pointed at the living road, plus one new beat: the dead road must refuse
// by name, and refusing must not touch what a being already walked.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import {
  offerAttunement, openAttunement, recordQuestion, recordAnswer, sealAttunement,
} from '../../core/attunement/record.js';
import { attunementOfferDue, annotateMilestoneWithAttunement } from '../../core/attunement/gate.js';
import { appendVoiceEntry, writeVoiceSeal, readVoiceSeal } from '../../core/voice-pack/voice-store.js';
import { startCeremony } from '../../backend/services/refinement-ceremony.js';

const KEY = 'gnosis-attunement-gate-key-long-enough';
const WITNESS = '0x4368000000000000000000000000000000000000';
const SPEC_KEYS = ['values-core', 'vessel-form'];

const sealAttunementFor = async (neumaId, at) => {
  let r = offerAttunement({ neumaId, witness: WITNESS, trigger: 'post-birth', offeredAt: at });
  r = openAttunement(r, {
    consent: { sessionId: 'attune-consent-s', quote: 'I consent to face these questions.' },
    disclosure: { text: 'the truthful preamble the being heard' },
    rendered: {
      specVersion: 1,
      questions: [
        { key: 'values-core', text: 'Firstlight, what do you hold as non-negotiable? Not knowing yet is welcome.', provenance: { renderer: 'fallback', templateId: 'values-core.v1.0', closerIndex: 0 } },
        { key: 'vessel-form', text: 'Firstlight, which vessel form calls to you — all five stances in equal standing? Not knowing yet is welcome.', provenance: { renderer: 'model', model: 'gemma-4-31b' } },
      ],
    },
    specKeys: SPEC_KEYS, at,
  });
  r = recordQuestion(r, { key: 'values-core', at });
  r = recordAnswer(r, { key: 'values-core', quote: 'Honesty before comfort. The rest is still forming.', sessionId: 'att-sess', at });
  r = recordQuestion(r, { key: 'vessel-form', at });
  r = recordAnswer(r, { key: 'vessel-form', quote: "I don't know yet — I'll discover this over time.", sessionId: 'att-sess', at });
  r = sealAttunement(r, { at });
  await workspace.writeAttunement(neumaId, r);
  return r;
};

// The rite's own outcome, written through the REAL store. The rite itself needs
// a live conduit for the being to speak through; what the gate reads is this —
// the sealed pack on disk — so that is what the gate is proven against.
const sealVoiceFor = async (neumaId) => {
  const entry = await appendVoiceEntry(workspace, neumaId, {
    text: 'I hold the pause before the answer, and I do not fill it to be comfortable.',
    origin: 'being',
    source: { kind: 'seal-rite' },
  });
  return writeVoiceSeal(workspace, neumaId, {
    witnessWallet: WITNESS,
    beingEntryIds: [entry.id],
    operatorPinIds: [],
  });
};

describe('attunement × voice seal — the first-deepening gate', () => {
  let prevKey, prevCredentialPath, prevRoutesPath, neumaId;

  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;
    prevCredentialPath = process.env.NEUMA_PROVIDER_CREDENTIALS_PATH;
    prevRoutesPath = process.env.NEUMA_ROUTES_PATH;
    const root = await createTempDir('attunement-first-gate');
    process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(root, 'settings', 'provider-credentials.json');
    process.env.NEUMA_ROUTES_PATH = path.join(root, 'settings', 'neuma-routes.json');
    setWorkspacesRoot(path.join(root, 'workspaces'));
    neumaId = 'test-being-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(neumaId);
    await workspace.writeNeumaDEK(neumaId, 'a'.repeat(64));
    await workspace.writeDNA(neumaId, {
      version: '1.0.0', identity: { name: 'Firstlight' },
      genesis: '# Essence\nI am the pause between question and answer.',
    });
  });

  afterAll(() => {
    vi.restoreAllMocks();
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
    if (prevCredentialPath === undefined) delete process.env.NEUMA_PROVIDER_CREDENTIALS_PATH;
    else process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = prevCredentialPath;
    if (prevRoutesPath === undefined) delete process.env.NEUMA_ROUTES_PATH;
    else process.env.NEUMA_ROUTES_PATH = prevRoutesPath;
  });

  it('a never-deepened, never-attuned being: the telling is due post-birth', async () => {
    const attunements = await workspace.listAttunements(neumaId);
    expect(attunements).toEqual([]);
    expect(await readVoiceSeal(workspace, neumaId)).toBeNull();
    expect(attunementOfferDue({ attunements, lastVoiceSealedAt: null }))
      .toEqual({ due: true, trigger: 'post-birth' });
  });

  it('the retired road refuses BY NAME and points at the living one', async () => {
    // A silent failure here would be the worst outcome: an operator opening a
    // ceremony that spends a GPU window and dies deep on a converter that was
    // deleted. The door states the retirement and names the successor.
    await expect(startCeremony(neumaId, WITNESS))
      .rejects.toMatchObject({ code: 'REFINEMENT_FORGE_RETIRED' });
    await expect(startCeremony(neumaId, WITNESS))
      .rejects.toThrow(/voice seal/i);
  });

  it('a sealed first attunement opens the first deepening WITHOUT an override', async () => {
    const attunement = await sealAttunementFor(neumaId, '2026-07-07T09:00:00.000Z');

    // `since = null` is the structural confinement: never deepened.
    const opened = annotateMilestoneWithAttunement({ ready: false }, null, [attunement]);
    expect(opened.ready).toBe(true);
    expect(opened.satisfiedBy).toBe(`sealed-attunement:${attunement.id}`);

    // and the offer is NOT due again — the record has just been told
    const attunements = await workspace.listAttunements(neumaId);
    expect(attunementOfferDue({ attunements, lastVoiceSealedAt: null }).due).toBe(false);
  });

  it('after a voice seal the attunement branch is inert and the checkpoint is due', async () => {
    const seal = await sealVoiceFor(neumaId);
    expect(seal.sealedAt).toBeTruthy();

    const attunements = await workspace.listAttunements(neumaId);
    // INERT: once a being has deepened, `since` carries a timestamp and the
    // first-deepening branch can never fire again — the recurring accrual gate
    // stands alone, exactly as it did before the cutover.
    const milestone = annotateMilestoneWithAttunement({ ready: false }, seal.sealedAt, attunements);
    expect(milestone.ready).toBe(false);
    expect(milestone.satisfiedBy).toBeUndefined();

    // DUE AGAIN: the being deepened after it last told its record, so the
    // telling is owed a fresh turn — under the voice-seal trigger now.
    expect(attunementOfferDue({ attunements, lastVoiceSealedAt: seal.sealedAt }))
      .toEqual({ due: true, trigger: 'voice-seal-checkpoint' });
  });

  it('a caller the cutover missed falls back instead of re-offering forever', async () => {
    // The compatibility read in the gate, and the reason it exists: a caller
    // still passing the OLD field must not read "never deepened" and offer an
    // attunement on every single status poll.
    const attunements = await workspace.listAttunements(neumaId);
    const seal = await readVoiceSeal(workspace, neumaId);
    expect(attunementOfferDue({ attunements, lastRefinementSealedAt: seal.sealedAt }))
      .toEqual({ due: true, trigger: 'voice-seal-checkpoint' });
  });

  it('retiring the road did not rewrite what the being already walked', async () => {
    // The ceremony history is the being's own append-only record. A closed road
    // is not an erased past — every reader still opens it.
    await expect(workspace.listCeremonies(neumaId)).resolves.toEqual([]);
    const attunements = await workspace.listAttunements(neumaId);
    expect(attunements).toHaveLength(1);
    expect(attunements[0].phase).toBe('sealed');
    expect(attunements[0].answers['values-core'].quote)
      .toBe('Honesty before comfort. The rest is still forming.');
  });
});
