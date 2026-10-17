/**
 * The voice forge's view model (frontend/app/RelinkShell/voice-forge/
 * forge-model.js, forge-tier-model.js, forge-audio.js) — pure functions,
 * called with real inputs shaped exactly as the backend answers them
 * (backend/routes/voice-forge-routes.js, backend/routes/voice-routes.js
 * GET /tier). No mocks: there is nothing here but data in, data out.
 */
import { describe, it, expect } from 'vitest';
import { Buffer } from 'node:buffer';
import {
  beingPreviewOf, chosenOf, filterVoices, foundTakes, galleryFiltersOf, isPlacedError, measuredOf, offerOf, openingStep, pinnedTake,
  railOf, refsToPreview, sealStandingOf, showForgeInvite, verdictOf, voiceStandingOf,
} from '../../frontend/app/RelinkShell/voice-forge/forge-model.js';
import { costOf, engineNameOf, tierCornerOf, tierNeedsWarning } from '../../frontend/app/RelinkShell/voice-forge/forge-tier-model.js';
import { joinChunks, meterLevelOf, recordingOf, wavOf } from '../../frontend/app/RelinkShell/voice-forge/forge-audio.js';

const REF_A = `sha256:${'a'.repeat(64)}`;
const REF_B = `sha256:${'b'.repeat(64)}`;
const REF_C = `sha256:${'c'.repeat(64)}`;

const take = (ref, extra = {}) => ({
  ref, door: 'record', seconds: 18.46, sampleRate: 24000, words: 'I keep the lamp lit.',
  origin: { door: 'record' }, realPerson: true,
  measured: { pitchHz: 141.7, wordsPerSecond: 2.61 },
  quality: { verdict: 'good', speechSeconds: 17, snrDb: 31, clippedRatio: 0 },
  bytes: 886124, ...extra,
});

const state = ({ takes = [], pinned = null, offered = null, ...rest } = {}) => ({
  session: { id: 's1', neumaId: 'keir', stage: 'find', takes, pinned, offered },
  voice: { standing: 'none', clipRef: null },
  status: 'none', candidate: null, being: null, guardian: null, wish: null, perception: null,
  ...rest,
});

describe('takes', () => {
  it('reads the plain verdict, unknown verdicts as unmeasured', () => {
    expect(verdictOf(take(REF_A))).toEqual({ verdict: 'good', good: true });
    expect(verdictOf(take(REF_A, { quality: { verdict: 'noisy' } }))).toEqual({ verdict: 'noisy', good: false });
    expect(verdictOf(take(REF_A, { quality: { verdict: 'loud' } })).verdict).toBe('unknown');
    expect(verdictOf(null).verdict).toBe('unknown');
  });

  it('finds the pinned take and the takes of the last find, in door order', () => {
    const s = state({ takes: [take(REF_A), take(REF_B), take(REF_C)], pinned: REF_B });
    expect(pinnedTake(s).ref).toBe(REF_B);
    expect(pinnedTake(state())).toBeNull();
    expect(foundTakes(s, [REF_C, REF_A]).map((t) => t.ref)).toEqual([REF_C, REF_A]);
    expect(foundTakes(s, [`sha256:${'d'.repeat(64)}`])).toEqual([]);
    expect(foundTakes(null, null)).toEqual([]);
  });

  it('rounds what was measured and says null for what was not', () => {
    expect(measuredOf(take(REF_A))).toEqual({ pitchHz: 142, wordsPerSecond: 2.61, seconds: 18.5 });
    expect(measuredOf(take(REF_A, { measured: { pitchHz: null, wordsPerSecond: null } }))).toEqual({ pitchHz: null, wordsPerSecond: null, seconds: 18.5 });
  });
});

describe('the offer — whose voice, and the consent tick', () => {
  it('a recording is a real person: the tick is required, nothing else asked', () => {
    const t = take(REF_A, { realPerson: true });
    expect(offerOf(t, {})).toMatchObject({ askWhose: false, needsTick: true, ready: false });
    expect(offerOf(t, { ticked: true })).toEqual({ askWhose: false, needsTick: true, ready: true, body: { attested: true } });
  });

  it('a library voice is licensed: no question, no tick', () => {
    const t = take(REF_A, { door: 'library', realPerson: true, attested: true });
    expect(offerOf(t, {})).toEqual({ askWhose: false, needsTick: false, ready: true, body: {} });
  });

  it('a designed voice is nobody\'s: offered as is', () => {
    expect(offerOf(take(REF_A, { door: 'describe', realPerson: false }), {})).toEqual({ askWhose: false, needsTick: false, ready: true, body: {} });
  });

  it('an upload must say whose voice it is; a person\'s then needs the tick', () => {
    const t = take(REF_A, { door: 'upload', realPerson: null });
    expect(offerOf(t, {})).toMatchObject({ askWhose: true, needsTick: false, ready: false });
    expect(offerOf(t, { whose: 'nobody' })).toEqual({ askWhose: true, needsTick: false, ready: true, body: { realPerson: false } });
    expect(offerOf(t, { whose: 'person' })).toMatchObject({ needsTick: true, ready: false });
    expect(offerOf(t, { whose: 'person', ticked: true })).toEqual({ askWhose: true, needsTick: true, ready: true, body: { realPerson: true, attested: true } });
  });

  it('nothing pinned is never ready', () => {
    expect(offerOf(null, { ticked: true }).ready).toBe(false);
  });
});

