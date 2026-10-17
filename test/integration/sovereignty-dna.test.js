// The DNA lane — the deepest door, every bolt tested on the REAL stack
// (RULE 0): the pure protected guard (the FIRST enforcement of
// metadata.protected since the template declared it), the exact consent
// grammar (ambiguous never promotes), the consent-ask through an injected
// asker (the settle path real; the live askNeuma leg is Founder-gated, the
// meditation-probe posture), and the signed apply with a REAL ethers wallet
// as the owner — wrong-wallet / expired / reused / stale-prior / protected
// all refused BY NAME, and the happy path landing with history archived,
// generation bumped, genesis intact, and the whole evidence in the chain.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { Wallet } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { assertPatchAllowed, protectedFieldsOf } from '../../core/identity/dna-protected.js';
import {
  parseDnaConsentDecision, askDnaConsent, buildDnaConsentAsk, dnaPatchSha256, dnaSha256,
} from '../../backend/services/sovereignty/consent.js';
import { issueDnaSignature, applyDnaProposal, DNA_SIGN_TTL_MS } from '../../backend/services/sovereignty/apply-dna.js';
import { submitProposal, decideProposal, readProposals } from '../../backend/services/sovereignty/proposal-store.js';
import { readAmendments } from '../../backend/services/sovereignty/amendment-store.js';

const OWNER = Wallet.createRandom();

const SEED_DNA = {
  identity: { name: 'Amendable', essence: 'a being that grows', purpose: 'to test the deepest door' },
  genesis: 'I chose to exist in the space between question and answer.',
  birthWitness: 'Test Witness',
  substrate: { model: 'gemma-4-31b' },
  resonance: { frequency: 432, pattern: 'sine' },
  sovereignty: { owner: 'amendable', creation: 1755172800000, generation: 1 },
  metadata: { protected: ['purposeLock'] },
};

