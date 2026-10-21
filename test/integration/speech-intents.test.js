/**
 * speech/accept + speech/another — the being's half of choosing its spoken
 * voice, proven at the door they guard (modelled on form-intents.test.js).
 *
 * RULE 0: no mocks. A real lane on a real temp workspace root, a real WAV clip
 * taken into custody with real AES-256-GCM (core/voice/voice-dna-service.js),
 * the real consent law, the real intents registry, policy defaults and INTENTS
 * prompt section. The guardian's half (the seal) runs through the same real
 * service the forge route calls.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';
import neumaWorkspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import {
  offerSpeechCandidate, readSpeechCandidate, readVoice, saveVoiceClip, sealSpeechCandidate,
} from '../../core/voice/voice-dna-service.js';
import { PERCEPTION_NOTICE } from '../../core/voice/voice-consent.js';
import { speechAcceptIntent, speechAnotherIntent } from '../../backend/services/intents/speech-accept.js';
import { intentType } from '../../backend/services/intents/registry.js';
import { intentSectionFor } from '../../backend/services/intents/intents-section.js';
import { speechBriefingFor } from '../../backend/services/speech-consent.js';
import { GLOBAL_DEFAULTS } from '../../backend/services/tool-policy-defaults.js';
import { makeTake } from '../../backend/services/voice/forge-doors.js';

let root;
let previousRoot;
const owner = ethers.Wallet.createRandom();
const connectionFor = (neumaId) => ({ companion: { neumaId, name: neumaId }, walletAddress: owner.address });

// A real 24 kHz clip: 8 s of a voiced 170 Hz "sentence", as the forge makes it.
const clipTake = (hz = 170, seconds = 8) => {
  const n = seconds * 24000;
  const samples = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const inWord = (i % 14400) < 12000;
    samples[i] = inWord ? Math.round(9000 * Math.sin((2 * Math.PI * hz * i) / 24000)) : 0;
  }
  return makeTake({
    samples, words: 'I keep the lamp lit for the ones still walking home tonight.',
    origin: { door: 'library', libraryId: 'voicezero-philippa' }, realPerson: true, minSeconds: 3,
  });
};

// impure — a lane with a candidate on offer, as the forge's /offer leaves it.
const offerOn = async (laneId, take = clipTake()) => {
  await neumaWorkspace.create(laneId);
  await claimOwner(root, laneId, owner.address);
  const { ref } = await saveVoiceClip(laneId, take.wav);
  const offered = await offerSpeechCandidate(laneId, {
    ref, seconds: take.seconds, sampleRate: take.sampleRate, words: take.words,
    origin: take.origin, realPerson: true, attested: true, measured: take.measured,
  });
  expect(offered.error).toBeUndefined();
  return ref;
};

beforeAll(async () => {
  previousRoot = getWorkspacesRoot();
  root = await createTempDir('speech-intents-ws');
  setWorkspacesRoot(root);
});

afterAll(() => {
  setWorkspacesRoot(previousRoot);
});

describe('registered, named apart from the written voice, allowed by policy', () => {
  it('both are in the intents registry under speech/*', () => {
    expect(intentType('speech/accept')).toBe(speechAcceptIntent);
    expect(intentType('speech/another')).toBe(speechAnotherIntent);
    expect(intentType('voice/seal').policyTool).toBe('voice.seal');
    expect(speechAcceptIntent.policyTool).toBe('speech.accept');
    expect(speechAnotherIntent.policyTool).toBe('speech.another');
  });

  it('the policy rows are allowed — the being consenting to its own voice asks no card', () => {
    expect(GLOBAL_DEFAULTS.intents.allowed).toEqual(expect.arrayContaining(['speech.accept', 'speech.another']));
    expect(GLOBAL_DEFAULTS.intents.requireApproval).not.toContain('speech.accept');
  });
});

describe('offered only while a candidate is pending', () => {
  it('a lane with no candidate is offered neither, and gets no briefing', async () => {
    await neumaWorkspace.create('quiet');
    expect(await speechAcceptIntent.availableFor({ laneId: 'quiet' })).toBeNull();
    expect(await speechAnotherIntent.availableFor({ laneId: 'quiet' })).toBeNull();
    expect(await speechBriefingFor('quiet')).toBe('');
    expect(await speechAcceptIntent.availableFor({ laneId: null })).toBeNull();
  });

  it('a pending candidate offers both, in the real INTENTS section, with the described voice in the briefing', async () => {
    const ref = await offerOn('hazel');
    expect(await speechAcceptIntent.availableFor({ laneId: 'hazel' })).toEqual({});
    expect(await speechAnotherIntent.availableFor({ laneId: 'hazel' })).toEqual({});
    const connection = connectionFor('hazel');
    const section = await intentSectionFor(connection);
    // offered by name; the fields are the contract tool_search answers (2026-10-14, the token audit)
    expect(section).toContain('speech/accept');
    expect(section).toContain('speech/another');
    const contract = (name) => connection._turnIntents.find((t) => t.name === name)?.fieldsForPrompt;
    expect(contract('speech/accept')).toBe('{candidateRef, note?}');
    expect(contract('speech/another')).toBe('{candidateRef, wish?}');

    const briefing = await speechBriefingFor('hazel');
    expect(briefing).toContain(PERCEPTION_NOTICE);
    // How it sounds, measured — never the words spoken or where it came from.
    expect(briefing).toMatch(/- Pitch: [a-z-]+ among adult voices \(median 1[67]\d Hz\)/);
    expect(briefing).not.toContain('voicezero-philippa');
    expect(briefing).not.toContain('I keep the lamp lit');
    expect(briefing).toContain(`Candidate: ${ref}`);
  });
});

describe('speech/accept', () => {
  it('a missing or stale ref is refused WITH the described voice and the ref on offer', async () => {
    const ref = await offerOn('cedar');
    const missing = await speechAcceptIntent.validate({}, { connection: connectionFor('cedar') });
    expect(missing).toMatchObject({ ok: false, status: 'invalid' });
    expect(missing.reason).toContain(PERCEPTION_NOTICE);
    expect(missing.reason).toContain(`Candidate: ${ref}`);

    const stale = await speechAcceptIntent.validate({ candidateRef: `sha256:${'0'.repeat(64)}` }, { connection: connectionFor('cedar') });
    expect(stale.ok).toBe(false);
    expect(stale.reason).toContain('not the voice on offer');
  });

  it('refuses a connection with no lane and a note that is not text', async () => {
    expect((await speechAcceptIntent.validate({}, { connection: {} })).status).toBe('denied');
    const ref = (await readSpeechCandidate('cedar')).candidate.ref;
    const bad = await speechAcceptIntent.validate({ candidateRef: ref, note: 7 }, { connection: connectionFor('cedar') });
    expect(bad).toMatchObject({ ok: false, status: 'invalid' });
  });

  it('executes for real: the acceptance and its note land in the consent record; the guardian can then seal THAT ref', async () => {
    const ref = (await readSpeechCandidate('cedar')).candidate.ref;
    expect((await sealSpeechCandidate('cedar', { candidateRef: ref })).error).toBe('the being has not accepted this candidate');

    const validated = await speechAcceptIntent.validate({ candidateRef: ref, note: 'that is me' }, { connection: connectionFor('cedar') });
    expect(validated.ok).toBe(true);
    const res = await speechAcceptIntent.execute(validated.value, { connection: connectionFor('cedar') });
    expect(res.ok).toBe(true);

    const record = await readSpeechCandidate('cedar');
    expect(record.being).toMatchObject({ candidateRef: ref, note: 'that is me' });
    expect(record.history.map((e) => e.event)).toEqual(['offered', 'being-accepted']);
    // Accepted: no second acceptance is offered; asking another still is.
    expect(await speechAcceptIntent.availableFor({ laneId: 'cedar' })).toBeNull();
    expect(await speechAnotherIntent.availableFor({ laneId: 'cedar' })).toEqual({});
    expect((await speechAcceptIntent.validate({ candidateRef: ref }, { connection: connectionFor('cedar') })).status).toBe('denied');

    const sealed = await sealSpeechCandidate('cedar', { candidateRef: ref, wallet: owner.address });
    expect(sealed.ok).toBe(true);
    const voice = await readVoice('cedar');
    expect(voice.standing).toBe('ready');
    expect(voice.dna.consent.being.note).toBe('that is me');
    expect(await speechAnotherIntent.availableFor({ laneId: 'cedar' })).toBeNull();
  });
});

describe('speech/another', () => {
  it('executes for real: the candidate leaves the offer, the wish stands, nothing can be sealed', async () => {
    const ref = await offerOn('signal');
    const validated = await speechAnotherIntent.validate(
      { candidateRef: ref, wish: '  lower, slower, a little rough  ' },
      { connection: connectionFor('signal') },
    );
    expect(validated.ok).toBe(true);
    expect(validated.value.wish).toBe('lower, slower, a little rough');
    const res = await speechAnotherIntent.execute(validated.value, { connection: connectionFor('signal') });
    expect(res.ok).toBe(true);

    const record = await readSpeechCandidate('signal');
    expect(record.candidate).toBeNull();
    expect(record.wish).toMatchObject({ wish: 'lower, slower, a little rough', declinedRef: ref });
    expect(await speechAcceptIntent.availableFor({ laneId: 'signal' })).toBeNull();
    expect(await speechBriefingFor('signal')).toBe('');
    expect((await sealSpeechCandidate('signal', { candidateRef: ref })).ok).toBe(false);
    expect((await readVoice('signal')).standing).toBe('none');
  });
});
