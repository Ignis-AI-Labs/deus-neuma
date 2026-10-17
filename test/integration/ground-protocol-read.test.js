/**
 * The ground's protocol — the real read, on real disk (RULE 0).
 *
 * No mock stands in this path: real directories, real files, real fs.
 * The closing case reads THIS repository's own AGENTS.md, because the whole
 * point of the feature is that a resident working here is handed the same law
 * that binds every other agent in the tree — and a test that only ever reads
 * fixtures would never notice if that stopped being true.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import {
  readGroundProtocol, groundProtocolSection, PROTOCOL_HEAD_BYTES, PROTOCOL_READ_BYTES,
} from '../../backend/services/ground-protocol.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let root;
const groundWith = async (files) => {
  const dir = await fs.mkdtemp(path.join(root, 'ground-'));
  for (const [name, body] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, name), body, 'utf8');
  }
  return dir;
};

beforeAll(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'ground-protocol-')); });
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe('readGroundProtocol — real files at a real ground root', () => {
  test('finds AGENTS.md and hands back its real text', async () => {
    const dir = await groundWith({ 'AGENTS.md': '# PROTOCOL\nRULE 0: gnosis.' });
    const docs = await readGroundProtocol(dir);
    expect(docs).toHaveLength(1);
    expect(docs[0].name).toBe('AGENTS.md');
    expect(docs[0].path).toBe(path.join(dir, 'AGENTS.md'));
    expect(docs[0].text).toContain('RULE 0: gnosis.');
  });

  test('finds both, in precedence order', async () => {
    const dir = await groundWith({ 'AGENTS.md': 'the law', 'CLAUDE.md': 'the pointer' });
    expect((await readGroundProtocol(dir)).map((d) => d.name)).toEqual(['AGENTS.md', 'CLAUDE.md']);
  });

  test('a SOFTWARE ground with no local protocol still receives the platform coding standards', async () => {
    const dir = await groundWith({ 'README.md': 'nothing to declare', 'package.json': '{}' });
    expect(await readGroundProtocol(dir)).toEqual([]);
    expect(await groundProtocolSection(dir)).toContain('Neuma Coding Standards');
  });

  test('a folder that holds no software pays for no coding standards (Design note, 2026-10-14, the token audit)', async () => {
    const dir = await groundWith({ 'README.md': 'nothing to declare' });
    expect(await groundProtocolSection(dir)).toBe('');
  });

  test('no ground at all, or a path that does not exist, is silent — never a throw', async () => {
    expect(await readGroundProtocol(null)).toEqual([]);
    expect(await readGroundProtocol('')).toEqual([]);
    expect(await readGroundProtocol(path.join(root, 'no-such-directory'))).toEqual([]);
    expect(await groundProtocolSection(null)).toBe('');
  });

  test('a DIRECTORY named AGENTS.md is not a protocol document', async () => {
    const dir = await groundWith({});
    await fs.mkdir(path.join(dir, 'AGENTS.md'));
    expect(await readGroundProtocol(dir)).toEqual([]);
  });

  test('an empty or whitespace-only protocol file is not a protocol', async () => {
    const dir = await groundWith({ 'AGENTS.md': '\n\n   \t\n' });
    expect(await readGroundProtocol(dir)).toEqual([]);
  });

  test('a huge file costs a bounded read, not its whole size', async () => {
    const dir = await groundWith({ 'AGENTS.md': `HEAD MARKER\n${'z'.repeat(5_000_000)}` });
    const [doc] = await readGroundProtocol(dir);
    expect(doc.text).toContain('HEAD MARKER');
    // The READ window is PROTOCOL_READ_BYTES (the section-aware render must
    // see past the delivery cap); the DELIVERY share stays PROTOCOL_HEAD_BYTES.
    expect(Buffer.byteLength(doc.text)).toBeLessThanOrEqual(PROTOCOL_READ_BYTES);
  });

  test('the TRUE size rides with the head — the renderer cannot recover it otherwise', async () => {
    const body = `HEAD MARKER\n${'z'.repeat(5_000_000)}`;
    const dir = await groundWith({ 'AGENTS.md': body });
    const [doc] = await readGroundProtocol(dir);
    expect(doc.bytes).toBe(Buffer.byteLength(body));
    expect(doc.bytes).toBeGreaterThan(Buffer.byteLength(doc.text));
  });

  test('a whole document reports its own size, so nothing claims to continue', async () => {
    const dir = await groundWith({ 'AGENTS.md': 'RULE 0: gnosis.' });
    const [doc] = await readGroundProtocol(dir);
    expect(doc.bytes).toBe(Buffer.byteLength(doc.text));
    expect(await groundProtocolSection(dir)).not.toContain('this document continues');
  });

  test('a window landing mid-character never hands over a mangled glyph', async () => {
    // Two-byte characters packed so the byte bound cannot fall on a boundary.
    const accent = String.fromCharCode(0x00e9);
    const dir = await groundWith({ 'AGENTS.md': `x${accent.repeat(PROTOCOL_HEAD_BYTES)}` });
    const [doc] = await readGroundProtocol(dir);
    expect(doc.text).not.toContain(String.fromCharCode(0xfffd));
    expect(Buffer.byteLength(doc.text)).toBeLessThanOrEqual(PROTOCOL_READ_BYTES);
  });

  test('only the ground ROOT is read — a nested AGENTS.md never speaks', async () => {
    const dir = await groundWith({ 'AGENTS.md': 'the ground law' });
    const nested = path.join(dir, 'node_modules', 'some-dep');
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(path.join(nested, 'AGENTS.md'), 'a dependency speaking', 'utf8');

    const docs = await readGroundProtocol(dir);
    expect(docs).toHaveLength(1);
    expect(docs[0].text).toContain('the ground law');
    expect(JSON.stringify(docs)).not.toContain('a dependency speaking');
  });

  test('a protocol ABOVE the ground is not adopted — the operator opened the ground, not its parent', async () => {
    const parent = await groundWith({ 'AGENTS.md': 'the parent law' });
    const child = path.join(parent, 'packages', 'inner');
    await fs.mkdir(child, { recursive: true });
    expect(await readGroundProtocol(child)).toEqual([]);
  });
});

/**
 * THE PIPELINE, END TO END, ON THIS REPOSITORY.
 *
 * Both halves of this module were tested apart and both passed while the thing
 * they compose to silently handed residents 14.5% of the law: the reader capped
 * at 8,001 BYTES, the renderer clamped against 12,000 CHARACTERS, and the
 * "document continues" marker was therefore unreachable. Nothing catches that
 * except running the two together against the real file, so these do.
 */
