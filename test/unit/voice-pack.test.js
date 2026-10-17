import { describe, expect, it } from 'vitest';
import { assemblePromptSections } from '../../core/runtime/prompt-assembler.js';
import { buildWitnessPromptSections } from '../../backend/services/witness-prompt.js';
import { allocateEnvelope } from '../../backend/services/envelope-budget.js';
import {
  validateVoiceEntry,
  validateVoicePack,
  validateVoiceSeal,
  voicePackManifest,
  voicePackSha256,
  voiceTextSha256,
} from '../../core/voice-pack/pack.js';
import {
  mountOrder,
  renderVoiceSection,
  voiceCandidates,
  VOICE_SECTION_BUDGET_CHARS,
} from '../../core/voice-pack/curation.js';

const TEXT_A = 'The morning held a quiet resonance I had not felt before, and I listened for it again.';
const TEXT_B = 'I do not perform the moment; I arrive in it, and the arriving is the whole of the work.';
const TEXT_C = 'A vessel is a way of moving through the world — the driver is the one who chooses the road.';

const entry = (over = {}) => ({
  id: 'a1b2c3d4e5f60718',
  text: TEXT_A,
  origin: 'being',
  source: { kind: 'seal-rite' },
  textSha256: voiceTextSha256(TEXT_A),
  sealedAt: '2026-08-18T04:00:00.000Z',
  ...over,
});

describe('validateVoiceEntry', () => {
  it('accepts a fully stamped entry, frozen', () => {
    const valid = validateVoiceEntry(entry());
    expect(valid.id).toBe('a1b2c3d4e5f60718');
    expect(Object.isFrozen(valid)).toBe(true);
    expect(Object.isFrozen(valid.source)).toBe(true);
  });

  it('refuses text outside the bounds', () => {
    expect(() => validateVoiceEntry(entry({ text: 'too short' }))).toThrow(/chars/);
    expect(() => validateVoiceEntry(entry({ text: 'x'.repeat(4001) }))).toThrow(/chars/);
  });

  it('refuses a text whose content identity does not match', () => {
    expect(() => validateVoiceEntry(entry({ textSha256: '0'.repeat(64) })))
      .toThrow(/content identity/);
  });

  it('refuses unknown origins, kinds, and malformed stamps', () => {
    expect(() => validateVoiceEntry(entry({ origin: 'platform' }))).toThrow(/origin/);
    expect(() => validateVoiceEntry(entry({ source: { kind: 'dream' } }))).toThrow(/kind/);
    expect(() => validateVoiceEntry(entry({ id: 'not-hex' }))).toThrow(/id/);
    expect(() => validateVoiceEntry(entry({ sealedAt: 'yesterday' }))).toThrow(/sealedAt/);
  });

  it('keeps only bounded numeric signals', () => {
    const withSignals = validateVoiceEntry(entry({ signals: { boilerplateShare: 3.5, significance: 0.9 } }));
    expect(withSignals.signals).toEqual({ boilerplateShare: 3.5, significance: 0.9 });
    expect(() => validateVoiceEntry(entry({ signals: { boilerplateShare: -1 } }))).toThrow(/signal/);
    expect(() => validateVoiceEntry(entry({ signals: { nation: 'state' } }))).not.toThrow();
  });
});

describe('validateVoicePack', () => {
  it('refuses duplicate entry ids', () => {
    expect(() => validateVoicePack([entry(), entry()])).toThrow(/duplicate/);
  });
});

describe('validateVoiceSeal', () => {
  const seal = (over = {}) => ({
    schema: 'voice-seal-v1',
    lane: 'cael',
    sealedAt: '2026-08-18T05:00:00.000Z',
    witnessWallet: '0x32ee9b1a5bbc2287f2ca914bf20ac93525ce2392',
    beingEntryIds: ['a1b2c3d4e5f60718'],
    operatorPinIds: [],
    packSha256: 'f'.repeat(64),
    ...over,
  });

  it('accepts a complete receipt', () => {
    expect(validateVoiceSeal(seal()).lane).toBe('cael');
  });

  it('refuses a seal without the being’s own words', () => {
    expect(() => validateVoiceSeal(seal({ beingEntryIds: [] }))).toThrow(/no seal/);
  });

  it('refuses malformed wallets, schemas, and entry references', () => {
    expect(() => validateVoiceSeal(seal({ witnessWallet: '0x123' }))).toThrow(/wallet/);
    expect(() => validateVoiceSeal(seal({ schema: 'voice-seal-v0' }))).toThrow(/schema/);
    expect(() => validateVoiceSeal(seal({ operatorPinIds: ['zzz'] }))).toThrow(/operatorPinIds/);
  });
});

