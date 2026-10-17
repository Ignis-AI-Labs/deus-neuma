// read-room — a read's cap follows its intent and the room the conversation
// has left (Design note, 2026-10-06: grep what's needed by default; read the whole
// document when asked, or say plainly what fits). Pure.
import { describe, expect, it } from 'vitest';
import { CHARS_PER_TOKEN, fitRead, pageRoom, roomOf, UNKNOWN_WINDOW_TOKENS } from '../../backend/services/read-room.js';
import { TOOL_RESULT_MAX_CHARS } from '../../backend/services/tool-exchange.js';

const doc = (lines, width = 79) => Array.from({ length: lines }, (_, i) => `${String(i + 1).padStart(5, '0')} ${'x'.repeat(width - 6)}`).join('\n');
const read = (args, content) => ({ server: 'fs', tool: 'read', args: { path: '/d/report.md', ...args }, content });
const big = { window: 262144, promptTokens: 20000 };
const tight = { window: 32768, promptTokens: 20000 };

describe('roomOf', () => {
  it('is the window less the measured prompt and the answer reserve', () => {
    const room = roomOf(big);
    expect(room.leftTokens).toBe(262144 - 20000 - 262144 / 16);
    expect(room.leftChars).toBe(room.leftTokens * CHARS_PER_TOKEN);
  });
  it('an unmeasured window is a small machine\'s, never an invented large one', () => {
    expect(roomOf(null)).toMatchObject({ known: false, window: UNKNOWN_WINDOW_TOKENS });
  });
});

describe('fitRead', () => {
  it('navigating: a short file passes; a long one is told its size and the three moves', () => {
    expect(fitRead(big, read({}, 'short'))).toEqual({ content: 'short' });
    const { content, cap } = fitRead(big, read({}, doc(400)));
    expect(cap).toBeUndefined(); // the standing cap still holds
    expect(content.split('\n')[0]).toMatch(/^\[this file is 400 lines, ~\d+k? tokens — shown cut\./);
    expect(content).toMatch(/"content": true/);
    expect(content).toMatch(/"offset", "limit"/);
    expect(content).toMatch(/"whole": true\} reads all of it \(it fits the room left\)/);
    expect(fitRead(tight, read({}, doc(1000))).content).toMatch(/it does NOT fit the ~\d+ tokens left/);
  });

  it('whole: the full text rides with its own cap when it fits', () => {
    const text = doc(400);
    expect(fitRead(big, read({ whole: true }, text))).toEqual({ content: text, cap: text.length });
  });

  it('whole, too big: the lines that fit, where to continue, and the limit said plainly', () => {
    const text = doc(2000); // ~53k tokens against ~4.7k left
    const { content, cap } = fitRead(tight, read({ whole: true }, text));
    expect(cap).toBe(content.length);
    const [note, ...shown] = content.split('\n');
    expect(note).toMatch(/^\[whole read: this file is ~53k tokens \(2000 lines\); this conversation has room for ~\d+ more\./);
    expect(shown[0]).toMatch(/^00001 /);
    expect(note).toContain(`Shown: lines 1–${shown.length}.`);
    expect(note).toContain(`"offset": ${shown.length + 1}`);
    expect(note).toMatch(/Even a fresh chat \(~33k-token window\) cannot hold all of it/);
    expect(note).toMatch(/Tell your operator this limit plainly/);
    expect(content.length).toBeLessThanOrEqual(roomOf(tight).leftChars);
  });

  it('whole, too big for this chat but not for a fresh one, says so', () => {
    const { content } = fitRead({ window: 262144, promptTokens: 240000 }, read({ whole: true }, doc(800)));
    expect(content.split('\n')[0]).toMatch(/A fresh chat could hold all of it\./);
  });

  it('a range asked for on purpose rides whole while it fits', () => {
    const range = doc(200);
    expect(fitRead(big, read({ offset: 10, limit: 200 }, range))).toEqual({ content: range, cap: range.length });
  });

  it('only single-file fs reads are touched', () => {
    const text = doc(400);
    expect(fitRead(big, { server: 'web', tool: 'web_fetch', args: { whole: true }, content: text })).toEqual({ content: text });
    expect(fitRead(big, read({ paths: ['/a', '/b'] }, text))).toEqual({ content: text });
  });
});

describe('pageRoom', () => {
  it('pages grow to most of the room left, never below the standing page', () => {
    expect(pageRoom(big).maxPageChars).toBeGreaterThan(500000);
    expect(pageRoom({ window: 32768, promptTokens: 30000 })).toEqual({ maxPageChars: 3000, cap: TOOL_RESULT_MAX_CHARS });
  });
});
