import { describe, it, expect } from 'vitest';
import { ALPHABET } from '../../core/kotodama/alphabet.js';
import {
  textToBytes,
  textToProgram,
  bytesToProgram,
  motifToProgram,
  programToNotation,
  programToBytes,
} from '../../core/kotodama/encode.js';

describe('kotodama alphabet', () => {
  it('has 16 data tones inside the 600-2400 Hz band, strictly rising', () => {
    expect(ALPHABET.dataTones).toHaveLength(16);
    expect(ALPHABET.dataTones[0]).toBe(600);
    expect(ALPHABET.dataTones[15]).toBe(2400);
    for (let i = 1; i < 16; i++) {
      expect(ALPHABET.dataTones[i]).toBeGreaterThan(ALPHABET.dataTones[i - 1]);
    }
  });

  it('keeps control tones outside the data band', () => {
    expect(ALPHABET.control.SYNC).toBeLessThan(ALPHABET.dataTones[0]);
    expect(ALPHABET.control.END).toBeGreaterThan(ALPHABET.dataTones[15]);
  });

  it('mirror pairs are exact reversals (learnability symmetry)', () => {
    expect([...ALPHABET.motifs.FAREWELL]).toEqual([...ALPHABET.motifs.PRESENCE].reverse());
    expect([...ALPHABET.motifs.DENY]).toEqual([...ALPHABET.motifs.CONFIRM].reverse());
  });
});

describe('kotodama encode', () => {
  it('round-trips text losslessly: text → program → bytes → text', () => {
    const msg = 'I am Aeon. 285Hz.';
    const program = textToProgram(msg);
    const bytes = programToBytes(program);
    expect(new TextDecoder().decode(new Uint8Array(bytes))).toBe(msg);
  });

  it('frames every spell with SYNC and END', () => {
    const program = textToProgram('hi');
    expect(program.items[0].kind).toBe('sync');
    expect(program.items[program.items.length - 1].kind).toBe('end');
  });

  it('encodes two tones per byte at the alphabet frequencies', () => {
    const program = bytesToProgram([0x4b]); // 'K'
    const tones = program.items.filter((it) => it.kind === 'tone');
    expect(tones).toHaveLength(2);
    expect(tones[0].nibble).toBe(0x4);
    expect(tones[1].nibble).toBe(0xb);
    expect(tones[0].freq).toBe(ALPHABET.dataTones[0x4]);
    expect(tones[1].freq).toBe(ALPHABET.dataTones[0xb]);
  });

  it('rate scales duration without changing content', () => {
    const slow = textToProgram('go', 1);
    const fast = textToProgram('go', 2);
    expect(programToBytes(fast)).toEqual(programToBytes(slow));
    const ms = (p) => p.items.reduce((s, it) => s + it.ms, 0);
    expect(ms(fast)).toBeCloseTo(ms(slow) / 2, 5);
  });

  it('builds motifs from the alphabet contour and rejects unknown names', () => {
    const program = motifToProgram('CONFIRM');
    const nibbles = program.items.filter((it) => it.kind === 'tone').map((it) => it.nibble);
    expect(nibbles).toEqual([...ALPHABET.motifs.CONFIRM]);
    expect(() => motifToProgram('NONSENSE')).toThrow(/Unknown kotodama motif/);
  });

  it('notation carries every tone — the deaf reader receives the full message', () => {
    const program = textToProgram('K');
    const notation = programToNotation(program);
    expect(notation).toContain('KOTODAMA/0.1 SPELL');
    expect(notation).toContain(`4·${ALPHABET.dataTones[4]}`);
    expect(notation).toContain(`B·${ALPHABET.dataTones[0xb]}`);
    expect(notation).toContain('[SYNC 440]');
    expect(notation).toContain('[END 2960]');
  });

  it('programs are frozen — utterances are immutable once spoken', () => {
    const program = textToProgram('x');
    expect(Object.isFrozen(program)).toBe(true);
    expect(Object.isFrozen(program.items)).toBe(true);
    expect(Object.isFrozen(program.items[0])).toBe(true);
  });

  it('textToBytes is UTF-8 (multi-byte glyphs survive)', () => {
    const bytes = textToBytes('真計');
    const program = bytesToProgram(bytes);
    expect(new TextDecoder().decode(new Uint8Array(programToBytes(program)))).toBe('真計');
  });
});
