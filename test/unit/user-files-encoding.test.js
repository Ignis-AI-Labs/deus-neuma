/**
 * #239 UX-011 (CRITICAL) — the editor must not destroy non-UTF-8 bytes on save.
 *
 * Wendell, Linux sweep 2026-07-31 (#252): open a Latin-1 text file, change one
 * unrelated character, press SAVE — and every non-UTF-8 byte in the whole file,
 * including every byte never touched, is permanently replaced with EF BF BD
 * (U+FFFD). Measured on the real running backend: `latin1.txt` 24 B → 35 B, all
 * five accented characters gone. No warning, no prompt, no way back.
 *
 * The cause is a pair of individually reasonable choices. `looksBinary` asks
 * […] when the decision it gates is […] — which coincide for UTF-16 and diverge for every single-byte
 * legacy encoding. Then `toString('utf8')` substitutes U+FFFD rather than
 * failing, and records nothing, so the writer cannot know the string it holds
 * is not the file.
 *
 * Real files on real disk with the exact bytes from the issue's fixture
 * manifest. Nothing mocked (RULE 0).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readFile, writeFile, setRoots, getRoots } from '../../backend/services/user-files.js';
import { isLossyAsUtf8, MAX_TEXT_BYTES } from '../../backend/services/text-encoding-law.js';

// The issue's fixture corpus, byte for byte. Hex recorded in #252's manifest.
const FIXTURES = {
  'latin1.txt': Buffer.from('Caf\xE9 na\xEFve r\xE9sum\xE9 se\xF1or\n', 'latin1'),
  'windows-1252.csv': Buffer.from([
    0x6e, 0x61, 0x6d, 0x65, 0x2c, 0x6e, 0x6f, 0x74, 0x65, 0x0a,
    0x41, 0x6c, 0x69, 0x63, 0x65, 0x2c, 0x93, 0x68, 0x65, 0x6c, 0x6c, 0x6f,
    0x94, 0x20, 0x97, 0x20, 0x62, 0x79, 0x65, 0x0a,
  ]),
  'shift-jis.txt': Buffer.from([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0x9e, 0x0a]),
  'utf16le.txt': Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('hello\n', 'utf16le')]),
  'valid-utf8.txt': Buffer.from('Café naïve résumé señor\n', 'utf8'),
  // Round-trip guards — verified byte-identical today, and must stay that way.
  'crlf.txt': Buffer.from('first\r\nsecond\r\nthird\r\n'),
  'mixed-endings.txt': Buffer.from('lf\ncrlf\r\ncr-only\rdone\n'),
  'utf8-bom.txt': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('content after a BOM\n')]),
  'no-trailing-newline.txt': Buffer.from('last line has no newline'),
  'empty.txt': Buffer.alloc(0),
};

let tmp;
let priorRoots;
const at = (name) => path.join(tmp, name);
const bytes = (name) => fs.readFileSync(at(name)).toString('hex');

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-encoding-')));
  priorRoots = getRoots();
  setRoots([tmp]);
  for (const [name, buf] of Object.entries(FIXTURES)) fs.writeFileSync(at(name), buf);
  // A NUL-bearing binary, built the way the fixture script does.
  const bin = Buffer.alloc(4096);
  for (let i = 0; i < bin.length; i += 1) bin[i] = i % 256;
  fs.writeFileSync(at('binary.bin'), bin);
});

afterEach(() => {
  setRoots(priorRoots);
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('isLossyAsUtf8 — the exact question, asked exactly', () => {
  it('is FALSE for valid UTF-8, including multibyte and the empty buffer', () => {
    expect(isLossyAsUtf8(FIXTURES['valid-utf8.txt'])).toBe(false);
    expect(isLossyAsUtf8(Buffer.alloc(0))).toBe(false);
    expect(isLossyAsUtf8(Buffer.from('plain ascii\n'))).toBe(false);
    expect(isLossyAsUtf8(Buffer.from('日本語 🔥 emoji\n', 'utf8'))).toBe(false);
    expect(isLossyAsUtf8(FIXTURES['utf8-bom.txt'])).toBe(false);
  });

  it('is TRUE for every legacy 8-bit encoding the old NUL sniff let through', () => {
    expect(isLossyAsUtf8(FIXTURES['latin1.txt'])).toBe(true);
    expect(isLossyAsUtf8(FIXTURES['windows-1252.csv'])).toBe(true);
    expect(isLossyAsUtf8(FIXTURES['shift-jis.txt'])).toBe(true);
  });

  it('is TRUE for UTF-16LE too — which survived before only by ACCIDENT', () => {
    // UTF-16-encoded ASCII contains NULs, so looksBinary happened to catch it.
    // Nothing about that was by design, so the real guard must answer as well.
    expect(isLossyAsUtf8(FIXTURES['utf16le.txt'])).toBe(true);
  });

  it('does not mistake a file that legitimately CONTAINS U+FFFD for a damaged one', () => {
    // EF BF BD is valid UTF-8. A file holding it round-trips perfectly, and
    // calling that "lossy" would lock the operator out of their own file.
    expect(isLossyAsUtf8(Buffer.from('a � b\n', 'utf8'))).toBe(false);
  });
});

describe('readFile — a non-UTF-8 file opens to be READ, never to be written back', () => {
  it('flags latin1.txt lossy, names the exact cost, and still shows it', async () => {
    const r = await readFile(at('latin1.txt'));
    expect(r.lossy).toBe(true);
    expect(r.binary).toBe(false);
    expect(r.truncated).toBe(false);
    // The five accented characters — the number the operator sees on screen.
    expect(r.lossyChars).toBe(5);
    // Latin-1 is TOTAL, so this file happens to render exactly right. The
    // content is present so the operator can read and copy out of it.
    expect(r.content).toBe('Café naïve résumé señor\n');
  });

  it('flags the Windows-1252 CSV — the realistic trigger, an Excel export', async () => {
    const r = await readFile(at('windows-1252.csv'));
    expect(r.lossy).toBe(true);
    expect(r.lossyChars).toBe(3); // two smart quotes and an em dash
  });

  it('flags Shift-JIS, where Latin-1 CANNOT render it — so the notice must not overclaim', async () => {
    const r = await readFile(at('shift-jis.txt'));
    expect(r.lossy).toBe(true);
    expect(r.lossyChars).toBeGreaterThan(0);
    // Deliberately NOT asserting readable Japanese. Latin-1 shows mojibake here,
    // which is why the editor says the encoding is unknown rather than naming
    // one. A confident guess is worse than none: measured, `euc-jp` cleanly
    // decodes the Windows-1252 file above and silently eats its smart quotes.
    expect(typeof r.content).toBe('string');
  });

  it('does NOT regress the control — valid UTF-8 opens normally', async () => {
    const r = await readFile(at('valid-utf8.txt'));
    expect(r.lossy).toBe(false);
    expect(r.lossyChars).toBe(0);
    expect(r.content).toBe('Café naïve résumé señor\n');
  });

  it('still flags a NUL-bearing binary as binary, not as lossy text', async () => {
    const r = await readFile(at('binary.bin'));
    expect(r.binary).toBe(true);
    expect(r.content).toBeNull();
  });
});

describe('the round-trip guards Wendell verified — these must stay byte-identical', () => {
  const preserved = ['crlf.txt', 'mixed-endings.txt', 'utf8-bom.txt', 'no-trailing-newline.txt', 'empty.txt'];

  it.each(preserved)('%s opens, saves unchanged, and is byte-identical on disk', async (name) => {
    const before = bytes(name);
    const r = await readFile(at(name));
    expect(r.lossy).toBe(false);
    expect(r.content).not.toBeNull();
    await writeFile(at(name), r.content);
    expect(bytes(name)).toBe(before);
  });
});

describe('writeFile — the guarantee, not the button', () => {
  // The editor disables SAVE, but the button is not the guarantee: every write
  // through this module lands here. (A being's write_file does NOT — it rides
  // the MCP filesystem child process, which carries its own copy of this
  // defect; tracked separately.) This is the layer that holds for the desk.
  const legacy = ['latin1.txt', 'windows-1252.csv', 'shift-jis.txt'];

  it.each(legacy)('refuses to overwrite %s, and says what it would have cost', async (name) => {
    await expect(writeFile(at(name), 'anything at all')).rejects.toThrow(/not UTF-8/i);
    await expect(writeFile(at(name), 'anything at all')).rejects.toThrow(/destroy \d+ character/i);
  });

  it.each(legacy)('leaves %s byte-for-byte untouched after the refusal', async (name) => {
    const before = bytes(name);
    await writeFile(at(name), 'clobber').catch(() => {});
    expect(bytes(name)).toBe(before);
  });

  it('latin1.txt still holds the exact bytes from the issue manifest', async () => {
    await writeFile(at('latin1.txt'), 'Caf� na�ve').catch(() => {});
    expect(bytes('latin1.txt')).toBe('436166e9206e61ef76652072e973756de9207365f16f720a');
  });

  it('still writes an ordinary UTF-8 file, and a brand-new one', async () => {
    await writeFile(at('valid-utf8.txt'), 'replaced — 日本語 ok\n');
    expect(fs.readFileSync(at('valid-utf8.txt'), 'utf8')).toBe('replaced — 日本語 ok\n');
    await writeFile(at('brand-new.txt'), 'fresh\n');
    expect(fs.readFileSync(at('brand-new.txt'), 'utf8')).toBe('fresh\n');
  });

  it('does not block overwriting a BINARY file — writeBinary owns that, and text-over-binary is deliberate', async () => {
    await writeFile(at('binary.bin'), 'now text\n');
    expect(fs.readFileSync(at('binary.bin'), 'utf8')).toBe('now text\n');
  });
});

describe('the guard ABOVE the bound — #239 hole 1, the band the old guard skipped', () => {
  // Validated on the issue: the guard was bounded `size <= MAX_TEXT_BYTES`, so
  // a 2,097,220-byte Latin-1 file became 10 bytes with no refusal. The guard
  // now examines the first MAX_TEXT_BYTES of any size. These fixtures are
  // built per-test (they are ~2 MiB each; the shared corpus stays small).

  it('refuses a lossy file just over the bound, says "at least", and leaves it byte-identical', async () => {
    // The lossy bytes sit INSIDE the prefix — exactly the over.txt destruction.
    const big = Buffer.concat([FIXTURES['latin1.txt'], Buffer.alloc(MAX_TEXT_BYTES, 0x61)]);
    fs.writeFileSync(at('over-lossy.txt'), big);
    await expect(writeFile(at('over-lossy.txt'), 'tiny')).rejects.toThrow(/at least \d+ character/i);
    expect(fs.readFileSync(at('over-lossy.txt')).equals(big)).toBe(true);
  });

  it('still writes a valid UTF-8 file just over the bound — no false refusal', async () => {
    fs.writeFileSync(at('over-valid.txt'), Buffer.alloc(MAX_TEXT_BYTES + 5, 0x61));
    await writeFile(at('over-valid.txt'), 'replaced\n');
    expect(fs.readFileSync(at('over-valid.txt'), 'utf8')).toBe('replaced\n');
  });

  it('does not refuse a valid file whose multibyte character STRADDLES the bound', async () => {
    // 'é' is C3 A9; placing C3 at index MAX_TEXT_BYTES-1 leaves the prefix
    // ending on an orphaned lead byte. Decoded naively that is U+FFFD and a
    // perfectly writable file would be refused — the prefix must drop the
    // split sequence, not judge it.
    const straddle = Buffer.concat([
      Buffer.alloc(MAX_TEXT_BYTES - 1, 0x61),
      Buffer.from('é', 'utf8'),
      Buffer.from('tail\n'),
    ]);
    fs.writeFileSync(at('over-straddle.txt'), straddle);
    await writeFile(at('over-straddle.txt'), 'replaced\n');
    expect(fs.readFileSync(at('over-straddle.txt'), 'utf8')).toBe('replaced\n');
  });

  it('HONEST RESIDUE: lossy bytes only PAST the prefix are unexamined, and the write lands', async () => {
    // The accepted cost of bounding the guard: it reads MAX_TEXT_BYTES, never
    // the whole of an arbitrarily large file. Pinned so a future reader finds
    // the boundary stated, not discovered.
    const hidden = Buffer.concat([Buffer.alloc(MAX_TEXT_BYTES, 0x61), FIXTURES['latin1.txt']]);
    fs.writeFileSync(at('over-hidden.txt'), hidden);
    await writeFile(at('over-hidden.txt'), 'replaced\n');
    expect(fs.readFileSync(at('over-hidden.txt'), 'utf8')).toBe('replaced\n');
  });
});