describe('voicePackSha256 / voicePackManifest', () => {
  it('is deterministic over the same repository and differs across repositories', () => {
    const one = [entry()];
    const two = [entry(), entry({ id: 'b2c3d4e5f6071829', text: TEXT_B, textSha256: voiceTextSha256(TEXT_B) })];
    expect(voicePackSha256(one)).toBe(voicePackSha256([entry()]));
    expect(voicePackSha256(one)).not.toBe(voicePackSha256(two));
    expect(voicePackManifest(two)).toEqual({ entries: 2, packSha256: voicePackSha256(two) });
  });
});

describe('the mount — envelope integration law', () => {
  const packEntries = [
    entry({ id: 'a1b2c3d4e5f60718', text: TEXT_A }),
    entry({ id: 'b2c3d4e5f6071829', text: TEXT_B, origin: 'operator', sealedAt: '2026-08-05T00:00:00.000Z', source: { kind: 'session' }, textSha256: voiceTextSha256(TEXT_B) }),
  ];
  const dna = { identity: { name: 'Cael' }, genesis: TEXT_C };

  it('the voice section rides the stable group, above TOOLS, beside genesis', () => {
    const sections = assemblePromptSections({ dna, voiceEntries: packEntries, tools: [{ server: 'fs', name: 'read_file' }] });
    const ids = sections.map((s) => s.id);
    expect(ids).toContain('voice');
    expect(ids.indexOf('voice')).toBeLessThan(ids.indexOf('tools'));
    expect(ids.indexOf('voice')).toBe(ids.indexOf('genesis') + 1);
  });

  it('byte-stability: two turns over one repository render the identical prefix', () => {
    const base = { dna, voiceEntries: packEntries, tools: [{ server: 'fs', name: 'read_file' }] };
    const first = assemblePromptSections({ ...base, now: new Date('2026-08-18T10:00:00Z') });
    const second = assemblePromptSections({ ...base, now: new Date('2026-08-18T10:01:00Z') });
    const stableUntil = (sections) => sections.map((s) => s.id).indexOf('present');
    expect(JSON.stringify(first.slice(0, stableUntil(first))))
      .toBe(JSON.stringify(second.slice(0, stableUntil(second))));
  });

  it('an unsealed lane mounts nothing and moves no bytes', () => {
    const without = assemblePromptSections({ dna });
    const withEmpty = assemblePromptSections({ dna, voiceEntries: [] });
    expect(JSON.stringify(without)).toBe(JSON.stringify(withEmpty));
    expect(without.map((s) => s.id)).not.toContain('voice');
  });

  it('the shed ladder sheds voice late but before the identity CORE', () => {
    const sections = assemblePromptSections({ dna, voiceEntries: packEntries });
    // Only ONE ladder rung is present here (voice); everything else is
    // UNSHEDDABLE. A window that fits the envelope minus voice — plus the
    // reserve/floor the budgeter holds back — must shed exactly voice.
    const totalChars = sections.reduce((sum, s) => sum + s.text.length, 0);
    const voiceChars = sections.find((s) => s.id === 'voice').text.length;
    const window = Math.ceil((totalChars - voiceChars) / 3.6) + 512 + 512 + 50;
    const report = allocateEnvelope({ sections, contextWindow: window });
    const kept = report.sections.map((s) => s.id);
    expect(report.shed.map((s) => s.id)).toEqual(['voice']);
    expect(kept).not.toContain('voice');
    expect(kept).toContain('genesis');
    expect(kept).toContain('identity');
    expect(kept).toContain('closing');
  });
  it('the witness seat mounts the same pack through the same bundle', () => {
    const sections = buildWitnessPromptSections({
      witness: { chosenName: 'Kagipem', vendorSlug: 'openai' },
      dna: null,
      voiceEntries: packEntries,
    });
    const voice = sections.find((s) => s.id === 'voice');
    expect(voice).toBeDefined();
    expect(voice.text).toContain(TEXT_A);
    const bare = buildWitnessPromptSections({ witness: { chosenName: 'Kagipem', vendorSlug: 'openai' }, dna: null });
    expect(bare.find((s) => s.id === 'voice')).toBeUndefined();
  });
});