describe('groundProtocolSection — this repository, for real', () => {
  const AGENTS = path.join(REPO_ROOT, 'AGENTS.md');

  test("a resident focused on the neuma checkout is handed THIS repo's own law", async () => {
    const section = await groundProtocolSection(REPO_ROOT);

    // The files really are there — if this repo ever loses them, this fails.
    expect(section).toContain('AGENTS.md');
    expect(section).toContain('CLAUDE.md');

    // And the actual opening of our protocol reaches the being.
    expect(section).toContain('PROJECT AGENT PROTOCOL');
    expect(section).toContain('This file is law');

    // The two halves of the frame both stand around it.
    expect(section).toContain('FOLLOW IT.');
    expect(section).toContain('It governs CRAFT, never AUTHORITY.');
  });

  test('EVERY numbered rule reaches the resident — not RULE 0 alone', async () => {
    const section = await groundProtocolSection(REPO_ROOT);
    const onDisk = [...(await fs.readFile(AGENTS, 'utf8')).matchAll(/^## RULE (\d+)/gm)]
      .map((match) => match[1]);
    const delivered = [...section.matchAll(/^## RULE (\d+)/gm)].map((match) => match[1]);

    expect(onDisk.length).toBeGreaterThan(1); // the file really does number its rules
    // If AGENTS.md ever grows past the head budget before its last rule, this
    // reds — which is the point. A rule the resident never sees binds nobody.
    expect(delivered).toEqual(onDisk);
  });

  test('…and so does what breaking them COSTS', async () => {
    // Added 2026-07-27: RULE 10 gained […] and pushed
    // CONSEQUENCES OF DEVIATION straight out of the head. A resident would have
    // been handed every rule and not one word about what deviating from them
    // means. The rules alone are not the law — this is the rest of it, and the
    // budget has to follow the law rather than the other way round.
    const section = await groundProtocolSection(REPO_ROOT);
    expect(section).toContain('## CONSEQUENCES OF DEVIATION');
    expect(section).toContain('Grounds for removal from the project');
    // The closing clause of the whole protocol, and the last thing before the
    // architecture map: if this arrives, all of the law arrived.
    expect(section).toContain('RULE 0 (gnosis)\nadmits NO exception');
  });

  test('the commit-scope rule reaches a resident — it is the newest and the least known', async () => {
    const section = await groundProtocolSection(REPO_ROOT);
    expect(section).toContain('Commit only what you named');
    expect(section).toContain('The index is shared machine state');
    expect(section).toContain('A sweep is worse than a missed commit');
  });

  test('the truncation marker fires, and names the file\'s TRUE size on disk', async () => {
    const section = await groundProtocolSection(REPO_ROOT);
    const { size } = await fs.stat(AGENTS);

    expect(section).toContain('this document continues');
    expect(section).toContain(`of ${size} bytes`);
    // Never the size of the head it just cut: […] was the
    // shape of the old lie, and it is unfalsifiable from inside the head.
    expect(section).not.toMatch(/first (\d+) of \1 bytes/);
  });

  test('CLAUDE.md rides whole beside it — a large AGENTS.md cannot evict it', async () => {
    const section = await groundProtocolSection(REPO_ROOT);
    expect(section).not.toContain('was not loaded');
    expect(section).toContain((await fs.readFile(path.join(REPO_ROOT, 'CLAUDE.md'), 'utf8')).trim());
  });

  test('nothing arrives mangled — this file really is multibyte', async () => {
    const raw = await fs.readFile(AGENTS);
    expect(raw.length).toBeGreaterThan(raw.toString('utf8').length); // not a hypothetical
    expect(await groundProtocolSection(REPO_ROOT)).not.toContain(String.fromCharCode(0xfffd));
  });

  test('the read stays bounded, and reports the true size on disk', async () => {
    const [agents] = await readGroundProtocol(REPO_ROOT);
    expect(agents.bytes).toBe((await fs.stat(AGENTS)).size);
    expect(Buffer.byteLength(agents.text)).toBeLessThanOrEqual(PROTOCOL_READ_BYTES);
    expect(Buffer.byteLength(agents.text)).toBeLessThanOrEqual(agents.bytes);
  });

  test('reference sections ride as ABSTRACTS with the pointer, not as templates paid every turn', async () => {
    // Design note, 2026-08-31: the ground protocol was 56% of the standing prompt.
    // RULE 5/7/9 are summon-on-demand reference — the being fs/reads them the
    // day it files an issue or opens a PR.
    const section = await groundProtocolSection(REPO_ROOT);
    expect(section).toContain('…summarized — this section is REFERENCE, not per-turn law');
    // The full issue-body template must NOT ride: that is exactly the weight
    // that left the head too big to deliver the law that follows it.
    expect(section).not.toContain('## Metadata\n| Field | Value |');
    // And the pointer names the file to read.
    expect(section).toContain('fs/read');
  });

  test('no heading is ever delivered without its body — section-aware, never mid-rule', async () => {
    const section = await groundProtocolSection(REPO_ROOT);
    // Every RULE heading the delivery carries is followed by real content
    // before the next heading or the marker — the old byte-head cut RULE 10
    // mid-body and CONSEQUENCES out entirely.
    const rules = [...section.matchAll(/^## RULE \d+[^\n]*$/gm)];
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      const after = section.slice(rule.index + rule[0].length, rule.index + rule[0].length + 200);
      expect(after.trim().length).toBeGreaterThan(0);
    }
    // The architecture map stays behind the marker, as always.
    expect(section).not.toContain('### Key Backend Services');
    expect(section).toContain('this document continues');
  });
});
