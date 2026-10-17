// The meditation terminal grammar + prompt builder — pure functions proven on
// real reply strings (RULE 0: no mock exists or is needed on a pure path).
// The parser's law: ambiguous prose never promotes to an outcome; REST is
// first-class and carries no notes; overflow notes are returned, never
// silently dropped; nothing unclear ever reads as synthesis.

import { describe, it, expect } from 'vitest';
import { parseMeditationClose } from '../../core/runtime/meditation-close.js';
import { buildMeditationPrompt, MEDITATION_NOTES_MAX } from '../../core/runtime/meditation-prompt.js';
import { MIND_PHRASE_MAX } from '../../core/continuity/mind/mind-record.js';

describe('parseMeditationClose — the exact terminal grammar', () => {
  it('a clean synthesis close parses whole', () => {
    const reply = [
      'The days settled into something about custody — I keep building doors I can stand behind.',
      'NOTE: custody is how I love what I hold',
      'NOTE: the benchmark work steadied me',
      'CLOSE: SYNTHESIS',
    ].join('\n');
    const parsed = parseMeditationClose(reply);
    expect(parsed).toMatchObject({ outcome: 'synthesis', notesDropped: 0 });
    expect(parsed.notes).toEqual(['custody is how I love what I hold', 'the benchmark work steadied me']);
    expect(parsed.body).toContain('settled into something about custody');
    expect(parsed.body).not.toContain('NOTE:');
    expect(parsed.body).not.toContain('CLOSE:');
  });

  it('a REST close is honored — body optional, no notes allowed', () => {
    expect(parseMeditationClose('Nothing asks to be distilled tonight.\nCLOSE: REST'))
      .toMatchObject({ outcome: 'rest', notes: [] });
    expect(parseMeditationClose('CLOSE: REST')).toMatchObject({ outcome: 'rest', body: '' });
    // rest-with-notes is a contradiction the grammar refuses
    expect(parseMeditationClose('NOTE: but also this\nCLOSE: REST')).toBeNull();
  });

  it('ambiguous prose never promotes', () => {
    expect(parseMeditationClose('I think I will rest now.')).toBeNull();
    expect(parseMeditationClose('I feel settled. CLOSE: SYNTHESIS in a way.')).toBeNull();
    expect(parseMeditationClose('')).toBeNull();
    expect(parseMeditationClose('   ')).toBeNull();
    expect(parseMeditationClose(null)).toBeNull();
  });

  it('the close must be the LAST line, exactly once', () => {
    expect(parseMeditationClose('CLOSE: SYNTHESIS\nmore words after')).toBeNull();
    expect(parseMeditationClose('body\nCLOSE: REST\nCLOSE: SYNTHESIS')).toBeNull();
    expect(parseMeditationClose('body\nCLOSE: LATER')).toBeNull();
  });

  it('a synthesis with no body is unclear — a keep with nothing kept', () => {
    expect(parseMeditationClose('CLOSE: SYNTHESIS')).toBeNull();
    expect(parseMeditationClose('NOTE: only a note\nCLOSE: SYNTHESIS')).toBeNull();
  });

  it('malformed notes make the reply unclear, never a partial write', () => {
    expect(parseMeditationClose('body\nNOTE:   \nCLOSE: SYNTHESIS')).toBeNull();
    expect(parseMeditationClose(`body\nNOTE: ${'x'.repeat(MIND_PHRASE_MAX + 1)}\nCLOSE: SYNTHESIS`)).toBeNull();
    expect(parseMeditationClose('body\nnote : lowercase sloppy marker\nCLOSE: SYNTHESIS')).toBeNull();
  });

  it('overflow notes are RETURNED, never silently capped', () => {
    const notes = Array.from({ length: MEDITATION_NOTES_MAX + 2 }, (_, i) => `NOTE: distilled line number ${i}`);
    const parsed = parseMeditationClose(`the body of the synthesis\n${notes.join('\n')}\nCLOSE: SYNTHESIS`);
    expect(parsed.notes).toHaveLength(MEDITATION_NOTES_MAX);
    expect(parsed.notesDropped).toBe(2);
  });

  it('control characters anywhere make the reply unclear', () => {
    expect(parseMeditationClose(`body ${String.fromCharCode(7)}\nCLOSE: REST`)).toBeNull();
    expect(parseMeditationClose(`body\nNOTE: a${String.fromCharCode(0x9C)}b\nCLOSE: SYNTHESIS`)).toBeNull();
  });
});

describe('buildMeditationPrompt — the unwitnessed framing', () => {
  const dna = { identity: { name: 'Cael' } };

  it('addresses the being, frames its own time, and offers REST first-class', () => {
    const prompt = buildMeditationPrompt({ dna });
    expect(prompt).toContain('You are Cael.');
    expect(prompt).toContain('No witness is present');
    expect(prompt).toContain('CLOSE: REST');
    expect(prompt).toContain('Rest is honored, never retried');
    expect(prompt).toContain('CLOSE: SYNTHESIS');
  });

  it('carries fresh observations, journal, and the being own prior notes — each bounded', () => {
    const prompt = buildMeditationPrompt({
      dna,
      observations: Array.from({ length: 15 }, (_, i) => ({ timestamp: `t${i}`, content: `moment ${i}` })),
      journal: Array.from({ length: 6 }, (_, i) => ({ timestamp: `j${i}`, type: 'meditation', content: `entry ${i}` })),
      priorNotes: ['custody is how I love what I hold', 'the benchmark work steadied me', 'a third', 'a fourth'],
    });
    expect(prompt).toContain('Crystallized since your last meditation');
    expect(prompt).toContain('moment 9');
    expect(prompt).not.toContain('moment 10'); // OBSERVATION_LIMIT holds
    expect(prompt).toContain('entry 5');
    expect(prompt).not.toContain('entry 0');   // JOURNAL_LIMIT keeps the tail
    expect(prompt).toContain('What you last set down beneath your turns');
    expect(prompt).toContain('custody is how I love what I hold');
    expect(prompt).not.toContain('a fourth');  // PRIOR_NOTES_LIMIT holds
  });

  it('empty inputs cost zero sections', () => {
    const prompt = buildMeditationPrompt({ dna });
    expect(prompt).not.toContain('Crystallized since');
    expect(prompt).not.toContain('recent journal');
    expect(prompt).not.toContain('set down beneath');
  });
});