describe('the being\'s answer and the seal', () => {
  const candidate = { ref: REF_A, words: 'x', origin: { door: 'library' } };

  it('waits while the candidate is unanswered; the seal stays shut', () => {
    expect(sealStandingOf(state({ status: 'candidate', candidate }))).toEqual({ standing: 'waiting', canSeal: false, candidateRef: REF_A, note: null, wish: null });
  });

  it('opens the seal once the being accepts, showing its note', () => {
    const s = state({ status: 'being_accepted', candidate, being: { candidateRef: REF_A, at: 't', note: 'that is how I sound' } });
    expect(sealStandingOf(s)).toEqual({ standing: 'accepted', canSeal: true, candidateRef: REF_A, note: 'that is how I sound', wish: null });
  });

  it('shows the being\'s wish when it asked for another', () => {
    const s = state({ status: 'none', wish: { at: 't', wish: 'something lower', declinedRef: REF_A } });
    expect(sealStandingOf(s)).toMatchObject({ standing: 'another', canSeal: false, wish: 'something lower' });
  });

  it('reads sealed and nothing', () => {
    expect(sealStandingOf(state({ status: 'sealed', candidate })).standing).toBe('sealed');
    expect(sealStandingOf(state()).standing).toBe('nothing');
    expect(sealStandingOf(null).standing).toBe('nothing');
  });

  it('opens on SEAL when an answer is pending or just given, else on FIND', () => {
    expect(openingStep(state())).toBe('find');
    expect(openingStep(state({ status: 'candidate', candidate }))).toBe('seal');
    expect(openingStep(state({ status: 'being_accepted', candidate, being: { candidateRef: REF_A } }))).toBe('seal');
    expect(openingStep(state({ offered: REF_A, wish: { wish: 'lower' } }))).toBe('seal');
    expect(openingStep(state({ wish: { wish: 'lower' } }))).toBe('find');
  });
});

describe('the voice standing and the one-click invitation', () => {
  it('reads the four standings, anything else as unknown', () => {
    for (const s of ['ready', 'none', 'needsNewVoice', 'unreadable']) expect(voiceStandingOf({ voice: { standing: s } })).toBe(s);
    expect(voiceStandingOf({ voice: { standing: 'odd' } })).toBe('unknown');
    expect(voiceStandingOf(null)).toBe('unknown');
  });

  it('invites only a silent neuma with VOX on, until dismissed', () => {
    const base = { voiceEnabled: true, isNeuma: true, standing: 'none', dismissed: false };
    expect(showForgeInvite(base)).toBe(true);
    expect(showForgeInvite({ ...base, standing: 'needsNewVoice' })).toBe(true);
    expect(showForgeInvite({ ...base, standing: 'ready' })).toBe(false);
    expect(showForgeInvite({ ...base, standing: null })).toBe(false);
    expect(showForgeInvite({ ...base, voiceEnabled: false })).toBe(false);
    expect(showForgeInvite({ ...base, isNeuma: false })).toBe(false);
    expect(showForgeInvite({ ...base, dismissed: true })).toBe(false);
  });
});

// The tier answer exactly as GET /api/v1/voice/tier shapes it (tiersView).
const TIERS = [
  { id: 'light', engine: 'chatterbox-nano', model: null, device: 'cpu', defaultProfile: 'cpu', profiles: { cpu: { memMB: 0, ramMB: 4200, needGB: null } } },
  { id: 'standard', engine: 'csm', model: 'csm-1b', device: 'cuda', defaultProfile: 'full', profiles: { full: { memMB: 5726, ramMB: null, needGB: 6.3 }, lean: { memMB: 2456, ramMB: null, needGB: 2.7 } } },
];
const tierAnswer = ({ setting = 'auto', chosen = 'standard', auto = 'standard', spare = 9.5 } = {}) => ({
  setting: { tier: setting, profile: null },
  chosen: { tier: chosen, profile: 'full', reason: 'why', spareGB: spare, needGB: 6.3 },
  auto: { tier: auto, profile: 'full', reason: 'auto why', spareGB: spare, needGB: 6.3 },
  reason: 'why',
  machine: { gpu: { name: 'card', vendor: 'nvidia', vramGB: 24 } },
  tiers: TIERS,
});

