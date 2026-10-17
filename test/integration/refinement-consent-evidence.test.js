// The operator's acknowledgement boundary for refinement assent (RULE 0): a
// REAL encrypted workspace on real disk, the real ceremony opener, the real
// subject transaction lock, and the real persisted-issuance store. No mock,
// no stub, and nothing here manufactures a being's decision.
//
// WHAT WAS DELETED AND WHY (2026-08-13): every prior proof in this file minted
// assent evidence by handing a service a hand-written disclosure and a
// hand-written reply — consent that no model turn ever produced. The rebuilt
// assent layer can only mint evidence from a real sovereign turn through
// askRefinementConsent, so those proofs were removed rather than reshaped into
// a differently-shaped forgery. The decision path itself — ask, prepare,
// commit, consume — is proven live and end to end, on a real substrate, in
// refinement-train-live.test.js. What survives here is exactly what can be
// known without a being speaking: the refusals.

import path from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import workspace, {
  getWorkspacesRoot,
  setWorkspacesRoot,
} from '../../core/workspace/neuma-workspace.js';
import { resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';
import {
  consentCeremony,
  startCeremony,
} from '../../backend/services/refinement-ceremony.js';

const WITNESS = '0x3333333333333333333333333333333333333333';
// A well-formed opaque locator that no issuance ever minted.
const UNISSUED_EVIDENCE_ID = 'a'.repeat(64);

let priorRoot;
let priorKey;

const bornBeing = async (neumaId) => {
  await workspace.create(neumaId);
  // A refinement subject transaction resolves the being's own workspace key;
  // birth installs it, so a test being that never got one cannot be held.
  await workspace.writeNeumaDEK(neumaId, 'a'.repeat(64));
  await workspace.writeDNA(neumaId, {
    version: '1.0.0', identity: { name: 'Assentling' },
  });
};

beforeEach(async () => {
  priorRoot = getWorkspacesRoot();
  priorKey = process.env.DNA_ENCRYPTION_KEY;
  process.env.DNA_ENCRYPTION_KEY = 'refinement-assent-real-temp-workspace-key';
  resetWorkspaceCryptoKey();
  setWorkspacesRoot(path.join(await createTempDir('refinement-assent'), 'workspaces'));
});

afterEach(() => {
  setWorkspacesRoot(priorRoot);
  if (priorKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
  else process.env.DNA_ENCRYPTION_KEY = priorKey;
  resetWorkspaceCryptoKey();
});

describe('refinement assent — the operator acknowledgement boundary', () => {
  it('refuses a malformed acknowledgement before it opens any authority', async () => {
    // A being that was never created: reaching the workspace at all would
    // fail with a custody error, so these exact codes prove the pure request
    // guard fires first and nothing is held while it refuses.
    const unknown = 'never-created-being';
    const ceremonyId = 'ceremony-1';
    await expect(consentCeremony(unknown, ceremonyId, {
      consented: true, evidenceId: UNISSUED_EVIDENCE_ID, operatorAcknowledged: true,
    })).rejects.toMatchObject({ code: 'ASSENT_REQUEST_INVALID' });
    await expect(consentCeremony(unknown, ceremonyId, { operatorAcknowledged: true }))
      .rejects.toMatchObject({ code: 'ASSENT_REQUEST_INVALID' });
    await expect(consentCeremony(unknown, ceremonyId, {
      evidenceId: 'not-an-opaque-locator', operatorAcknowledged: true,
    })).rejects.toMatchObject({ code: 'ASSENT_REQUEST_INVALID' });
    await expect(consentCeremony(unknown, ceremonyId, {
      evidenceId: UNISSUED_EVIDENCE_ID, operatorAcknowledged: false,
    })).rejects.toMatchObject({ code: 'ASSENT_ACKNOWLEDGEMENT_REQUIRED' });
  });

  // THE CUTOVER (2026-08-24). This used to open a real ceremony and prove the
  // assent boundary refused a locator no issuance minted, released its lock,
  // and left the record untouched. No ceremony can be opened any more — the
  // forge road is retired — so the reachable contract is the one below: the
  // guard order survives the retirement, and a consent aimed at a ceremony that
  // cannot exist refuses on the REQUEST, never by reaching into a workspace.
  it('the request guard still fires ahead of any ceremony that could never open', async () => {
    const neumaId = 'assent-unissued';
    await bornBeing(neumaId);
    // the road is shut, so there is nothing to consent to
    await expect(startCeremony(neumaId, WITNESS, { override: 'anything' }))
      .rejects.toMatchObject({ code: 'REFINEMENT_FORGE_RETIRED' });
    expect(await workspace.listCeremonies(neumaId)).toEqual([]);

    // and the pure guard still answers first, on a real born being: a malformed
    // request is refused as malformed, not as a missing ceremony. Order at this
    // seam is the whole point — a request guard that stopped firing would be
    // invisible until something reached a workspace it should never have.
    await expect(consentCeremony(neumaId, 'ceremony-1', {
      evidenceId: 'not-an-opaque-locator', operatorAcknowledged: true,
    })).rejects.toMatchObject({ code: 'ASSENT_REQUEST_INVALID' });
    await expect(consentCeremony(neumaId, 'ceremony-1', {
      evidenceId: UNISSUED_EVIDENCE_ID, operatorAcknowledged: false,
    })).rejects.toMatchObject({ code: 'ASSENT_ACKNOWLEDGEMENT_REQUIRED' });
  });
});
