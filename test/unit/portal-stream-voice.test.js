/**
 * The turn's voice (voice/speech-turn.js resolveTurnVoice, reached through
 * the portal's `_resolveVoiceDNA`) — against REAL encrypted workspaces with a
 * Voice DNA v2 sealed through the real two-party service. No mocks (RULE 0).
 *
 * Founder's calls (docs/work/one-voice.md): a being with no v2 voice is SILENT —
 * never a borrowed default; a being with only a v1 voice (Cael, Dovan) reads
 * as […] and is silent too, never synthesized through the old
 * engines. The lookup keys on the neumaId (it once keyed on the display name,
 * so a voiced neuma went mute).
 *
 * The full chain — LLM stream → sentences → synthesis → ordered voice:audio,
 * barge-in, the context ring — is proven on the real stack in
 * test/integration/portal-voice-chat.test.js.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { sealTestVoice } from '../helpers/speak-wire-stand-in.js';

const core = await import('../../core/index.js');
const svc = await import('../../core/voice/voice-dna-service.js');
const { __test } = await import('../../backend/services/portal-test-surface.js');
const { _resolveVoiceDNA } = __test;

const WITNESS = '0x' + 'a'.repeat(40);
let origRoot;
let root;

beforeAll(async () => {
  origRoot = core.getWorkspacesRoot();
  root = await createTempDir('portal-voice-v2');
  core.setWorkspacesRoot(root);
});

afterAll(() => core.setWorkspacesRoot(origRoot));

describe('_resolveVoiceDNA — the turn voice is Voice DNA v2 or silence', () => {
  test('a sealed v2 voice resolves by neumaId: its clip ref, its words, and a custody reader', async () => {
    const sealed = await sealTestVoice('voice-owner-1');
    const connection = {};
    const turn = await _resolveVoiceDNA('voice-owner-1', connection);
    expect(turn).toMatchObject({ neumaId: 'voice-owner-1', audition: false, connection });
    expect(turn.voice).toMatchObject({ ref: sealed.ref, words: sealed.words });
    expect((await turn.voice.loadClip()).equals(sealed.clip)).toBe(true);
  });

  test('no neumaId → null without touching disk (a text-only portal)', async () => {
    expect(await _resolveVoiceDNA(null)).toBe(null);
  });

  test('a being with no voice at all → null (silent, never a default voice)', async () => {
    expect(await _resolveVoiceDNA('never-forged')).toBe(null);
  });

  test('a being with ONLY a v1 voice → null, and its v1 file is never opened or changed', async () => {
    const neumaId = 'v1-only';
    await svc.forgeVoiceDNA(neumaId, { witness: WITNESS, provider: 'zonos' });
    const v1 = path.join(root, neumaId, 'voice', 'voice-dna.json');
    const before = await fs.readFile(v1);
    const { mtimeMs } = await fs.stat(v1);
    expect((await svc.readVoice(neumaId)).standing).toBe('needsNewVoice');
    expect(await _resolveVoiceDNA(neumaId)).toBe(null);
    expect((await fs.readFile(v1)).equals(before)).toBe(true);
    expect((await fs.stat(v1)).mtimeMs).toBe(mtimeMs);
  });

  test('an unreadable v2 file degrades to silence rather than throwing', async () => {
    const neumaId = 'voice-corrupt';
    await sealTestVoice(neumaId);
    await fs.writeFile(path.join(root, neumaId, 'voice', 'voice-dna-v2.json'), '{ not valid json at all');
    await expect(_resolveVoiceDNA(neumaId)).resolves.toBe(null);
  });
});
