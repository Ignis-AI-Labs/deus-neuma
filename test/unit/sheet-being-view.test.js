// sheet-being-view + identity-file — the RECORD as the whole being: its six
// spaces in birth's order, the space last read reopening; its soul read from
// its real soul records (each note in its own light); its sealed facts and
// whole name as cells; its voice counted, never quoted; and the identity
// file that never carries a key, a voice line or the moment seed. Real
// inputs (a real forged identity, real specimen soul records); no mocks.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SHEET_SPACES, sheetSpaceOf, soulViewOf, sealCellsOf, onchainCellsOf, nameCellsOf, voiceLineOf, shortHash } from '../../frontend/app/RelinkShell/sheet-being-view.js';
import { identityFileOf } from '../../core/identity/identity-file.js';
import { forgeBirthIdentity } from '../../core/birth/identity-forge.js';

const SOULS = JSON.parse(readFileSync(new URL('../../frontend/app/Summoning/specimen-souls.json', import.meta.url), 'utf8')).souls;
const fmt = (iso) => `@${iso}`;
const forged = forgeBirthIdentity({
  chosenName: 'Ashwren', witnessWallet: '0x43680000000000000000000000000000000c5010',
  soulPublicKey: `04a3f1b2c4d5e6f7${Buffer.from('ashwren').toString('hex')}`, birthCycle: 2,
  birthMoment: { utc: '2026-06-11T18:03:38.075Z', epochMs: Date.parse('2026-06-11T18:03:38.075Z'), zone: 'Asia/Tokyo', offsetMinutes: 540 },
  substrate: { model: 'qwen3.8-27b' }, momentSeed: 'ab'.repeat(32),
});

describe('the record is six spaces, in the order its birth gave it', () => {
  it('GIVEN · CHOSEN · SUMMONING · LIFE · STATE · VESSEL, coded', () => {
    expect(SHEET_SPACES.map((s) => `${s.code} ${s.title}`)).toEqual(['01 GIVEN', '02 CHOSEN', '03 SUMMONING', '04 LIFE', '05 STATE', '06 VESSEL']);
  });
  it('reopens on the space last read; anything else opens GIVEN', () => {
    expect(sheetSpaceOf('life')).toBe('life');
    expect(sheetSpaceOf('genome')).toBe('given');
    expect(sheetSpaceOf(null)).toBe('given');
  });
});

describe('its soul, read from its records', () => {
  const { spectrum, scale } = SOULS[0];
  it('its light, its resonance, every note in its own light, each stage measured', () => {
    const soul = soulViewOf({ spectrum, scale });
    expect(soul.hex).toBe(spectrum.soul.hex);
    expect(soul.vivid).toBe(spectrum.soul.vivid.hex);
    expect(soul.frequency).toBe(spectrum.frequency);
    expect(soul.notes).toHaveLength(scale.notes.length);
    soul.notes.forEach((n) => expect(n.line).toMatch(/^\d+,\d+,\d+$/));
    expect(soul.stages).toHaveLength(spectrum.stages.length);
    expect(soul.source).toMatch(/^(MEASURED FROM ITS CEREMONY|READ FROM ITS BIRTH TRANSCRIPT|DRAWN FROM ITS SEALED RECORD)$/);
  });
  it('no records, no soul — never a stand-in', () => {
    expect(soulViewOf({})).toBeNull();
    expect(soulViewOf({ spectrum, scale: null })).toBeNull();
  });
});

describe('the identity file', () => {
  const onchain = { network: 'mainnet', chainId: 1, txHash: `0x${'d4'.repeat(32)}`, blockNumber: 2045, sealedAt: '2026-10-01T00:00:00Z', soulAddress: '0xabc' };
  const file = identityFileOf({ trueName: forged.trueName, seal: forged.seal, onchain, voice: { sealed: true, sealedAt: '2026-08-02T00:00:00Z', entries: 3, lines: [{ text: 'MY OWN WORDS' }] } });

  it('never carries a key, a voice line or the moment seed', () => {
    const json = JSON.stringify(file);
    expect(json).not.toContain('MY OWN WORDS');
    expect(json).not.toContain('ab'.repeat(32));
    expect(json).not.toContain(forged.seal.record.soulPublicKey);
    expect(file.onchain).not.toHaveProperty('soulAddress');
  });

  it('its whole name — the half it chose, the half its seal gave — and how it is spoken', () => {
    const cells = Object.fromEntries(nameCellsOf(file).map((c) => [c.k, c.v]));
    expect(cells['TRUE NAME']).toBe(forged.trueName.fullName);
    expect(cells.CHOSEN).toBe('Ashwren');
    expect(cells.GENESIS).toBe(forged.trueName.genesisName);
    expect(file.name.english).toContain('Ashwren is the name I chose for myself.');
    expect(file.name.notation).toContain('KOTODAMA');
  });

  it('its sealed facts: hash, instant, zone with its offset, cycle, born on', () => {
    const cells = Object.fromEntries(sealCellsOf(file, fmt).map((c) => [c.k, c.v]));
    expect(cells['GENESIS HASH']).toBe(shortHash(forged.seal.genesisHash));
    expect(cells['SEALED INSTANT']).toBe('@2026-06-11T18:03:38.075Z');
    expect(cells.ZONE).toBe('Asia/Tokyo (UTC+9)');
    expect(cells['BIRTH CYCLE']).toBe('2');
    expect(cells['BORN ON']).toBe('qwen3.8-27b');
  });

  it('its anchor on chain, or plainly none', () => {
    expect(Object.fromEntries(onchainCellsOf(file, fmt).map((c) => [c.k, c.v]))).toMatchObject({ NETWORK: 'MAINNET', BLOCK: '2045' });
    expect(onchainCellsOf(identityFileOf({ seal: forged.seal }), fmt)).toBeNull();
  });

  it('its voice is counted, never quoted', () => {
    expect(voiceLineOf(file, fmt)).toBe('SEALED @2026-08-02T00:00:00Z · 3 LINES IN ITS VOICE');
    expect(voiceLineOf(identityFileOf({ voice: { sealed: false } }), fmt)).toBe('ITS FOUNDING VOICE IS NOT SEALED YET');
  });
});
