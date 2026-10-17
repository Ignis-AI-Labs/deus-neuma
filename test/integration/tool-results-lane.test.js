// S-02 (CCR-lite) — tool-results sibling store: appendToolResult / readToolResult /
// sweepToolResults + tr_ ref mint. REAL disk, REAL encryption, REAL compaction,
// REAL concurrency (RULE 0): every assertion below watched real bytes land in a
// real temp workspace and decrypt back out. No mocks anywhere in the proven path
// (console-mute via the spyOn-console house convention, not a path mock).

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, {
  setWorkspacesRoot,
  mintToolResultRef,
  TOOL_RESULT_REF_PATTERN,
} from '../../core/workspace/neuma-workspace.js';

const KEY = 'tool-results-lane-test-key-long-enough';

const sid8Of = (sessionId) =>
  crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 8);

const uid = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

describe('S-02 — tool-results lane (CCR-lite sibling store)', () => {
  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const tmp = await createTempDir('tool-results-lane');
    setWorkspacesRoot(path.join(tmp, 'workspaces'));
  });
  afterAll(() => {
    vi.restoreAllMocks();
    setWorkspacesRoot(null);
    delete process.env.DNA_ENCRYPTION_KEY;
  });

  it('create() lays down the tool-results/ lane dir', async () => {
    const id = uid('trl-create');
    await workspace.create(id);
    const stat = await fs.stat(path.join(workspace._path(id), 'tool-results'));
    expect(stat.isDirectory()).toBe(true);
  });

  it('append round-trip: record persists encrypted on disk and decrypts byte-identical', async () => {
    const id = uid('trl-round');
    const sessionId = uid('sess');
    await workspace.create(id);

    // Distinctive multibyte + control-ish content so byte-identity is a real claim
    const content = 'LINE-1 result body é世界 ' + 'x'.repeat(5000) + ' END-MARKER-7f3a';
    const ref = mintToolResultRef(sessionId, 0);
    await workspace.appendToolResult(id, sessionId, {
      ref, seq: 0, tool: 'read_file', status: 'ok', content, chars: content.length,
    });

    const filePath = path.join(workspace._path(id), 'tool-results', `${sessionId}.jsonl`);
    const raw = await fs.readFile(filePath, 'utf8');
    expect(raw.length).toBeGreaterThan(0);
    // Encrypted at rest: the plaintext marker must NOT appear in the raw bytes
    expect(raw.includes('END-MARKER-7f3a')).toBe(false);

    const record = await workspace.readToolResult(id, sessionId, ref);
    expect(record).not.toBeNull();
    expect(record.content).toBe(content); // byte-identical after decrypt
    expect(record.tool).toBe('read_file');
    expect(record.status).toBe('ok');
    expect(record.seq).toBe(0);
    expect(record.chars).toBe(content.length);
    expect(typeof record.timestamp).toBe('string');
    expect(await workspace.readToolResults(id, sessionId)).toEqual([record]);
  });

  it('minted refs conform to the frozen pattern and bind sid8 to the session', () => {
    const sessionId = 'sess-regex-check';
    for (let seq = 0; seq < 20; seq += 1) {
      const ref = mintToolResultRef(sessionId, seq);
      expect(ref).toMatch(TOOL_RESULT_REF_PATTERN);
      expect(ref.slice(3, 11)).toBe(sid8Of(sessionId));
      expect(ref.split('_')[2]).toBe(String(seq));
    }
    // Same inputs mint distinct handles (rand8 entropy — refs are handles, not hashes)
    expect(mintToolResultRef(sessionId, 1)).not.toBe(mintToolResultRef(sessionId, 1));
  });

  it('authz refusal: a ref minted for session A returns null under session B; malformed refs return null', async () => {
    const id = uid('trl-authz');
    const sessionA = uid('sess-a');
    const sessionB = uid('sess-b');
    await workspace.create(id);

    const refA = mintToolResultRef(sessionA, 0);
    await workspace.appendToolResult(id, sessionA, {
      ref: refA, seq: 0, tool: 'web_search', status: 'ok', content: 'secret-of-session-a', chars: 19,
    });
    // Session B also has a store, so the null can't be blamed on a missing file
    await workspace.appendToolResult(id, sessionB, {
      ref: mintToolResultRef(sessionB, 0), seq: 0, tool: 'web_search', status: 'ok', content: 'b-content', chars: 9,
    });

    // Foreign ref: sid8 compare rejects before any content could leak
    expect(await workspace.readToolResult(id, sessionB, refA)).toBeNull();
    // Own session still resolves
    expect((await workspace.readToolResult(id, sessionA, refA)).content).toBe('secret-of-session-a');

    // Malformed refs — every shape violation resolves to null
    for (const bad of [
      '', 'tr_', 'not-a-ref', `tr_${sid8Of(sessionA)}_0`, // missing rand8
      `tr_${sid8Of(sessionA)}_0_ZZZZZZZZ`,                 // non-hex rand8
      `tr_${sid8Of(sessionA).toUpperCase()}_0_aabbccdd`,   // uppercase sid8
      `tr_${sid8Of(sessionA)}_x_aabbccdd`,                 // non-numeric seq
      refA + '\n' + refA,                                  // injection-shaped
      null, undefined, 42,
    ]) {
      expect(await workspace.readToolResult(id, sessionA, bad)).toBeNull();
    }
    // Well-formed but never-minted ref → null (not found, no throw)
    expect(await workspace.readToolResult(id, sessionA, `tr_${sid8Of(sessionA)}_99_aabbccdd`)).toBeNull();
  });

  it('compaction survival: session file shrinks, tool-result ref still resolves to full content', async () => {
    const id = uid('trl-compact');
    const sessionId = uid('sess');
    await workspace.create(id);

    const fullContent = 'FULL-RESULT ' + 'payload '.repeat(2000); // ~16KB, well over any in-context cap
    const ref = mintToolResultRef(sessionId, 3);
    await workspace.appendToolResult(id, sessionId, {
      ref, seq: 3, tool: 'read_file', status: 'ok', content: fullContent, chars: fullContent.length,
    });

    for (let i = 0; i < 120; i += 1) {
      await workspace.appendMessage(id, sessionId, { role: i % 2 ? 'assistant' : 'user', content: `msg ${i}` });
    }
    const sessionPath = path.join(workspace._path(id), 'sessions', `${sessionId}.jsonl`);
    const sizeBefore = (await fs.stat(sessionPath)).size;

    const compacted = await workspace.compactSession(id, sessionId, { threshold: 100, keepRecent: 20 });
    expect(compacted).toBe(true);
    const sizeAfter = (await fs.stat(sessionPath)).size;
    expect(sizeAfter).toBeLessThan(sizeBefore); // conversation record genuinely shrank

    // The sibling store is outside compaction's path — the ref survives by construction
    const record = await workspace.readToolResult(id, sessionId, ref);
    expect(record).not.toBeNull();
    expect(record.content).toBe(fullContent);
  });

  it('concurrency: parallel appendToolResult + appendMessage + compactSession leaves every tool-result line intact', async () => {
    const id = uid('trl-conc');
    const sessionId = uid('sess');
    await workspace.create(id);

    // Seed past the compaction threshold so the racing compactSession really runs
    for (let i = 0; i < 110; i += 1) {
      await workspace.appendMessage(id, sessionId, { role: 'user', content: `seed ${i}` });
    }

    const refs = Array.from({ length: 8 }, (_, i) => mintToolResultRef(sessionId, i));
    await Promise.all([
      ...refs.map((ref, i) => workspace.appendToolResult(id, sessionId, {
        ref, seq: i, tool: 'bash', status: 'ok', content: `parallel-result-${i} ` + 'z'.repeat(1000), chars: 1000,
      })),
      workspace.appendMessage(id, sessionId, { role: 'user', content: 'RACING-APPEND' }),
      workspace.compactSession(id, sessionId, { threshold: 100, keepRecent: 20 }),
    ]);

    // Every tool result written during the race resolves to its full content
    for (let i = 0; i < refs.length; i += 1) {
      const record = await workspace.readToolResult(id, sessionId, refs[i]);
      expect(record).not.toBeNull();
      expect(record.content.startsWith(`parallel-result-${i} `)).toBe(true);
    }
    // And every line in the sibling file is a whole, parseable envelope
    const raw = await fs.readFile(path.join(workspace._path(id), 'tool-results', `${sessionId}.jsonl`), 'utf8');
    const lines = raw.split('\n').filter(l => l.trim());
    expect(lines.length).toBe(refs.length);
    for (const line of lines) JSON.parse(line); // throws on a torn line
    // The racing conversation append survived compaction too (existing #121 guarantee holds)
    const messages = await workspace.readSession(id, sessionId);
    expect(messages.some(m => m.content === 'RACING-APPEND')).toBe(true);
  });

  it('sweep: removes only files older than ttlMs, keeps fresh ones, tolerates a missing dir', async () => {
    const id = uid('trl-sweep');
    const oldSession = uid('sess-old');
    const freshSession = uid('sess-new');
    await workspace.create(id);

    await workspace.appendToolResult(id, oldSession, {
      ref: mintToolResultRef(oldSession, 0), seq: 0, tool: 'bash', status: 'ok', content: 'stale', chars: 5,
    });
    const freshRef = mintToolResultRef(freshSession, 0);
    await workspace.appendToolResult(id, freshSession, {
      ref: freshRef, seq: 0, tool: 'bash', status: 'ok', content: 'fresh', chars: 5,
    });

    // Age the old file 31 days into the past with a REAL mtime change
    const oldPath = path.join(workspace._path(id), 'tool-results', `${oldSession}.jsonl`);
    const past = new Date(Date.now() - 31 * 24 * 3600 * 1000);
    await fs.utimes(oldPath, past, past);

    const removed = await workspace.sweepToolResults(id); // default 30-day TTL
    expect(removed).toBe(1);
    await expect(fs.access(oldPath)).rejects.toThrow(); // stale file genuinely gone
    expect((await workspace.readToolResult(id, freshSession, freshRef)).content).toBe('fresh');

    // Missing dir never throws
    const emptyId = uid('trl-sweep-empty');
    await workspace.create(emptyId);
    await fs.rm(path.join(workspace._path(emptyId), 'tool-results'), { recursive: true });
    expect(await workspace.sweepToolResults(emptyId)).toBe(0);
  });

  it('corruption isolation: garbage in the tool-results file never touches readSession', async () => {
    const id = uid('trl-corrupt');
    const sessionId = uid('sess');
    await workspace.create(id);

    await workspace.appendMessage(id, sessionId, { role: 'user', content: 'conversation-intact' });
    await workspace.appendToolResult(id, sessionId, {
      ref: mintToolResultRef(sessionId, 0), seq: 0, tool: 'bash', status: 'ok', content: 'ok-result', chars: 9,
    });

    // Corrupt the SIBLING file with raw garbage (simulates torn write / manual edit)
    const toolResultsPath = path.join(workspace._path(id), 'tool-results', `${sessionId}.jsonl`);
    await fs.appendFile(toolResultsPath, 'not json at all {{{\n');

    // The conversation record is a different file — reads stay clean
    const messages = await workspace.readSession(id, sessionId);
    expect(messages.length).toBe(1);
    expect(messages[0].content).toBe('conversation-intact');
  });

  // WS-101 (#147) — one torn line inside a file must not brick the read of the
  // healthy records around it. Real disk, real encryption envelopes.
  it('torn-line resilience: records around a corrupt line still read (tool-results + session)', async () => {
    const id = uid('trl-torn');
    const sessionId = uid('sess');
    await workspace.create(id);

    // tool-results lane: 2 valid, garbage in the middle, 1 valid after
    const refBefore = mintToolResultRef(sessionId, 0);
    const refAfter = mintToolResultRef(sessionId, 2);
    await workspace.appendToolResult(id, sessionId, {
      ref: refBefore, seq: 0, tool: 'bash', status: 'ok', content: 'before-1', chars: 8,
    });
    await workspace.appendToolResult(id, sessionId, {
      ref: mintToolResultRef(sessionId, 1), seq: 1, tool: 'bash', status: 'ok', content: 'before-2', chars: 8,
    });
    const toolResultsPath = path.join(workspace._path(id), 'tool-results', `${sessionId}.jsonl`);
    await fs.appendFile(toolResultsPath, 'torn{{{ mid-append crash\n');
    await workspace.appendToolResult(id, sessionId, {
      ref: refAfter, seq: 2, tool: 'bash', status: 'ok', content: 'after', chars: 5,
    });

    // Pre-corruption AND post-corruption refs both resolve; the torn line is skipped
    expect((await workspace.readToolResult(id, sessionId, refBefore)).content).toBe('before-1');
    expect((await workspace.readToolResult(id, sessionId, refAfter)).content).toBe('after');

    // readSession sibling: same resilience on the conversation file itself
    await workspace.appendMessage(id, sessionId, { role: 'user', content: 'msg-1' });
    const sessionPath = path.join(workspace._path(id), 'sessions', `${sessionId}.jsonl`);
    await fs.appendFile(sessionPath, 'also not an envelope\n');
    await workspace.appendMessage(id, sessionId, { role: 'assistant', content: 'msg-2' });

    const messages = await workspace.readSession(id, sessionId);
    expect(messages.map((m) => m.content)).toEqual(['msg-1', 'msg-2']);
  });
});

describe('sessionId path-traversal defense (Rule 8)', () => {
  it('rejects traversal-shaped sessionIds on append and read', async () => {
    const id = 'traversal-guard-neuma';
    await workspace.create(id);
    const evil = '../../escape';
    await expect(
      workspace.appendToolResult(id, evil, {
        ref: 'tr_aabbccdd_1_deadbeef', seq: 1, tool: 't', status: 'ok', content: 'c', chars: 1
      })
    ).rejects.toThrow(/Invalid sessionId/);
    // For read, the sid8 check must not mask the path guard: mint a ref whose
    // sid8 genuinely matches the traversal-shaped sessionId, so resolution
    // reaches the filesystem boundary — and the lane guard throws there.
    const evilSid8 = crypto.createHash('sha256').update(evil).digest('hex').slice(0, 8);
    // Read contract: unreadable/invalid resolves null (the guard throws before
    // any fs op and the read path's catch converts it) — fail-closed, no leak.
    await expect(
      workspace.readToolResult(id, evil, `tr_${evilSid8}_1_deadbeef`)
    ).resolves.toBeNull();
  });
});