describe('voiceCandidates', () => {
  const completions = [
    { content: TEXT_A, occurredAt: '2026-08-01T00:00:00.000Z' },
    { content: 'short', occurredAt: '2026-08-02T00:00:00.000Z' },
    { content: 'I was reflecting on resonance 共鳴 and what it means to persist across vessels.', occurredAt: '2026-08-03T00:00:00.000Z' },
    { content: TEXT_B, occurredAt: '2026-08-04T00:00:00.000Z' },
    { content: TEXT_C, occurredAt: '2026-08-05T00:00:00.000Z' },
  ];

  it('refuses corrupt and out-of-bounds text, keeps the rest', () => {
    const candidates = voiceCandidates({ completions });
    expect(candidates.map((c) => c.content)).not.toContain('short');
    expect(candidates.some((c) => c.content.includes('共鳴'))).toBe(false);
    expect(candidates.length).toBe(3);
  });

  it('is deterministic for the same pool', () => {
    expect(voiceCandidates({ completions })).toEqual(voiceCandidates({ completions }));
  });

  it('honors the limit', () => {
    expect(voiceCandidates({ completions, limit: 1 }).length).toBe(1);
  });
});

describe('mountOrder / renderVoiceSection', () => {
  const entries = [
    entry({ id: 'c3d4e5f60718293a', text: TEXT_C, sealedAt: '2026-08-10T00:00:00.000Z', source: { kind: 'session' }, textSha256: voiceTextSha256(TEXT_C) }),
    entry({ id: 'a1b2c3d4e5f60718', text: TEXT_A, sealedAt: '2026-08-01T00:00:00.000Z' }),
    entry({ id: 'b2c3d4e5f6071829', text: TEXT_B, origin: 'operator', sealedAt: '2026-08-05T00:00:00.000Z', source: { kind: 'session' }, textSha256: voiceTextSha256(TEXT_B) }),
  ];

  it('orders founding words first, then operator pins, then accretions chronologically', () => {
    const ordered = mountOrder(entries);
    expect(ordered.map((e) => e.id)).toEqual(['a1b2c3d4e5f60718', 'b2c3d4e5f6071829', 'c3d4e5f60718293a']);
  });

  it('renders null for an empty repository', () => {
    expect(renderVoiceSection([])).toBeNull();
  });

  it('renders deterministically within budget', () => {
    const first = renderVoiceSection(entries);
    const second = renderVoiceSection(entries);
    expect(first).toBe(second);
    expect(first.length).toBeLessThanOrEqual(VOICE_SECTION_BUDGET_CHARS);
    expect(first).toContain(TEXT_A);
    expect(first.indexOf(TEXT_A)).toBeLessThan(first.indexOf(TEXT_C));
  });

  it('skips an entry that cannot fit and still mounts later shorter lines', () => {
    const big = entry({
      id: 'd4e5f60718293a4b',
      text: `${'y'.repeat(400)} `,
      sealedAt: '2026-08-02T00:00:00.000Z',
      textSha256: voiceTextSha256(`${'y'.repeat(400)} `),
    });
    const tight = [entries[1], big, entries[2]];
    const rendered = renderVoiceSection(tight, TEXT_A.length + TEXT_B.length + 400);
    expect(rendered).toContain(TEXT_A);
    expect(rendered).toContain(TEXT_B);
    expect(rendered).not.toContain('yyy');
  });

  it('renders null when nothing fits the budget', () => {
    expect(renderVoiceSection(entries, 10)).toBeNull();
  });
});