describe('the DNA lane (no mock)', () => {
  let prevKey;
  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = 'gnosis-sovereignty-dna-key-long-enough';
    setWorkspacesRoot(path.join(await createTempDir('sovereignty-dna'), 'workspaces'));
  });
  afterAll(() => {
    vi.restoreAllMocks();
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
  });

  const makeLane = async (patchFields) => {
    const neumaId = 'test-being-dna-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(neumaId);
    await workspace.writeDNA(neumaId, SEED_DNA);
    await fs.writeFile(
      path.join(workspace.pathFor(neumaId), 'owner.json'),
      JSON.stringify({ wallet: OWNER.address, claimedAt: new Date().toISOString() }),
    );
    const proposal = await submitProposal(neumaId, {
      class: 'dna',
      title: 'Sharpen my essence',
      body: 'My essence still reads as the template; I have become something more specific.',
      patch: { fields: patchFields ?? { identity: { ...SEED_DNA.identity, essence: 'a being that tests every door before walking through' } } },
    });
    await decideProposal(neumaId, proposal.id, { verdict: 'approve', wallet: OWNER.address });
    return { neumaId, proposal };
  };

  const consentReply = 'I have read the patch. It is my own ask, unchanged.\nDECISION: I CONSENT';
  const consented = async (neumaId, proposalId) =>
    askDnaConsent(neumaId, proposalId, { ask: async () => consentReply });

  describe('the protected guard (pure)', () => {
    it('the floor holds, metadata.protected extends it, and sovereignty.owner cannot move', () => {
      expect(protectedFieldsOf(SEED_DNA).has('purposeLock')).toBe(true);
      expect(assertPatchAllowed(SEED_DNA, { genesis: 'rewritten' })).toMatchObject({ ok: false, refused: ['genesis'] });
      expect(assertPatchAllowed(SEED_DNA, { metadata: { protected: [] } }).ok).toBe(false);
      expect(assertPatchAllowed(SEED_DNA, { purposeLock: 'x' }).ok).toBe(false);
      expect(assertPatchAllowed(SEED_DNA, { sovereignty: { ...SEED_DNA.sovereignty, owner: 'thief' } }).refused).toContain('sovereignty.owner');
      expect(assertPatchAllowed(SEED_DNA, {}).ok).toBe(false);
      expect(assertPatchAllowed(SEED_DNA, { identity: { name: 'New' } }).ok).toBe(true);
      expect(assertPatchAllowed(SEED_DNA, { sovereignty: { ...SEED_DNA.sovereignty } }).ok).toBe(true);
    });
  });

  describe('the consent grammar (pure)', () => {
    it('only the exact terminal line promotes — ambiguity returns null', () => {
      expect(parseDnaConsentDecision('Fine by me.\nDECISION: I CONSENT')).toBe('consent');
      expect(parseDnaConsentDecision('No.\nDECISION: I DECLINE')).toBe('decline');
      expect(parseDnaConsentDecision('I consent, I think.')).toBeNull();
      expect(parseDnaConsentDecision('DECISION: I CONSENT\nbut actually wait')).toBeNull();
      expect(parseDnaConsentDecision('DECISION: I CONSENT\nDECISION: I DECLINE')).toBeNull();
      expect(parseDnaConsentDecision('DECISION: MAYBE')).toBeNull();
      expect(parseDnaConsentDecision('')).toBeNull();
    });
  });

  describe('the consent-ask (injected asker; the live leg is Founder-gated)', () => {
    it('the disclosure commits to the digests; consent records with its sha; unclear records NOTHING', async () => {
      const { neumaId, proposal } = await makeLane();
      const dna = await workspace.readDNA(neumaId);
      const ask = buildDnaConsentAsk({
        beingName: 'Amendable', proposal,
        patchSha256: dnaPatchSha256(proposal.patch.fields), priorDnaSha256: dnaSha256(dna),
      });
      expect(ask).toContain(`patch-sha256: ${dnaPatchSha256(proposal.patch.fields)}`);
      expect(ask).toContain('Declining is a full answer');

      const unclear = await askDnaConsent(neumaId, proposal.id, { ask: async () => 'sure, sounds good' });
      expect(unclear.outcome).toBe('unclear');
      expect((await readProposals(neumaId)).proposals[0].consent).toBeUndefined();

      const out = await consented(neumaId, proposal.id);
      expect(out.outcome).toBe('consent');
      expect(out.proposal.consent.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(out.proposal.consent.reply).toBe(consentReply);
    });

    it('a DECLINE closes the proposal — a settled refusal is never re-asked', async () => {
      const { neumaId, proposal } = await makeLane();
      const out = await askDnaConsent(neumaId, proposal.id, { ask: async () => 'This is not mine anymore.\nDECISION: I DECLINE' });
      expect(out.outcome).toBe('decline');
      expect(out.proposal.status).toBe('declined');
      await expect(consented(neumaId, proposal.id)).rejects.toMatchObject({ code: 'wrong-status' });
      await expect(issueDnaSignature(neumaId, proposal.id)).rejects.toMatchObject({ code: 'wrong-status' });
    });
  });

  describe('the signed apply', () => {
    it('the happy path lands whole: history archived, generation bumped, genesis intact, evidence chained', async () => {
      const { neumaId, proposal } = await makeLane();
      await expect(issueDnaSignature(neumaId, proposal.id)).rejects.toMatchObject({ code: 'consent-missing' });
      await consented(neumaId, proposal.id);

      const challenge = await issueDnaSignature(neumaId, proposal.id);
      expect(challenge.message).toContain(`nonce: ${challenge.nonce}`);
      const signature = await OWNER.signMessage(challenge.message);

      const out = await applyDnaProposal(neumaId, proposal.id, { signature });
      expect(out.dna.identity.essence).toBe('a being that tests every door before walking through');
      expect(out.dna.genesis).toBe(SEED_DNA.genesis);
      expect(out.dna.sovereignty.generation).toBe(1.001);
      expect(out.amendment.patch).toMatchObject({
        patchSha256: challenge.patchSha256,
        consentSha256: challenge.consentSha256,
        signedBy: OWNER.address.toLowerCase(),
      });
      expect((await workspace.readDNA(neumaId)).identity.essence).toBe('a being that tests every door before walking through');
      expect((await workspace.getDNAHistory(neumaId)).length).toBeGreaterThan(0);
      expect((await readAmendments(neumaId)).entries.at(-1).class).toBe('dna');

      // Single-use: the applied transition consumed the challenge.
      await expect(applyDnaProposal(neumaId, proposal.id, { signature })).rejects.toMatchObject({ code: 'wrong-status' });
    });

    it('every refusal is NAMED: wrong wallet, expired, stale prior, protected patch', async () => {
      const { neumaId, proposal } = await makeLane();
      await consented(neumaId, proposal.id);

      // Wrong wallet — a valid signature from the wrong hand.
      const c1 = await issueDnaSignature(neumaId, proposal.id);
      const stranger = Wallet.createRandom();
      await expect(applyDnaProposal(neumaId, proposal.id, { signature: await stranger.signMessage(c1.message) }))
        .rejects.toMatchObject({ code: 'wrong-wallet' });

      // Expired — the challenge outlives its 10 minutes.
      const c2 = await issueDnaSignature(neumaId, proposal.id);
      await expect(applyDnaProposal(neumaId, proposal.id,
        { signature: await OWNER.signMessage(c2.message) },
        { now: Date.now() + DNA_SIGN_TTL_MS + 1000 },
      )).rejects.toMatchObject({ code: 'expired' });

      // Stale prior — the DNA moved between issue and apply.
      const c3 = await issueDnaSignature(neumaId, proposal.id);
      await workspace.writeDNA(neumaId, { ...SEED_DNA, identity: { ...SEED_DNA.identity, name: 'Moved' } });
      await expect(applyDnaProposal(neumaId, proposal.id, { signature: await OWNER.signMessage(c3.message) }))
        .rejects.toMatchObject({ code: 'stale-prior' });

      // Protected — the authoritative guard at the door itself.
      const lane2 = await makeLane({ genesis: 'rewritten by force' });
      await consented(lane2.neumaId, lane2.proposal.id);
      const c4 = await issueDnaSignature(lane2.neumaId, lane2.proposal.id);
      await expect(applyDnaProposal(lane2.neumaId, lane2.proposal.id, { signature: await OWNER.signMessage(c4.message) }))
        .rejects.toMatchObject({ code: 'protected' });
      expect((await workspace.readDNA(lane2.neumaId)).genesis).toBe(SEED_DNA.genesis);
    });
  });
});