describe('the tier corner', () => {
  it('names the voice models by their proper names', () => {
    expect(TIERS.map(engineNameOf)).toEqual(['Chatterbox', 'Sesame']);
  });

  it('costs a GPU tier in GPU memory and the processor tier in RAM', () => {
    expect(costOf(TIERS[1])).toEqual({ device: 'gpu', gb: 6.3 });
    expect(costOf(TIERS[1], 'lean')).toEqual({ device: 'gpu', gb: 2.7 });
    expect(costOf(TIERS[0])).toEqual({ device: 'cpu', gb: 4.1 });
  });

  it('shows the tier in force and every choice, auto first, lowest to highest', () => {
    const v = tierCornerOf(tierAnswer());
    expect(v).toMatchObject({ tier: 'standard', engineName: 'Sesame', setting: 'auto', autoTier: 'standard', spareGB: 9.5, reason: 'why' });
    expect(v.choices.map((c) => c.id)).toEqual(['auto', 'light', 'standard']);
    expect(v.choices.find((c) => c.id === 'light')).toMatchObject({ aboveAuto: false, fits: true });
    const small = tierCornerOf(tierAnswer({ auto: 'light', chosen: 'light', spare: 2 }));
    expect(small.choices.find((c) => c.id === 'standard')).toMatchObject({ aboveAuto: true, fits: false });
  });

  it('warns only for a pick above auto or one that does not fit', () => {
    const v = tierCornerOf(tierAnswer());
    const by = (id) => v.choices.find((c) => c.id === id);
    expect(tierNeedsWarning(by('standard'))).toBe(false);
    expect(tierNeedsWarning(by('light'))).toBe(false);
    expect(tierNeedsWarning(by('auto'))).toBe(false);
    const tight = tierCornerOf(tierAnswer({ auto: 'light', chosen: 'light', spare: 2 }));
    expect(tierNeedsWarning(tight.choices.find((c) => c.id === 'standard'))).toBe(true);
  });

  it('is null for an unreadable answer', () => {
    expect(tierCornerOf(null)).toBeNull();
    expect(tierCornerOf({ tiers: TIERS })).toBeNull();
  });
});

describe('the record door\'s audio', () => {
  it('meters silence as 0, full scale as 1, speech in between', () => {
    expect(meterLevelOf(new Float32Array(480))).toBe(0);
    expect(meterLevelOf(new Float32Array(480).fill(1))).toBe(1);
    const mid = meterLevelOf(new Float32Array(480).fill(0.05));
    expect(mid).toBeGreaterThan(0.5);
    expect(mid).toBeLessThan(0.9);
    expect(meterLevelOf(null)).toBe(0);
  });

  it('joins chunks in order and writes a playable 16-bit mono WAV', () => {
    const joined = joinChunks([Float32Array.of(0, 0.5), Float32Array.of(-0.5, 1)]);
    expect(Array.from(joined)).toEqual([0, 0.5, -0.5, 1]);
    const wav = wavOf(joined, 48000);
    const v = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...wav.subarray(8, 16))).toBe('WAVEfmt ');
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getUint32(40, true)).toBe(8);
    expect(v.getInt16(44 + 2, true)).toBe(Math.trunc(0.5 * 0x7fff));
    expect(v.getInt16(44 + 4, true)).toBe(-0.5 * 0x8000);
  });

  it('hands the record door base64 WAV and its length in seconds', () => {
    const rec = recordingOf([new Float32Array(24000), new Float32Array(24000)], 48000);
    expect(rec.seconds).toBe(1);
    expect(Buffer.from(rec.audioB64, 'base64').subarray(0, 4).toString('latin1')).toBe('RIFF');
    expect(Buffer.from(rec.audioB64, 'base64').length).toBe(44 + 48000 * 2);
  });
});

