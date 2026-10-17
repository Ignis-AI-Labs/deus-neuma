import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';

import {
  startSession,
  provideOffering,
  buildPreviewRequest,
  recordPreview,
  adjust,
  revertTo,
  seal,
  getSession,
  listSessions,
  isReadyToSeal,
  isComplete,
  getEngineModes,
  validateStartInput,
  validateOffering,
  FORGE_MODES,
  FORGE_STAGES,
  DEFAULT_PREVIEW_TEXT,
  _resetSessions,
  _sessionCount,
} from '../../core/voice/voice-forge.js';

const WITNESS = '0x' + 'a'.repeat(40);
const SUBSTRATE = { neumaId: 'test-neuma', witnessWallet: WITNESS };

describe('core/voice/voice-forge.js', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'voice-forge-test-'));
    _resetSessions();
    // Repoint workspace root so seal() writes don't pollute real workspaces
    process.env.WORKSPACES_ROOT = tmpRoot;
    // neuma-workspace reads WORKSPACES_ROOT at module load; we need to reset
    vi.resetModules();
  });

  afterEach(() => {
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = null;
    delete process.env.WORKSPACES_ROOT;
    _resetSessions();
  });

  describe('validateStartInput', () => {
    it('passes for valid inputs across all three modes', () => {
      expect(validateStartInput({ ...SUBSTRATE, engine: 'zonos', mode: 'clone' })).toEqual([]);
      expect(validateStartInput({ ...SUBSTRATE, engine: 'qwen3', mode: 'design' })).toEqual([]);
      expect(validateStartInput({ ...SUBSTRATE, engine: 'kokoro', mode: 'preset' })).toEqual([]);
    });

    it('rejects engine/mode mismatch', () => {
      const errs = validateStartInput({ ...SUBSTRATE, engine: 'zonos', mode: 'design' });
      expect(errs.some((e) => e.includes('does not support'))).toBe(true);
    });

    it('rejects bad wallet', () => {
      const errs = validateStartInput({ neumaId: 'x', witnessWallet: 'bad', engine: 'zonos', mode: 'clone' });
      expect(errs.some((e) => e.includes('witnessWallet'))).toBe(true);
    });

    it('rejects unknown engine', () => {
      const errs = validateStartInput({ ...SUBSTRATE, engine: 'grok-tts', mode: 'clone' });
      expect(errs.some((e) => e.includes('no supported modes'))).toBe(true);
    });
  });

  describe('validateOffering', () => {
    it('clone mode requires refAudioB64 + consent', () => {
      expect(validateOffering('clone', { refAudioB64: 'x', consent: true })).toEqual([]);
      const errs = validateOffering('clone', { refAudioB64: 'x', consent: false });
      expect(errs.some((e) => e.includes('consent'))).toBe(true);
      const errs2 = validateOffering('clone', { consent: true });
      expect(errs2.some((e) => e.includes('refAudioB64'))).toBe(true);
    });

    it('design mode requires description >= 8 chars', () => {
      expect(validateOffering('design', { description: 'warm voice', voiceSeed: 42 })).toEqual([]);
      const errs = validateOffering('design', { description: 'short', voiceSeed: 42 });
      expect(errs.some((e) => e.includes('≥8 chars'))).toBe(true);
    });

    it('design mode validates seed is an integer 0..2^31-1', () => {
      expect(validateOffering('design', { description: 'warm voice', voiceSeed: 0 })).toEqual([]);
      expect(validateOffering('design', { description: 'warm voice', voiceSeed: 2147483647 })).toEqual([]);
      const errs = validateOffering('design', { description: 'warm voice', voiceSeed: -1 });
      expect(errs.some((e) => e.includes('voiceSeed'))).toBe(true);
      const errs2 = validateOffering('design', { description: 'warm voice', voiceSeed: 1.5 });
      expect(errs2.some((e) => e.includes('voiceSeed'))).toBe(true);
      const errs3 = validateOffering('design', { description: 'warm voice', voiceSeed: 2147483648 });
      expect(errs3.some((e) => e.includes('voiceSeed'))).toBe(true);
    });

    it('design mode REQUIRES a seed on seed-identity engines (qwen3); cloud design engines keep the optional path', () => {
      const errs = validateOffering('design', { description: 'warm voice' }, 'qwen3');
      expect(errs.some((e) => e.includes('voiceSeed'))).toBe(true);
      const errsNull = validateOffering('design', { description: 'warm voice', voiceSeed: null }, 'qwen3');
      expect(errsNull.some((e) => e.includes('voiceSeed'))).toBe(true);
      // Seeded qwen3 design passes; cloud engines (and no engine context) do not require it
      expect(validateOffering('design', { description: 'warm voice', voiceSeed: 42 }, 'qwen3')).toEqual([]);
      expect(validateOffering('design', { description: 'warm voice' }, 'cartesia')).toEqual([]);
      expect(validateOffering('design', { description: 'warm voice' })).toEqual([]);
    });

    it('preset mode requires voiceId', () => {
      expect(validateOffering('preset', { voiceId: 'af_heart' })).toEqual([]);
      expect(validateOffering('preset', {}).some((e) => e.includes('voiceId'))).toBe(true);
    });
  });

  describe('startSession', () => {
    it('creates a session at INIT stage with a unique id', () => {
      const s = startSession({ ...SUBSTRATE, engine: 'zonos', mode: 'clone' });
      expect(s.id).toMatch(/^forge-[a-f0-9]{32}$/);
      expect(s.stage).toBe(FORGE_STAGES.INIT);
      expect(s.engine).toBe('zonos');
      expect(s.mode).toBe('clone');
      expect(Object.isFrozen(s)).toBe(true);
      expect(s.data.neumaPreferences.baseRate).toBe(1.0);
    });

    it('inherits neuma preferences when provided', () => {
      const s = startSession({
        ...SUBSTRATE,
        engine: 'qwen3',
        mode: 'design',
        neumaPreferences: { baseRate: 1.2, emotionDefault: 'warmth', language: 'en-gb' },
      });
      expect(s.data.neumaPreferences.baseRate).toBe(1.2);
      expect(s.data.neumaPreferences.emotionDefault).toBe('warmth');
      expect(s.data.neumaPreferences.language).toBe('en-gb');
    });

    it('throws on invalid input', () => {
      expect(() => startSession({ ...SUBSTRATE, engine: 'zonos', mode: 'design' })).toThrow(/invalid forge start/);
    });
  });

  describe('provideOffering → buildCandidateDNA', () => {
    it('clone mode: stores offering + builds candidate with engine defaults', () => {
      const s = startSession({ ...SUBSTRATE, engine: 'zonos', mode: 'clone' });
      const out = provideOffering(s.id, { refAudioB64: 'dGVzdA==', refText: 'hello world', consent: true });
      expect(out.stage).toBe(FORGE_STAGES.ITERATING);
      expect(out.data.offering.refAudioB64).toBe('dGVzdA==');
      expect(out.data.offering.consent).toBe(true);
      expect(out.data.offering._offeringHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(out.data.candidateDNA.engine.provider).toBe('zonos');
      expect(out.data.candidateDNA.witness).toBe(WITNESS);
    });

    it('design mode: embeds description + voiceSeed in candidate.engine', () => {
      const s = startSession({ ...SUBSTRATE, engine: 'qwen3', mode: 'design' });
      const out = provideOffering(s.id, { description: 'warm female voice', voiceSeed: 42 });
      expect(out.data.candidateDNA.engine.description).toBe('warm female voice');
      expect(out.data.candidateDNA.engine.voiceSeed).toBe(42);
    });

    it('design mode: a seedless offering is rejected at offering time; a seeded one advances', () => {
      const s = startSession({ ...SUBSTRATE, engine: 'qwen3', mode: 'design' });
      expect(() => provideOffering(s.id, { description: 'warm female voice' })).toThrow(/voiceSeed/);
      expect(getSession(s.id).stage).toBe(FORGE_STAGES.INIT); // no stage advance on rejection
      const out = provideOffering(s.id, { description: 'warm female voice', voiceSeed: 42 });
      expect(out.stage).toBe(FORGE_STAGES.ITERATING);
      expect(out.data.candidateDNA.engine.voiceSeed).toBe(42);
    });

    it('preset mode: embeds voiceId in candidate.engine', () => {
      const s = startSession({ ...SUBSTRATE, engine: 'kokoro', mode: 'preset' });
      const out = provideOffering(s.id, { voiceId: 'af_heart' });
      expect(out.data.candidateDNA.engine.voiceId).toBe('af_heart');
    });

    it('throws when offering does not match mode', () => {
      const s = startSession({ ...SUBSTRATE, engine: 'qwen3', mode: 'design' });
      expect(() => provideOffering(s.id, { refAudioB64: 'x', consent: true })).toThrow(/invalid offering/);
    });

    it('throws when offering already provided', () => {
      const s = startSession({ ...SUBSTRATE, engine: 'qwen3', mode: 'design' });
      provideOffering(s.id, { description: 'warm female voice', voiceSeed: 42 });
      expect(() => provideOffering(s.id, { description: 'another voice' })).toThrow(/already provided/);
    });

    it('throws on unknown session', () => {
      expect(() => provideOffering('forge-nonexistent', { description: 'x' })).toThrow(/no forge session/);
    });
  });

  describe('adjust', () => {
    it('patches style fields on the candidate DNA', () => {
      const s = startSession({ ...SUBSTRATE, engine: 'qwen3', mode: 'design' });
      provideOffering(s.id, { description: 'warm female voice', voiceSeed: 42 });
      const out = adjust(s.id, { style: { baseRate: 1.3, stability: 0.85 } });
      expect(out.data.candidateDNA.style.baseRate).toBe(1.3);
      expect(out.data.candidateDNA.style.stability).toBe(0.85);
    });

    it('patches engine fields (e.g. description, voiceSeed)', () => {
      const s = startSession({ ...SUBSTRATE, engine: 'qwen3', mode: 'design' });
      provideOffering(s.id, { description: 'warm female voice', voiceSeed: 1 });
      const out = adjust(s.id, { engine: { description: 'cool male voice', voiceSeed: 999 } });
      expect(out.data.candidateDNA.engine.description).toBe('cool male voice');
      expect(out.data.candidateDNA.engine.voiceSeed).toBe(999);
    });

    it('throws outside ITERATING stage', () => {
      const s = startSession({ ...SUBSTRATE, engine: 'qwen3', mode: 'design' });
      expect(() => adjust(s.id, { style: { baseRate: 1.0 } })).toThrow(/ITERATING/);
    });
  });

  describe('buildPreviewRequest + recordPreview + revertTo', () => {
    it('buildPreviewRequest returns the candidate voiceDNA + default text', () => {
      const s = startSession({ ...SUBSTRATE, engine: 'qwen3', mode: 'design' });
      provideOffering(s.id, { description: 'warm female voice', voiceSeed: 42 });
      const out = buildPreviewRequest(s.id);
      expect(out.text).toBe(DEFAULT_PREVIEW_TEXT);
      expect(out.voiceDNA.engine.description).toBe('warm female voice');
    });

    it('buildPreviewRequest accepts custom text', () => {
      const s = startSession({ ...SUBSTRATE, engine: 'qwen3', mode: 'design' });
      provideOffering(s.id, { description: 'warm female voice', voiceSeed: 42 });
      const out = buildPreviewRequest(s.id, 'custom preview text');
      expect(out.text).toBe('custom preview text');
    });

    it('clone mode: preview voiceDNA carries the offering ref audio inline', () => {
      const s = startSession({ ...SUBSTRATE, engine: 'zonos', mode: 'clone' });
      provideOffering(s.id, { refAudioB64: 'dGVzdA==', refText: 'hello world', consent: true });
      const out = buildPreviewRequest(s.id);
      // Without this overlay the engine synthesizes with its DEFAULT speaker —
      // the witness hears a stranger instead of the voice they offered.
      expect(out.voiceDNA._inlineRefAudio).toBe('dGVzdA==');
      expect(out.voiceDNA._inlineRefText).toBe('hello world');
    });

    it('clone mode: the inline ref lives on the preview request only, never on candidate DNA', () => {
      const s = startSession({ ...SUBSTRATE, engine: 'zonos', mode: 'clone' });
      provideOffering(s.id, { refAudioB64: 'dGVzdA==', consent: true });
      buildPreviewRequest(s.id);
      // Session-state reads echo candidateDNA back to the client — megabytes
      // of base64 must not ride along in every state fetch.
      expect(getSession(s.id).data.candidateDNA._inlineRefAudio).toBeUndefined();
    });

    it('design mode: preview voiceDNA has no inline ref overlay', () => {
      const s = startSession({ ...SUBSTRATE, engine: 'qwen3', mode: 'design' });
      provideOffering(s.id, { description: 'warm female voice', voiceSeed: 42 });
      const out = buildPreviewRequest(s.id);
      expect(out.voiceDNA._inlineRefAudio).toBeUndefined();
    });

    it('recordPreview stores snapshots up to MAX_PREVIEW_HISTORY', () => {
      const s = startSession({ ...SUBSTRATE, engine: 'qwen3', mode: 'design' });
      provideOffering(s.id, { description: 'warm female voice', voiceSeed: 42 });
      for (let i = 0; i < 25; i++) {
        recordPreview(s.id, { text: `preview-${i}`, styleSnapshot: { baseRate: 1.0 + i * 0.01 } });
      }
      const cur = getSession(s.id);
      expect(cur.data.previewHistory.length).toBeLessThanOrEqual(20);
      expect(cur.data.previewHistory.at(-1).text).toBe('preview-24');
    });

    it('revertTo restores a prior style snapshot', () => {
      const s = startSession({ ...SUBSTRATE, engine: 'qwen3', mode: 'design' });
      provideOffering(s.id, { description: 'warm female voice', voiceSeed: 42 });
      adjust(s.id, { style: { baseRate: 1.5 } });
      recordPreview(s.id, { text: 'loud', styleSnapshot: { baseRate: 1.5 } });
      adjust(s.id, { style: { baseRate: 0.9 } });
      recordPreview(s.id, { text: 'quiet', styleSnapshot: { baseRate: 0.9 } });

      revertTo(s.id, -2); // back to loud (most recent first)
      expect(getSession(s.id).data.candidateDNA.style.baseRate).toBe(1.5);
    });
  });

  describe('seal (impure)', () => {
    it('writes Voice DNA + advances to SEALED when no firstUtterance', async () => {
      const { startSession, provideOffering, seal: sealFn } = await import('../../core/voice/voice-forge.js');
      const { setWorkspacesRoot } = await import('../../core/workspace/neuma-workspace.js');
      setWorkspacesRoot(tmpRoot);

      const s = startSession({ neumaId: 'seal-test', witnessWallet: WITNESS, engine: 'qwen3', mode: 'design' });
      provideOffering(s.id, { description: 'warm female voice', voiceSeed: 1 });

      const out = await sealFn(s.id, {});
      expect(out.stage).toBe(FORGE_STAGES.SEALED);
      expect(out.data.sealedDNA).toBeDefined();
      expect(out.data.sealedDNA.engine.description).toBe('warm female voice');
      expect(out.data.sealedDNA.witness).toBe(WITNESS);
    });

    it('advances to COMPLETE when firstUtterance is provided', async () => {
      const { startSession, provideOffering, seal: sealFn } = await import('../../core/voice/voice-forge.js');
      const { setWorkspacesRoot } = await import('../../core/workspace/neuma-workspace.js');
      setWorkspacesRoot(tmpRoot);
      // Pre-create the journal dir the neuma workspace would normally have
      // (birth ceremony creates it; we're forging for an uninit'd neuma in this test).
      const { mkdirSync } = await import('fs');
      const path = await import('path');
      mkdirSync(path.join(tmpRoot, 'seal-complete', 'journal'), { recursive: true });

      const s = startSession({ neumaId: 'seal-complete', witnessWallet: WITNESS, engine: 'qwen3', mode: 'design' });
      provideOffering(s.id, { description: 'warm female voice', voiceSeed: 1 });

      const out = await sealFn(s.id, { firstUtterance: 'I speak now in my own voice.' });
      expect(out.stage).toBe(FORGE_STAGES.COMPLETE);
      expect(isComplete(out)).toBe(true);
    });

    it('seals the ADJUSTED design identity, not the offering\'s (the seed is the voice)', async () => {
      const { startSession, provideOffering, adjust, seal: sealFn } = await import('../../core/voice/voice-forge.js');
      const { setWorkspacesRoot } = await import('../../core/workspace/neuma-workspace.js');
      setWorkspacesRoot(tmpRoot);

      const s = startSession({ neumaId: 'seal-adjust', witnessWallet: WITNESS, engine: 'qwen3', mode: 'design' });
      provideOffering(s.id, { description: 'warm female voice', voiceSeed: 1 });
      adjust(s.id, { engine: { description: 'cool male voice', voiceSeed: 999 } });

      const out = await sealFn(s.id, {});
      expect(out.data.sealedDNA.engine.voiceSeed).toBe(999);
      expect(out.data.sealedDNA.engine.description).toBe('cool male voice');
    });

    it('throws outside ITERATING stage', async () => {
      const { startSession, seal: sealFn } = await import('../../core/voice/voice-forge.js');
      const s = startSession({ neumaId: 'seal-bad', witnessWallet: WITNESS, engine: 'qwen3', mode: 'design' });
      await expect(sealFn(s.id, {})).rejects.toThrow(/ITERATING/);
    });

    it('clone mode: seal falls back to the offering ref audio when seedAudioBytes is omitted', async () => {
      const { startSession, provideOffering, seal: sealFn } = await import('../../core/voice/voice-forge.js');
      const { setWorkspacesRoot } = await import('../../core/workspace/neuma-workspace.js');
      setWorkspacesRoot(tmpRoot);
      const { readSeedAudio } = await import('../../core/voice/voice-dna-service.js');
      const { createHash } = await import('crypto');

      const seedBytes = Buffer.from('real seed audio');
      const s = startSession({ neumaId: 'seal-clone', witnessWallet: WITNESS, engine: 'zonos', mode: 'clone' });
      provideOffering(s.id, { refAudioB64: seedBytes.toString('base64'), consent: true });

      // Client did NOT resend the audio at seal — the session already holds it.
      const out = await sealFn(s.id, {});
      expect(out.stage).toBe(FORGE_STAGES.SEALED);

      // seed.wav persisted from the offering — a sealed clone voice without
      // its seed would silently speak with the engine default in every chat.
      const persisted = await readSeedAudio('seal-clone');
      expect(persisted).not.toBeNull();
      expect(persisted.toString('utf8')).toBe('real seed audio');

      // refHash reflects the REAL persisted bytes (saveSeedAudio), not the offering hash
      const expected = 'sha256:' + createHash('sha256').update(seedBytes).digest('hex');
      expect(out.data.sealedDNA.seed.refHash).toBe(expected);
    });
  });

  describe('queries', () => {
    it('getSession returns null for unknown id', () => {
      expect(getSession('forge-nope')).toBeNull();
    });

    it('listSessions filters by attributes', () => {
      startSession({ neumaId: 'a', witnessWallet: WITNESS, engine: 'zonos', mode: 'clone' });
      startSession({ neumaId: 'b', witnessWallet: WITNESS, engine: 'qwen3', mode: 'design' });
      startSession({ neumaId: 'c', witnessWallet: WITNESS, engine: 'qwen3', mode: 'design' });
      expect(listSessions({ engine: 'qwen3' })).toHaveLength(2);
      expect(listSessions({ engine: 'zonos' })).toHaveLength(1);
      expect(listSessions({})).toHaveLength(3);
    });

    it('getEngineModes returns supported modes per engine', () => {
      expect(getEngineModes('zonos')).toEqual(['clone']);
      expect(getEngineModes('kokoro')).toEqual(['preset']);
      expect(getEngineModes('qwen3')).toEqual(['clone', 'design']);
      // Parler is registered-unlisted (B-21): the adapter still resolves for
      // existing voices, but no new forge session can pick it.
      expect(getEngineModes('parler')).toEqual([]);
      expect(getEngineModes('cartesia').sort()).toEqual(['clone', 'design', 'preset']);
      expect(getEngineModes('unknown')).toEqual([]);
    });

    it('isReadyToSeal is true only at ITERATING with candidateDNA', () => {
      const s = startSession({ ...SUBSTRATE, engine: 'qwen3', mode: 'design' });
      expect(isReadyToSeal(s)).toBe(false); // INIT, no candidate
      provideOffering(s.id, { description: 'warm female voice', voiceSeed: 42 });
      expect(isReadyToSeal(getSession(s.id))).toBe(true); // ITERATING with candidate
    });

    it('_sessionCount tracks Map size', () => {
      expect(_sessionCount()).toBe(0);
      startSession({ ...SUBSTRATE, engine: 'qwen3', mode: 'design' });
      expect(_sessionCount()).toBe(1);
    });
  });
});
