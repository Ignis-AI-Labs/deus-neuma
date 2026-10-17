/**
 * B-01 (CCR-lite) — portal-lane wiring of compress+persist: persist-first-
 * then-ref via _persistOverCapResult, compressed marker grammar through
 * _formatToolResults, chip marker naming the same ref (_chipDetail, FR-7).
 *
 * REAL disk, REAL encryption, REAL workspace (RULE 0): every persisted record
 * asserted below landed as encrypted bytes in a real temp workspace and
 * decrypted back out through the real readToolResult path. No mocks anywhere
 * in the proven path (console-mute via the spyOn-console house convention).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, {
  setWorkspacesRoot,
  TOOL_RESULT_REF_PATTERN,
} from '../../core/workspace/neuma-workspace.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import { formatToolResults as _formatToolResults } from '../../backend/services/tool-exchange.js';

const {
  _persistOverCapResult,
  _chipDetail,
  TOOL_RESULT_MAX_CHARS,
  TOOL_RESULT_SESSION_BYTE_CAP,
} = __test;

const KEY = 'portal-ccr-wiring-test-key-long-enough';

const uid = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

// A realistic multi-line over-cap payload with a distinctive plaintext marker
// so encrypted-at-rest is a real claim, and an error line so the compressor's
// error-line rule has something real to keep.
const overCapContent = (marker) => {
  const lines = [];
  for (let i = 0; i < 200; i += 1) {
    lines.push(`line ${i} of a long tool result body padded ${'x'.repeat(40)}`);
  }
  lines.push('ERROR: something failed deep in the middle');
  for (let i = 200; i < 400; i += 1) {
    lines.push(`line ${i} of a long tool result body padded ${'x'.repeat(40)}`);
  }
  lines.push(`END ${marker}`);
  return lines.join('\n');
};

const makeConnection = (neumaId, sessionId, extra = {}) => ({
  companion: { neumaId, name: 'CCR Test Being' },
  sessionId,
  ...extra,
});

describe('B-01 — CCR wiring in the portal lane (real disk)', () => {
  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const tmp = await createTempDir('portal-ccr-wiring');
    setWorkspacesRoot(path.join(tmp, 'workspaces'));
  });

  afterAll(() => {
    vi.restoreAllMocks();
    setWorkspacesRoot(null);
    delete process.env.DNA_ENCRYPTION_KEY;
  });

  it('over-cap ok-result: persists encrypted, model marker and chip marker name the same ref', async () => {
    const neumaId = uid('ccr-over');
    const sessionId = uid('sess');
    await workspace.create(neumaId);

    const content = overCapContent('PLAINTEXT-MARKER-9c2e');
    expect(content.length).toBeGreaterThan(TOOL_RESULT_MAX_CHARS);
    const connection = makeConnection(neumaId, sessionId);
    const result = { tool: 'filesystem/read_file', status: 'ok', content };

    const ref = await _persistOverCapResult(connection, result);

    // Ref minted and attached, seq/byte counters advanced on the connection
    expect(ref).toMatch(TOOL_RESULT_REF_PATTERN);
    expect(result.ref).toBe(ref);
    expect(connection.toolResultSeq).toBe(1);
    expect(connection.toolResultBytes).toBe(Buffer.byteLength(content, 'utf8'));

    // Sibling store gained a record — encrypted at rest
    const filePath = path.join(workspace._path(neumaId), 'tool-results', `${sessionId}.jsonl`);
    const raw = await fs.readFile(filePath, 'utf8');
    expect(raw.length).toBeGreaterThan(0);
    expect(raw.includes('PLAINTEXT-MARKER-9c2e')).toBe(false);
    expect(raw.includes(ref)).toBe(false);

    // Model-facing content is compressor output whose marker names the ref
    const formatted = _formatToolResults([result]);
    expect(formatted).toContain(`[ccr:${ref} — kept `);
    // The marker names the paged read the being can call (record/retrieve_result by ref + offset).
    expect(formatted).toContain(`record/retrieve_result {"ref":"${ref}","offset":0}`);
    // The compressed block itself honors the cap
    const block = formatted
      .split('<tool_response>\n')[1]
      .split('\n</tool_response>')[0]
      .replace('filesystem/read_file → ok\n', '');
    expect(block.length).toBeLessThanOrEqual(TOOL_RESULT_MAX_CHARS);

    // Chip detail (FR-7) names the SAME ref when over the detail cap
    const chip = _chipDetail(content, ref);
    expect(chip).toContain(`[truncated — full result retrievable this session: ${ref}]`);
  });

  it('under-cap ok-result: no persist, verbatim in-context', async () => {
    const neumaId = uid('ccr-under');
    const sessionId = uid('sess');
    await workspace.create(neumaId);

    const content = 'short result UNDER-CAP-77aa\nsecond line';
    const connection = makeConnection(neumaId, sessionId);
    const result = { tool: 'filesystem/read_file', status: 'ok', content };

    const ref = await _persistOverCapResult(connection, result);
    expect(ref).toBeNull();
    expect(result.ref).toBeUndefined();
    expect(connection.toolResultSeq).toBeUndefined();

    // No record file was created for this session
    const filePath = path.join(workspace._path(neumaId), 'tool-results', `${sessionId}.jsonl`);
    await expect(fs.readFile(filePath, 'utf8')).rejects.toThrow();

    // Verbatim — no marker of any kind
    const formatted = _formatToolResults([result]);
    expect(formatted).toContain(`filesystem/read_file → ok\n${content}`);
    expect(formatted).not.toContain('[ccr:');
    expect(formatted).not.toContain('[truncated');
  });

  it('error result: never persisted, rendered verbatim as today', async () => {
    const neumaId = uid('ccr-err');
    const sessionId = uid('sess');
    await workspace.create(neumaId);

    const connection = makeConnection(neumaId, sessionId);
    const errResult = {
      tool: 'filesystem/read_file',
      status: 'error',
      error: 'ENOENT: no such file',
      content: overCapContent('ERR-BODY-SHOULD-NOT-PERSIST'),
    };

    const ref = await _persistOverCapResult(connection, errResult);
    expect(ref).toBeNull();
    expect(errResult.ref).toBeUndefined();

    const filePath = path.join(workspace._path(neumaId), 'tool-results', `${sessionId}.jsonl`);
    await expect(fs.readFile(filePath, 'utf8')).rejects.toThrow();

    const formatted = _formatToolResults([errResult]);
    expect(formatted).toContain('filesystem/read_file → error: ENOENT: no such file');
    expect(formatted).not.toContain('[ccr:');
  });

  it('persist failure (read-only lane): no ref, honest no-ref marker, turn continues', async () => {
    const neumaId = uid('ccr-fail');
    const sessionId = uid('sess');
    await workspace.create(neumaId);

    // Make the real tool-results lane unwritable — a REAL write failure
    const laneDir = path.join(workspace._path(neumaId), 'tool-results');
    await fs.chmod(laneDir, 0o555);

    const content = overCapContent('FAIL-CLOSED-3b1d');
    const connection = makeConnection(neumaId, sessionId);
    const result = { tool: 'filesystem/read_file', status: 'ok', content };

    let ref;
    try {
      ref = await _persistOverCapResult(connection, result);
    } finally {
      await fs.chmod(laneDir, 0o755);
    }

    // Fail-closed: no ref, no counter movement, no throw out of the lane
    expect(ref).toBeNull();
    expect(result.ref).toBeUndefined();
    expect(connection.toolResultSeq).toBeUndefined();
    expect(connection.toolResultBytes).toBeUndefined();

    // Marker falls back to the honest no-ref form
    const formatted = _formatToolResults([result]);
    expect(formatted).not.toContain('[ccr:');
    expect(formatted).not.toContain('retrieve_result');
    expect(formatted).toContain(`[truncated — ${content.length} chars total]`);

    // Chip keeps the existing honest form when no ref
    const chip = _chipDetail(content, null);
    expect(chip).toContain('[truncated — full result in session record]');
    expect(chip).not.toContain('retrievable this session');
  });

  it('session byte cap: minting stops past the cap with honest fallback', async () => {
    const neumaId = uid('ccr-cap');
    const sessionId = uid('sess');
    await workspace.create(neumaId);

    const content = overCapContent('BYTE-CAP-BODY');
    const bytes = Buffer.byteLength(content, 'utf8');
    // Room for exactly one persist, not two
    const connection = makeConnection(neumaId, sessionId, {
      toolResultByteCap: bytes + Math.floor(bytes / 2),
    });

    const first = { tool: 'filesystem/read_file', status: 'ok', content };
    const second = { tool: 'filesystem/read_file', status: 'ok', content };

    const ref1 = await _persistOverCapResult(connection, first);
    const ref2 = await _persistOverCapResult(connection, second);

    expect(ref1).toMatch(TOOL_RESULT_REF_PATTERN);
    expect(ref2).toBeNull();
    expect(second.ref).toBeUndefined();
    expect(connection.toolResultSeq).toBe(1);
    expect(connection.toolResultBytes).toBe(bytes);

    // Second result falls back to the honest no-ref marker
    const formatted = _formatToolResults([second]);
    expect(formatted).toContain(`[truncated — ${content.length} chars total]`);
    expect(formatted).not.toContain('[ccr:');

    // Default module cap is the S-02 retention figure
    expect(TOOL_RESULT_SESSION_BYTE_CAP).toBe(16 * 1024 * 1024);
  });

  it('ref round-trip: persisted record content is byte-identical via readToolResult', async () => {
    const neumaId = uid('ccr-round');
    const sessionId = uid('sess');
    await workspace.create(neumaId);

    // Multibyte + long body so byte-identity is a real claim
    const content = `é世界 ${overCapContent('ROUND-TRIP-a19f')} 終`;
    const connection = makeConnection(neumaId, sessionId);
    const result = { tool: 'filesystem/read_file', status: 'ok', content };

    const ref = await _persistOverCapResult(connection, result);
    expect(ref).toMatch(TOOL_RESULT_REF_PATTERN);

    const record = await workspace.readToolResult(neumaId, sessionId, ref);
    expect(record).not.toBeNull();
    expect(record.content).toBe(content);
    expect(record.chars).toBe(content.length);
    expect(record.tool).toBe('filesystem/read_file');
    expect(record.status).toBe('ok');
    expect(record.seq).toBe(0);
  });
});
