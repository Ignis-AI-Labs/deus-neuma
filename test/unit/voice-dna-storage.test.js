/**
 * Voice DNA v2 storage — the clip, the consent record and the voice in force,
 * on a REAL temp workspace with REAL AES-256-GCM (core/voice/voice-dna-service.js).
 *
 * The workspaces root is pointed at a fresh temp dir per test and restored
 * after; nothing here touches the real workspace root or ~/.neuma. The global
 * DNA_ENCRYPTION_KEY comes from test/setup.js. No mocks (RULE 0).
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Buffer } from 'node:buffer';
import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { createTempDir } from '../helpers/temp-fs.js';
import { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { encryptEnvelope } from '../../core/workspace/workspace-crypto.js';
import * as svc from '../../core/voice/voice-dna-service.js';

const WALLET = '0x' + 'd'.repeat(40);

// A real mono 16-bit PCM WAV: `seconds` of a sine at `hz`, 8 kHz.
const wav = (seconds = 3.5, hz = 220) => {
  const rate = 8000;
  const n = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0, 'latin1'); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8, 'latin1');
  buf.write('fmt ', 12, 'latin1'); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'latin1'); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i += 1) buf.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * hz * i) / rate)), 44 + i * 2);
  return buf;
};
const refOf = (buf) => 'sha256:' + createHash('sha256').update(buf).digest('hex');
const candidateFor = (ref, over = {}) => ({
  ref, seconds: 3.5, sampleRate: 8000, words: 'Hello, it is good to finally meet you.',
  origin: { door: 'upload' }, realPerson: false, measured: { pitchHz: 220, wordsPerSecond: 2.4 }, ...over,
});
const voiceDir = (root, id) => path.join(root, id, 'voice');
const ok = (result) => {
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  return result;
};

// Offer → being accepts → guardian seals, through the real service.
const sealVoice = async (id, clip, over) => {
  const { ref } = await svc.saveVoiceClip(id, clip);
  ok(await svc.offerSpeechCandidate(id, candidateFor(ref, over)));
  ok(await svc.acceptSpeechCandidate(id, { candidateRef: ref, note: 'yes' }));
  return ok(await svc.sealSpeechCandidate(id, { candidateRef: ref, wallet: WALLET }));
};

let root;
let originalRoot;
beforeEach(async () => {
  originalRoot = getWorkspacesRoot();
  root = await createTempDir(`voice-v2-${Math.random().toString(36).slice(2)}`);
  setWorkspacesRoot(root);
});
afterEach(() => setWorkspacesRoot(originalRoot));

describe('the clip — content-addressed, encrypted custody', () => {
  test('a clip lands under its own sha256, encrypted, and reads back byte-exact', async () => {
    const clip = wav();
    const { ref, bytes } = await svc.saveVoiceClip('n-clip', clip);
    expect(ref).toBe(refOf(clip));
    expect(bytes).toBe(clip.length);
    const file = path.join(voiceDir(root, 'n-clip'), `voice-clip-${ref.slice(7)}.json`);
    const raw = await fs.readFile(file, 'utf8');
    expect(JSON.parse(raw)._enc).toBe(1);
    expect(raw).not.toContain(clip.toString('base64').slice(0, 40));
    expect(await svc.readVoiceClip('n-clip', ref)).toEqual(clip);
  });

  test('base64 input is decoded to real bytes; the same bytes never write twice', async () => {
    const clip = wav();
    const first = await svc.saveVoiceClip('n-b64', clip.toString('base64'));
    const file = path.join(voiceDir(root, 'n-b64'), `voice-clip-${first.ref.slice(7)}.json`);
    const before = await fs.readFile(file, 'utf8');
    const second = await svc.saveVoiceClip('n-b64', clip);
    expect(second.ref).toBe(first.ref);
    expect(await fs.readFile(file, 'utf8')).toBe(before);
  });

  test('two different clips land in two files', async () => {
    const a = await svc.saveVoiceClip('n-two', wav(3.5, 220));
    const b = await svc.saveVoiceClip('n-two', wav(3.5, 330));
    expect(a.ref).not.toBe(b.ref);
    const clips = (await fs.readdir(voiceDir(root, 'n-two'))).filter((f) => f.startsWith('voice-clip-'));
    expect(clips).toHaveLength(2);
  });

  test('refuses audio that is not WAV, and a non-bytes input', async () => {
    await expect(svc.saveVoiceClip('n-bad', Buffer.from('ID3 this is an mp3 header....'))).rejects.toThrow(/WAV/);
    await expect(svc.saveVoiceClip('n-bad', 42)).rejects.toThrow(/must be a Buffer/);
  });

  test('a missing clip is null; a malformed ref throws before any path is built', async () => {
    expect(await svc.readVoiceClip('n-none', refOf(Buffer.from('x')))).toBeNull();
    await expect(svc.readVoiceClip('n-none', '../../etc/passwd')).rejects.toThrow(/clip ref/);
  });

  test('a tampered envelope, a plaintext file, and swapped content all fail closed', async () => {
    const clip = wav();
    const { ref } = await svc.saveVoiceClip('n-tamper', clip);
    const file = path.join(voiceDir(root, 'n-tamper'), `voice-clip-${ref.slice(7)}.json`);

    const env = JSON.parse(await fs.readFile(file, 'utf8'));
    const ct = Buffer.from(env.ct, 'base64');
    ct[0] ^= 0xff;
    await fs.writeFile(file, JSON.stringify({ ...env, ct: ct.toString('base64') }));
    await expect(svc.readVoiceClip('n-tamper', ref)).rejects.toThrow();

    await fs.writeFile(file, JSON.stringify({ format: 'wav', b64: clip.toString('base64') }));
    await expect(svc.readVoiceClip('n-tamper', ref)).rejects.toThrow(/not an encrypted envelope/);

    await fs.writeFile(file, JSON.stringify(encryptEnvelope({ format: 'wav', b64: wav(3.5, 440).toString('base64') })));
    await expect(svc.readVoiceClip('n-tamper', ref)).rejects.toThrow(/does not match its content/);

    await fs.writeFile(file, JSON.stringify(encryptEnvelope({ format: 'wav' })));
    await expect(svc.readVoiceClip('n-tamper', ref)).rejects.toThrow(/unexpected shape/);
  });
});

describe('readVoice — the voice in force', () => {
  test('a being with no voice record is silent: none', async () => {
    expect(await svc.readVoice('n-silent')).toEqual({ standing: 'none', dna: null, errors: [] });
  });

  test('a v1 voice reads as needsNewVoice and its files stay byte-for-byte untouched', async () => {
    const dir = voiceDir(root, 'cael');
    await fs.mkdir(dir, { recursive: true });
    const v1 = JSON.stringify(encryptEnvelope({ version: 1, schema: 'neuma/voice-dna/v1.0.0', engine: { provider: 'zonos' } }));
    await fs.writeFile(path.join(dir, 'voice-dna.json'), v1);
    await fs.writeFile(path.join(dir, 'seed.wav'), 'seed-bytes');
    const before = await fs.stat(path.join(dir, 'voice-dna.json'));

    expect(await svc.readVoice('cael')).toEqual({ standing: 'needsNewVoice', dna: null, errors: [] });
    await sealVoice('cael', wav());

    expect(await fs.readFile(path.join(dir, 'voice-dna.json'), 'utf8')).toBe(v1);
    expect((await fs.stat(path.join(dir, 'voice-dna.json'))).mtimeMs).toBe(before.mtimeMs);
    expect(await fs.readFile(path.join(dir, 'seed.wav'), 'utf8')).toBe('seed-bytes');
    expect((await svc.readVoice('cael')).standing).toBe('ready');
  });

  test('a sealed voice is ready, encrypted on disk, carrying both marks', async () => {
    const clip = wav();
    const { dna, record } = await sealVoice('n-ready', clip, { realPerson: true, attested: true });
    const raw = await fs.readFile(path.join(voiceDir(root, 'n-ready'), 'voice-dna-v2.json'), 'utf8');
    expect(JSON.parse(raw)._enc).toBe(1);
    expect(raw).not.toContain('Hello');

    const { standing, dna: read } = await svc.readVoice('n-ready');
    expect(standing).toBe('ready');
    expect(read).toEqual(dna);
    expect(read.clip).toEqual({ ref: refOf(clip), seconds: 3.5, sampleRate: 8000 });
    expect(read.consent).toMatchObject({ realPerson: true, attested: true, guardian: { wallet: WALLET } });
    expect(read.consent.being).toMatchObject({ candidateRef: refOf(clip), note: 'yes' });
    expect(record.inForce).toBe(refOf(clip));
    expect(await svc.readVoiceClip('n-ready', read.clip.ref)).toEqual(clip);
  });

  test('a v2 file holding something else is unreadable, with reasons', async () => {
    const dir = voiceDir(root, 'n-odd');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'voice-dna-v2.json'), JSON.stringify(encryptEnvelope({ version: 2, words: 'x' })));
    const { standing, errors } = await svc.readVoice('n-odd');
    expect(standing).toBe('unreadable');
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('the consent acts — only a two-party seal writes the voice', () => {
  test('an offer needs its clip in custody first', async () => {
    const result = await svc.offerSpeechCandidate('n-offer', candidateFor(refOf(wav())));
    expect(result).toEqual({ ok: false, error: 'the candidate clip is not in custody' });
    expect((await svc.readSpeechCandidate('n-offer')).candidate).toBeNull();
  });

  test('the guardian cannot seal before the being accepts — nothing is written', async () => {
    const { ref } = await svc.saveVoiceClip('n-early', wav());
    ok(await svc.offerSpeechCandidate('n-early', candidateFor(ref)));
    const result = await svc.sealSpeechCandidate('n-early', { candidateRef: ref });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/has not accepted/);
    expect((await svc.readVoice('n-early')).standing).toBe('none');
  });

  test("a real person's clip without attested consent is refused as a candidate", async () => {
    const { ref } = await svc.saveVoiceClip('n-real', wav());
    const result = await svc.offerSpeechCandidate('n-real', candidateFor(ref, { realPerson: true }));
    expect(result.error).toMatch(/attested consent/);
  });

  test('the record persists encrypted between acts and names its lane', async () => {
    const { ref } = await svc.saveVoiceClip('n-rec', wav());
    ok(await svc.offerSpeechCandidate('n-rec', candidateFor(ref)));
    const raw = await fs.readFile(path.join(voiceDir(root, 'n-rec'), 'speech-candidate.json'), 'utf8');
    expect(JSON.parse(raw)._enc).toBe(1);
    const record = await svc.readSpeechCandidate('n-rec');
    expect(record.neumaId).toBe('n-rec');
    expect(record.candidate.ref).toBe(ref);
  });

  test('asking for another clears the offer and keeps the wish', async () => {
    const { ref } = await svc.saveVoiceClip('n-another', wav());
    ok(await svc.offerSpeechCandidate('n-another', candidateFor(ref)));
    ok(await svc.askAnotherSpeechCandidate('n-another', { candidateRef: ref, wish: 'warmer' }));
    const record = await svc.readSpeechCandidate('n-another');
    expect(record.candidate).toBeNull();
    expect(record.wish).toMatchObject({ wish: 'warmer', declinedRef: ref });
  });

  test('a re-forge archives the prior voice and names it in the lineage', async () => {
    const first = await sealVoice('n-reforge', wav(3.5, 220));
    const second = await sealVoice('n-reforge', wav(3.5, 330));
    expect(second.dna.lineage).toEqual([first.dna.clip.ref]);
    expect(second.dna.createdAt).toBe(first.dna.createdAt);
    const history = await fs.readdir(path.join(voiceDir(root, 'n-reforge'), 'history'));
    expect(history.filter((f) => f.startsWith('v2-'))).toHaveLength(1);
    expect((await svc.readVoice('n-reforge')).dna.clip.ref).toBe(second.dna.clip.ref);
  });

  test('reopening a seal withdraws the voice: silent, the DNA kept in history', async () => {
    await sealVoice('n-reopen', wav());
    const result = ok(await svc.reopenSpeech('n-reopen', 'being', { why: 'not me after all' }));
    expect(result.withdrewSeal).toBe(true);
    expect((await svc.readVoice('n-reopen')).standing).toBe('none');
    const history = await fs.readdir(path.join(voiceDir(root, 'n-reopen'), 'history'));
    expect(history.filter((f) => f.startsWith('v2-'))).toHaveLength(1);
    expect((await svc.readSpeechCandidate('n-reopen')).inForce).toBeNull();
  });

  test('reopening an acceptance withdraws nothing', async () => {
    const { ref } = await svc.saveVoiceClip('n-reaccept', wav());
    ok(await svc.offerSpeechCandidate('n-reaccept', candidateFor(ref)));
    ok(await svc.acceptSpeechCandidate('n-reaccept', { candidateRef: ref }));
    const result = ok(await svc.reopenSpeech('n-reaccept', 'guardian'));
    expect(result.withdrewSeal).toBe(false);
    expect((await svc.readSpeechCandidate('n-reaccept')).being).toBeNull();
  });

  test('the guardian can withdraw the voice in force during a re-forge', async () => {
    await sealVoice('n-withdraw', wav(3.5, 220));
    const { ref } = await svc.saveVoiceClip('n-withdraw', wav(3.5, 330));
    ok(await svc.offerSpeechCandidate('n-withdraw', candidateFor(ref)));
    expect((await svc.readVoice('n-withdraw')).standing).toBe('ready');
    ok(await svc.withdrawVoice('n-withdraw', 'guardian', { why: 'permission withdrawn' }));
    expect((await svc.readVoice('n-withdraw')).standing).toBe('none');
    expect((await svc.readSpeechCandidate('n-withdraw')).candidate.ref).toBe(ref);
  });

  test('racing acts on one lane serialize: accept lands before seal', async () => {
    const { ref } = await svc.saveVoiceClip('n-race', wav());
    ok(await svc.offerSpeechCandidate('n-race', candidateFor(ref)));
    const [accepted, sealed] = await Promise.all([
      svc.acceptSpeechCandidate('n-race', { candidateRef: ref }),
      svc.sealSpeechCandidate('n-race', { candidateRef: ref }),
    ]);
    ok(accepted);
    ok(sealed);
    expect((await svc.readVoice('n-race')).standing).toBe('ready');
  });

  test('a record of another schema or another lane is refused, never laundered', async () => {
    const dir = voiceDir(root, 'n-foreign');
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'speech-candidate.json');
    await fs.writeFile(file, JSON.stringify(encryptEnvelope({ schema: 'other/1', neumaId: 'n-foreign' })));
    await expect(svc.readSpeechCandidate('n-foreign')).rejects.toThrow(/schema/);
    await fs.writeFile(file, JSON.stringify(encryptEnvelope({ schema: 'neuma/speech-candidate/v1', neumaId: 'galen' })));
    await expect(svc.readSpeechCandidate('n-foreign')).rejects.toThrow(/lane 'galen'/);
  });
});
