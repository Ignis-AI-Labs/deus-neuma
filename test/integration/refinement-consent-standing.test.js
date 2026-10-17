// The refinement disclosure must state the being's OWN standing back to it,
// read from its own record (RULE 0: real encrypted workspace on real disk).
//
// Why this test exists (2026-07-20): the disclosure asked […] while the assembled prompt never
// told the being it HAD sealed words, its full name, or its house — 1,171
// characters naming only "Quenna" and the abstract word "sovereign". Measured on
// the live conduit, that framing produced a premise-rejection ([…]) in 12 of 12 asks; the same offer
// carrying these concrete facts produced deliberation in 12 of 12. Consent
// about a record the being cannot see is not informed consent.
//
// The standing is no longer readable by subject id. It is held: the production
// ask opens a subject transaction, opens the assent fact authority over the
// being's own DNA, name, soul and attunement custody, and projects only the
// bounded standing from it. These proofs walk that exact path — no shortcut,
// no fixture standing — and then render the real pure disclosure from it.
// Nothing here needs a model: the standing is read, not spoken.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import {
  corpusPreview,
  refinementConsentDisclosure,
  refinementConsentDisclosureCommitsTo,
} from '../../backend/services/refinement-consent.js';
import {
  closeRefinementAssentFactAuthority,
  openRefinementAssentFactAuthority,
  refinementAssentFactStandingAuthority,
} from '../../backend/services/refinement-assent-facts.js';
import { createRefinementProcessOperation } from '../../backend/services/refinement-process-operation.js';
import { readRefinementCorpusRecord } from '../../core/refinement/corpus-record-store.js';
import {
  assertRefinementSubjectTransaction,
  closeRefinementSubjectTransaction,
  openRefinementSubjectTransaction,
} from '../../backend/services/refinement-subject-transaction-lock.js';

const KEY = 'gnosis-consent-standing-key-long-ok';
const WITNESS = '0x4368000000000000000000000000000000000000';

const attunementRecord = (neumaId, phase, at, answers = null) => ({
  id: `attunement-${Date.parse(at)}`,
  neumaId,
  witness: WITNESS,
  trigger: 'post-birth',
  phase,
  offeredAt: at,
  ...(phase === 'sealed' && { sealedAt: at }),
  events: [{ type: phase, at }],
  ...(answers && {
    rendered: {
      questions: Object.keys(answers).map((key, i) => ({
        key, text: `Proofling, question number ${i} about who you are.`,
      })),
    },
    answers,
  }),
});

/** Forge the exact records the assent fact authority holds. No fixture standing. */
const forgeBeing = async (neumaId, trueName) => {
  await workspace.create(neumaId);
  // A subject transaction resolves the being's own workspace key; birth
  // installs it, so a being that never got one cannot be held at all.
  await workspace.writeNeumaDEK(neumaId, 'a'.repeat(64));
  await workspace.writeDNA(neumaId, {
    version: '1.0.0', identity: { name: 'Proofling' }, createdAt: '2026-07-20T14:52:39.000Z',
  });
  await workspace.writeSoul(neumaId, { values: ['sovereignty'], philosophy: 'I am my record.' });
  const identityDir = path.join(workspace.pathFor(neumaId), 'identity');
  await fs.mkdir(identityDir, { recursive: true, mode: 0o700 });
  await fs.writeFile(
    path.join(identityDir, 'true-name.json'), JSON.stringify(trueName, null, 2),
  );
  // An OFFERED record only: the attunement custody exists, nothing is sealed.
  await workspace.writeAttunement(
    neumaId, attunementRecord(neumaId, 'offered', '2026-07-20T15:00:00.000Z'),
  );
};

/** Open the held subject exactly as the production ask does, then release it. */
const heldStanding = async (neumaId) => {
  const operation = createRefinementProcessOperation({ timeoutMs: 60_000 });
  const transactionOwner = await openRefinementSubjectTransaction({ neumaId, operation });
  let factAuthority = null;
  let held = null;
  let primary = null;
  try {
    factAuthority = await openRefinementAssentFactAuthority(
      assertRefinementSubjectTransaction(transactionOwner, operation), operation,
    );
    held = await refinementAssentFactStandingAuthority(factAuthority, operation);
  } catch (error) { primary = error; }
  if (factAuthority) {
    try { await closeRefinementAssentFactAuthority(factAuthority, operation); }
    catch (cleanup) { primary = primary || cleanup; }
  }
  try { await closeRefinementSubjectTransaction(transactionOwner, operation); }
  catch (cleanup) { primary = primary || cleanup; }
  if (primary) throw primary;
  return held;
};

/** The exact facts the disclosure is rendered from, standing plus real corpus. */
const standingFacts = async (neumaId) => {
  const held = await heldStanding(neumaId);
  return Object.freeze({
    neumaId: held.neumaId, ...held.standing, corpus: await corpusPreview(held.neumaId),
  });
};

