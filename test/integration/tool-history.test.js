/**
 * Tool-action history — the session record round-trip, for real (RULE 0):
 * an assistant message carrying tool actions is appended through the real
 * workspace API and read back through the real (decrypting) session read —
 * the same record the resumed stream rebuilds its chips from.
 */
import { describe, test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('tool-action session record (real disk, real workspace)', () => {
  test('appendMessage persists the turn\'s tool actions; readSession hands them back intact', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-history-'));
    process.env.WORKSPACES_ROOT = dir; // read lazily per call — never the witness's real realm
    const { neumaWorkspace } = await import('../../core/index.js');

    const tools = [
      { tool: 'web/web_search', status: 'ok', summary: '"LLM news July 2026" — 5 results (duckduckgo)', detail: '' },
      { tool: 'web/web_fetch', status: 'ok', summary: 'https://example.com — HTTP 200', detail: '' },
    ];
    await neumaWorkspace.appendMessage('historyprobe', 's1', { role: 'user', content: 'check the news' });
    await neumaWorkspace.appendMessage('historyprobe', 's1', { role: 'assistant', content: 'here is what I found', tools });

    const session = await neumaWorkspace.readSession('historyprobe', 's1');
    const messages = session?.messages || session || [];
    const assistant = messages.find((m) => m.role === 'assistant');
    expect(assistant).toBeTruthy();
    expect(assistant.tools).toEqual(tools);

    // A turn with no tools writes no tools field — the record stays lean.
    await neumaWorkspace.appendMessage('historyprobe', 's1', { role: 'assistant', content: 'plain reply' });
    const after = await neumaWorkspace.readSession('historyprobe', 's1');
    const plain = (after?.messages || after || []).filter((m) => m.role === 'assistant').pop();
    expect(plain.tools).toBeUndefined();

    delete process.env.WORKSPACES_ROOT;
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