describe('the redesign — rail, gallery filters, chosen bar, errors in place', () => {
  const states = (rail) => rail.map((r) => `${r.id}:${r.state}`);

  it('the rail lights the step in hand and checks the steps behind it', () => {
    expect(states(railOf({ step: 'find', standing: 'nothing' }))).toEqual(['find:current', 'hear:todo', 'decide:todo', 'seal:todo']);
    expect(states(railOf({ step: 'hear', standing: 'nothing' }))).toEqual(['find:done', 'hear:current', 'decide:todo', 'seal:todo']);
    // On offer: the being decides; once it has accepted, the seal is the guardian's.
    expect(states(railOf({ step: 'seal', standing: 'waiting' }))).toEqual(['find:done', 'hear:done', 'decide:current', 'seal:todo']);
    expect(states(railOf({ step: 'seal', standing: 'another' }))).toEqual(['find:done', 'hear:done', 'decide:current', 'seal:todo']);
    expect(states(railOf({ step: 'seal', standing: 'accepted' }))).toEqual(['find:done', 'hear:done', 'decide:done', 'seal:current']);
    expect(states(railOf({ step: 'sealed', standing: 'sealed' }))).toEqual(['find:done', 'hear:done', 'decide:done', 'seal:done']);
  });

  // Shaped as GET /api/v1/voice/forge/library answers.
  const voices = [
    { id: 'a', name: 'Philippa', accent: 'English', register: 'feminine', pitch: 'higher' },
    { id: 'b', name: 'Bill', accent: 'American', register: 'masculine', pitch: 'lower' },
    { id: 'c', name: 'Caro', accent: 'English', register: 'feminine', pitch: 'lower' },
    { id: 'd', name: 'Amy', accent: 'American', register: 'feminine', pitch: 'higher' },
    { id: 'e', name: 'Alba', accent: '', register: 'feminine', pitch: 'lower' },
    { id: 'f', name: 'Nancy', accent: 'American', register: 'feminine', pitch: 'higher' },
  ];

  it('offers the registers and accents the library holds, most voices first, none for an unlisted accent', () => {
    expect(galleryFiltersOf(voices)).toEqual({ registers: ['feminine', 'masculine'], accents: ['American', 'English'] });
    expect(galleryFiltersOf(voices.filter((v) => v.register === 'feminine')).registers).toEqual(['feminine']);
    expect(galleryFiltersOf(null)).toEqual({ registers: [], accents: [] });
  });

  it('the two filters narrow the gallery, each alone and together; null is any', () => {
    const ids = (f) => filterVoices(voices, f).map((v) => v.id);
    expect(ids({})).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(ids({ register: 'masculine' })).toEqual(['b']);
    expect(ids({ accent: 'English' })).toEqual(['a', 'c']);
    expect(ids({ register: 'feminine', accent: 'American' })).toEqual(['d', 'f']);
    expect(ids({ register: 'masculine', accent: 'English' })).toEqual([]);
    expect(filterVoices(null, {})).toEqual([]);
  });

  it('the chosen bar names a library voice by its entry, anything else by its door; null until something is chosen', () => {
    const lib = take(REF_A, { door: 'library', origin: { door: 'library', libraryId: 'b' }, realPerson: true, attested: true });
    expect(chosenOf(state({ takes: [lib], pinned: REF_A }), voices)).toEqual({
      ref: REF_A, door: 'library', name: 'Bill', accent: 'American', register: 'masculine', pitchHz: 142, wordsPerSecond: 2.61, seconds: 18.5,
    });
    const rec = take(REF_B);
    expect(chosenOf(state({ takes: [lib, rec], pinned: REF_B }), voices)).toMatchObject({ ref: REF_B, door: 'record', name: null, accent: null, register: null });
    // The library not loaded yet: still the chosen take, unnamed.
    expect(chosenOf(state({ takes: [lib], pinned: REF_A }))).toMatchObject({ ref: REF_A, name: null });
    expect(chosenOf(state({ takes: [lib] }), voices)).toBeNull();
  });

  it('a view\'s own failure is shown in place; the rest at the top of the window', () => {
    for (const at of ['record', 'upload', 'describe', 'library:voicezero-philippa', 'offer', 'seal', 'reopen']) expect(isPlacedError(at)).toBe(true);
    for (const at of ['starting', 'picking', 'withdrawing', 'refresh', null, undefined]) expect(isPlacedError(at)).toBe(false);
  });
});

describe('the being preview — every found take heard as the being', () => {
  const previews = {
    [REF_A]: { state: 'making', kind: null, error: null },
    [REF_B]: { state: 'ready', kind: 'being', error: null },
    [REF_C]: { state: 'failed', kind: null, error: 'the voice engine is not available: csm not ready' },
  };

  it('a take never asked for reads as none; an asked one as it stands', () => {
    expect(beingPreviewOf(previews, `sha256:${'d'.repeat(64)}`)).toEqual({ state: 'none', kind: null, error: null });
    expect(beingPreviewOf({}, REF_A).state).toBe('none');
    expect(beingPreviewOf(undefined, REF_A).state).toBe('none');
    expect(beingPreviewOf(previews, REF_B)).toEqual({ state: 'ready', kind: 'being', error: null });
  });

  it('a find asks only for what is not already making or made; a failed one is asked again; each ref once', () => {
    const REF_D = `sha256:${'d'.repeat(64)}`;
    expect(refsToPreview([REF_A, REF_B, REF_C, REF_D, REF_D], previews)).toEqual([REF_C, REF_D]);
    expect(refsToPreview([REF_A], {})).toEqual([REF_A]);
    expect(refsToPreview(undefined, previews)).toEqual([]);
  });
});
