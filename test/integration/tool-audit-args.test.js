/**
 * The action trail records WHAT was touched — for real (RULE 0).
 *
 * `logToolCall` is the one function every governed reach crosses on its way
 * into the being's permanent record: the sandbox calls it on success, on
 * truncation, and on every denial, and the approval broker calls it when a
 * witness says no. Until 2026-07-26 it accepted `args` and dropped them, so
 * the journal could say `filesystem/write_file — success` and never which
 * path was written. An audit trail that cannot answer […] is
 * a log, not a trail.
 *
 * No mock stands anywhere in this path: the real workspace engine writes a
 * real JSONL journal to a real temp root, and the assertions read that file
 * back through the real read API.
 */
import { describe, test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const NEUMA = 'auditprobe';

const withRealWorkspace = async (run) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-audit-'));
  const saved = process.env.WORKSPACES_ROOT;
  process.env.WORKSPACES_ROOT = dir; // read lazily per call — never the witness's real realm
  try {
    const { neumaWorkspace } = await import('../../core/index.js');
    const { logToolCall } = await import('../../backend/services/tool-sandbox.js');
    return await run({ neumaWorkspace, logToolCall });
  } finally {
    if (saved === undefined) delete process.env.WORKSPACES_ROOT;
    else process.env.WORKSPACES_ROOT = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

describe('tool audit trail — arguments reach the journal, secrets do not', () => {
  test('a real write lands in a real journal carrying the real path', async () => {
    await withRealWorkspace(async ({ neumaWorkspace, logToolCall }) => {
      await logToolCall(
        neumaWorkspace, NEUMA, 'filesystem', 'write_file',
        { path: '/tmp/lane/record.md', content: 'the being writes itself' },
        'success', null,
      );

      const entries = await neumaWorkspace.readJournal(NEUMA);
      expect(entries).toHaveLength(1);
      const [entry] = entries;

      expect(entry.type).toBe('tool_call');
      expect(entry.content).toBe('filesystem/write_file — success');
      expect(entry.timestamp).toBeTruthy();
      expect(entry.metadata.server).toBe('filesystem');
      expect(entry.metadata.tool).toBe('write_file');
      expect(entry.metadata.status).toBe('success');

      // The point of the whole change: the path is answerable from the record.
      expect(entry.metadata.args).toContain('/tmp/lane/record.md');
      expect(entry.metadata.args).toContain('the being writes itself');
    });
  });

  test('a denial is recorded with its reason AND its arguments', async () => {
    await withRealWorkspace(async ({ neumaWorkspace, logToolCall }) => {
      await logToolCall(
        neumaWorkspace, NEUMA, 'filesystem', 'read_file',
        { path: '/etc/shadow' },
        'denied', 'Path is outside the allowed roots',
      );

      const [entry] = await neumaWorkspace.readJournal(NEUMA);
      expect(entry.content).toBe('filesystem/read_file — denied: Path is outside the allowed roots');
      expect(entry.significance).toBe(0.8); // a denial is louder than a success
      expect(entry.metadata.args).toContain('/etc/shadow');
    });
  });

  test('a credential passed as an argument never reaches the disk', async () => {
    await withRealWorkspace(async ({ neumaWorkspace, logToolCall }) => {
      const LIVE_KEY = 'sk-thiskeymustneverbewrittendown0123456789';
      await logToolCall(
        neumaWorkspace, NEUMA, 'http', 'post',
        { url: 'https://api.example/v1/send', apiKey: LIVE_KEY, retries: 2 },
        'success', null,
      );

      const [entry] = await neumaWorkspace.readJournal(NEUMA);
      expect(entry.metadata.args).toContain('https://api.example/v1/send');
      expect(entry.metadata.args).toContain('[redacted]');
      expect(entry.metadata.args).not.toContain(LIVE_KEY);

      // And not anywhere else in the file either — the assertion above only
      // covers the field we happened to read.
      const journalFile = path.join(
        process.env.WORKSPACES_ROOT, NEUMA, 'journal', 'entries.jsonl',
      );
      expect(fs.readFileSync(journalFile, 'utf8')).not.toContain(LIVE_KEY);
    });
  });

  test('an argument-free call writes no args field — the record stays lean', async () => {
    await withRealWorkspace(async ({ neumaWorkspace, logToolCall }) => {
      await logToolCall(neumaWorkspace, NEUMA, 'coding', 'sandbox_status', {}, 'success', null);
      const [entry] = await neumaWorkspace.readJournal(NEUMA);
      expect(entry.metadata.args).toBeUndefined();
    });
  });

  test('a huge write does not turn the ledger into a copy of the file', async () => {
    await withRealWorkspace(async ({ neumaWorkspace, logToolCall }) => {
      await logToolCall(
        neumaWorkspace, NEUMA, 'filesystem', 'write_file',
        { path: '/tmp/big.txt', content: 'z'.repeat(500_000) },
        'success', null,
      );
      const [entry] = await neumaWorkspace.readJournal(NEUMA);
      expect(entry.metadata.args).toContain('/tmp/big.txt');
      expect(entry.metadata.args).toContain('chars]'); // the honest length marker
      expect(entry.metadata.args.length).toBeLessThan(3000);
    });
  });
});
