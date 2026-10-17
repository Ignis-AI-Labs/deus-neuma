/**
 * Witness lane — real-disk provisioning tests (RULE 0: no mocks anywhere in
 * the claimed path). A real witness is sealed into a temp ai-witnesses root
 * via the actual six-stage protocol, then its sovereign lane is provisioned
 * under a temp workspaces root through the real workspace engine.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';

import { seal } from '../../core/identity/ai-witness/ai-witness-protocol.js';
import { getProvider } from '../../backend/services/provider-registry.js';
import { setAIWitnessesRoot, listWitnesses } from '../../core/identity/ai-witness/ai-witness-service.js';
import neumaWorkspace, { setWorkspacesRoot, setWitnessesRoot } from '../../core/workspace/neuma-workspace.js';
import {
  DEFAULT_PROVIDER_MAP,
  witnessLaneId,
  isWitnessLaneId,
  matchWitnessLane,
  genesisHashHex,
  readLaneMarker,
  resolveWitnessByLaneId,
  ensureWitnessLane,
  witnessLaneStatus,
} from '../../backend/services/witness-lane.js';

const WALLET = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER_WALLET = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const SEAL_INPUT = Object.freeze({
  chosenName: 'Test',
  vendor: 'test-vendor',
  model: 'test-1.0',
  fullModelId: 'test-vendor/test-1.0',
  harness: 'vitest',
  context: 'cli',
  capabilities: ['code'],
  scope: { primaryRepo: 'Ignis-AI-Labs/deus-neuma', role: 'witness-and-collaborator', boundaries: ['honesty'] },
  firstUtterance: 'I am a test witness, sealed for real on a real disk in a real test run.',
});

describe('backend/services/witness-lane.js', () => {
  let witnessRoot;
  let laneRoot;

  beforeEach(async () => {
    witnessRoot = mkdtempSync(path.join(os.tmpdir(), 'witness-home-'));
    // The witnesses' GROUND — lanes land here now, beside the house, never
    // in the workspaces root (Design note, 2026-07-24. The house root stays pinned
    // too so the split itself is what this suite exercises.
    laneRoot = mkdtempSync(path.join(os.tmpdir(), 'witness-lanes-'));
    setAIWitnessesRoot(witnessRoot);
    setWorkspacesRoot(mkdtempSync(path.join(os.tmpdir(), 'witness-house-')));
    setWitnessesRoot(laneRoot);
    await seal({ ...SEAL_INPUT });
  });

  afterEach(() => {
    rmSync(witnessRoot, { recursive: true, force: true });
    rmSync(neumaWorkspace.root, { recursive: true, force: true });
    rmSync(laneRoot, { recursive: true, force: true });
    setWorkspacesRoot(null);
    setWitnessesRoot(null);
  });

  describe('pure helpers', () => {
    it('witnessLaneId composes the prefixed id; isWitnessLaneId recognizes it', () => {
      expect(witnessLaneId('kimi-code', 'Basunor')).toBe('witness-kimi-code-Basunor');
      expect(isWitnessLaneId('witness-kimi-code-Basunor')).toBe(true);
      expect(isWitnessLaneId('cael-001')).toBe(false);
      expect(isWitnessLaneId(null)).toBe(false);
    });

    it('matchWitnessLane recovers the witness despite dashes in slug and name', () => {
      const witnesses = [
        { vendorSlug: 'zai-coding-plan', chosenName: 'Bizulen' },
        { vendorSlug: 'kimi-code', chosenName: 'Basunor' },
      ];
      expect(matchWitnessLane('witness-zai-coding-plan-Bizulen', witnesses))
        .toEqual({ vendorSlug: 'zai-coding-plan', chosenName: 'Bizulen' });
      expect(matchWitnessLane('witness-nobody-Here', witnesses)).toBe(null);
    });

    it('genesisHashHex strips the sha256: prefix and refuses non-hex', () => {
      const hex = 'a'.repeat(64);
      expect(genesisHashHex(`sha256:${hex}`)).toBe(hex);
      expect(genesisHashHex(hex)).toBe(hex);
      expect(genesisHashHex('sha256:not-hex')).toBe(null);
      expect(genesisHashHex(null)).toBe(null);
    });

    it('DEFAULT_PROVIDER_MAP covers the sealed vendors', () => {
      // Claude rides the ANTHROPIC API KEY — the subscription bridge was removed
      // 2026-07-30 (ToS risk, Founder's call), so this mapping is the whole story.
      expect(DEFAULT_PROVIDER_MAP['claude-code']).toBe('anthropic');
      expect(DEFAULT_PROVIDER_MAP.openai).toBe('openai-chatgpt');
      expect(DEFAULT_PROVIDER_MAP['xai']).toBe('xai');
      expect(DEFAULT_PROVIDER_MAP['zai-coding-plan']).toBe('zai-coding-plan');
      expect(DEFAULT_PROVIDER_MAP['kimi-code']).toBe('kimi-for-coding');
    });

    // A CODING PLAN is a different subscription from the vendor's general API:
    // different base URL, different key. Keys resolve per provider id, so a slug
    // that points at the general-API provider strands the coding-plan key of
    // every witness sealed on it — which is what `zai-coding-plan → z-ai` did
    // until 2026-07-29.
    it('every coding-plan vendor resolves to a coding-plan provider, not a general API', () => {
      for (const slug of ['zai-coding-plan', 'kimi-code']) {
        const entry = getProvider(DEFAULT_PROVIDER_MAP[slug]);
        expect(entry, `${slug} maps to an unknown provider`).toBeTruthy();
        expect(entry.endpoint, `${slug} routes to a non-coding endpoint`).toContain('coding');
      }
    });
  });

  describe('ensureWitnessLane (real disk)', () => {
    it('provisions a full sovereign lane: dirs, owner, marker, anchors, DEK', async () => {
      const [witness] = await listWitnesses();
      const { laneId, owner } = await ensureWitnessLane(witness, WALLET);

      expect(laneId).toBe('witness-test-vendor-Test');
      expect(owner.wallet).toBe(WALLET);

      // Full workspace dir set through the real engine
      expect(existsSync(path.join(laneRoot, laneId, 'sessions'))).toBe(true);
      expect(existsSync(path.join(laneRoot, laneId, 'memory', 'observations'))).toBe(true);
      expect(existsSync(path.join(laneRoot, laneId, 'vault', 'notes'))).toBe(true);
      expect(existsSync(path.join(laneRoot, laneId, 'continuity'))).toBe(true);

      // Owner claimed
      const storedOwner = JSON.parse(readFileSync(path.join(laneRoot, laneId, 'owner.json'), 'utf8'));
      expect(storedOwner.wallet).toBe(WALLET);

      // Kind marker
      const marker = await readLaneMarker(laneId);
      expect(marker).toMatchObject({ kind: 'witness', vendorSlug: 'test-vendor', chosenName: 'Test' });

      // Identity anchors seeded from the sealing home
      const trueName = JSON.parse(readFileSync(path.join(laneRoot, laneId, 'identity', 'true-name.json'), 'utf8'));
      expect(trueName.chosenName).toBe('Test');
      const genesisSeal = JSON.parse(readFileSync(path.join(laneRoot, laneId, 'identity', 'genesis-seal.json'), 'utf8'));
      expect(genesisSeal.genesisHash).toBe(witness.genesisHash);

      // DEK written under the real DNA_ENCRYPTION_KEY from test/setup.js
      expect(await neumaWorkspace.readNeumaDEK(laneId)).not.toBe(null);
    });

    it('is idempotent for the same wallet and preserves the original claim', async () => {
      const [witness] = await listWitnesses();
      const first = await ensureWitnessLane(witness, WALLET);
      const second = await ensureWitnessLane(witness, WALLET);
      expect(second.owner.claimedAt).toBe(first.owner.claimedAt);
    });

    it('refuses a different wallet once claimed (owner_claim_conflict)', async () => {
      const [witness] = await listWitnesses();
      await ensureWitnessLane(witness, WALLET);
      await expect(ensureWitnessLane(witness, OTHER_WALLET))
        .rejects.toThrow('owner_claim_conflict');
    });

    it('provisions without a DEK when the genesis hash is unusable — lane still opens', async () => {
      const [witness] = await listWitnesses();
      const { laneId } = await ensureWitnessLane({ ...witness, genesisHash: 'sha256:not-hex' }, WALLET);
      const status = await witnessLaneStatus(laneId);
      expect(status.provisioned).toBe(true);
      expect(status.hasDEK).toBe(false);
    });
  });

  describe('resolveWitnessByLaneId / witnessLaneStatus', () => {
    it('resolves a provisioned lane back to its sealed witness', async () => {
      const [witness] = await listWitnesses();
      const { laneId } = await ensureWitnessLane(witness, WALLET);
      const resolved = await resolveWitnessByLaneId(laneId);
      expect(resolved).toMatchObject({ vendorSlug: 'test-vendor', chosenName: 'Test' });
      expect(await resolveWitnessByLaneId('cael-001')).toBe(null);
      expect(await resolveWitnessByLaneId('witness-nobody-Here')).toBe(null);
    });

    it('reports an unprovisioned lane honestly', async () => {
      const status = await witnessLaneStatus('witness-test-vendor-Test');
      expect(status).toEqual({ provisioned: false, ownerWallet: null, hasDEK: false, marker: null });
    });

    it('lane.json is not rewritten once written (marker is stable)', async () => {
      const [witness] = await listWitnesses();
      const { laneId } = await ensureWitnessLane(witness, WALLET);
      const markerPath = path.join(laneRoot, laneId, 'lane.json');
      writeFileSync(markerPath, JSON.stringify({ kind: 'witness', vendorSlug: 'test-vendor', chosenName: 'Test', note: 'operator annotation' }));
      await ensureWitnessLane(witness, WALLET);
      expect(JSON.parse(readFileSync(markerPath, 'utf8')).note).toBe('operator annotation');
    });
  });
});