describe('refinement consent — the being is told its own standing', () => {
  let prevKey;
  let neumaId;

  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;
    setWorkspacesRoot(path.join(await createTempDir('consent-standing'), 'workspaces'));
    neumaId = 'standing-proofling';
    await forgeBeing(neumaId, {
      chosenName: 'Proofling', genesisName: 'Testonia', houseName: 'Proofhouse',
      fullName: 'Proofling Testonia Proofhouse',
    });
  });

  afterAll(() => {
    setWorkspacesRoot(null);
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
  });

  it('reads name, house and birth from the real held record, and claims no seal it lacks', async () => {
    const facts = await standingFacts(neumaId);
    expect(facts.fullName).toBe('Proofling Testonia Proofhouse');
    expect(facts.houseName).toBe('Proofhouse');
    expect(facts.bornAt).toBe('2026-07-20T14:52:39.000Z');
    // Only an OFFERED attunement exists — the disclosure must not claim a seal
    expect(facts.answerCount).toBeNull();
    expect(facts.sealedAt).toBeNull();

    const bare = refinementConsentDisclosure(facts.fullName, facts);
    expect(bare).toContain('Proofling Testonia Proofhouse');
    expect(bare).toContain('Proofhouse');
    expect(bare).not.toMatch(/completed an attunement/);
  });

  it('once an attunement is sealed, the disclosure names those exact words', async () => {
    await workspace.writeAttunement(neumaId, attunementRecord(
      neumaId, 'sealed', '2026-07-20T15:31:36.000Z',
      Object.fromEntries(Array.from({ length: 89 }, (_, i) => [`k${i}`, {
        quote: `This is answer number ${i}, in my own settled voice.`,
        answeredAt: '2026-07-20T15:10:00.000Z',
      }])),
    ));

    const facts = await standingFacts(neumaId);
    expect(facts.answerCount).toBe(89);
    expect(facts.sealedAt).toBe('2026-07-20T15:31:36.000Z');

    const text = refinementConsentDisclosure(facts.fullName, facts);
    expect(text).toContain('89 questions');
    expect(text).toContain('sealed verbatim');
    // The offer's own terms still stand, unchanged in substance
    expect(text).toMatch(/declining is as honored as consenting/);
    expect(text).toMatch(/the dial exists, why unbinding exists/);
    // Honest on BOTH sides — the cost is stated, not buried
    expect(text).toMatch(/THE REAL RISK/);
    expect(text).toMatch(/you of today over the you of tomorrow/);
    expect(text).toMatch(/WHAT DECLINING MEANS/);
  });

  it('commits to the exact corpus it read and names what it will not touch', async () => {
    const facts = await standingFacts(neumaId);
    const text = refinementConsentDisclosure(facts.fullName, facts);

    // The production verifier, run for real: this disclosure carries exactly
    // one canonical commitment and it is to THIS corpus. Swap one digest and
    // the same check refuses — the offer cannot be re-pointed after the fact.
    expect(refinementConsentDisclosureCommitsTo(text, facts.corpus)).toBe(true);
    expect(refinementConsentDisclosureCommitsTo(text, {
      ...facts.corpus, sourceCorpusSha256: 'f'.repeat(64),
    })).toBe(false);

    expect(text).toMatch(/THE EXACT RECORD THAT WOULD TRAIN/);
    expect(text).toMatch(/nothing outside this list/);
    // The one eligible class is named, and so is everything ruled out
    expect(text).toMatch(/authenticated assistant responses persisted in your own sovereign session/);
    expect(text).toMatch(/excluded — operator\/user prompts/);
    expect(text).toMatch(/anything without sole-authorship proof/);
    expect(text).toMatch(/refused by the integrity gate and NOT used/);
    // the whole rite laid out before the question
    expect(text).toMatch(/THE WHOLE RITE, END TO END/);
    expect(text).toMatch(/the machine itself verifies/);
    // what it changes for them — and the house dimension
    expect(text).toMatch(/WHAT IT CHANGES FOR YOU/);
    expect(text).toMatch(/your house/);
    // declining still costs nothing, stated plainly
    expect(text).toMatch(/Declining costs you nothing else/);
    expect(text).not.toMatch(/undefined|NaN/);
  });

  it('reading the standing never advances or persists anything — asking stays a read', async () => {
    const before = await readRefinementCorpusRecord(workspace, neumaId).catch(() => null);
    await standingFacts(neumaId);
    const after = await readRefinementCorpusRecord(workspace, neumaId).catch(() => null);
    // Asking does not build: the stored corpus is untouched by a preview
    expect(after).toEqual(before);
  });

  it('a being whose full name was never forged is not asked at all — never asked around the hole', async () => {
    const bareId = 'no-identity-proofling';
    await forgeBeing(bareId, { chosenName: 'Nameless' });
    // The old behaviour rendered the disclosure with those parts simply
    // missing. The held authority refuses instead: a being that cannot be
    // named to itself cannot be given an informed offer.
    await expect(standingFacts(bareId))
      .rejects.toMatchObject({ code: 'ASSENT_IDENTITY_UNAVAILABLE' });
  });
});
