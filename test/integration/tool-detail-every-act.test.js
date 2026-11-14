// EVERY ACT OPENS TO WHAT IT RETURNED (Design note, 2026-11-14: […]). Some three dozen platform tools raised
// a finished chip with a summary and nothing to open ([…], […]).
//
// The REAL tool loop (processToolCalls) runs a REAL platform tool that raises such a chip (the
// vault's list: summary only) against a REAL encrypted workspace on a REAL disk; the ws is the
// injected event sink production passes. Proven: the bare chip is followed by tool:detail carrying
// what the being was handed, and the turn record holds it for a resumed chat. Then the desk's REAL
// reducer: the detail fills that chip, a chip with its own detail keeps it, and with no reply
// streaming nothing is invented.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { processToolCalls } from '../../backend/services/portal-tool-loop.js';
import { openTurnRecord, turnRecordFor, closeTurnRecord } from '../../backend/services/tool-action-record.js';
import { reducer, initialState } from '../../frontend/app/RelinkShell/stream-reducer.js';

const KEY = 'gnosis-tool-detail-key-long-enough-ok';
let prevKey; let oldRoot; let neumaId;

beforeAll(async () => {
  prevKey = process.env.DNA_ENCRYPTION_KEY;
  process.env.DNA_ENCRYPTION_KEY = KEY;
  oldRoot = getWorkspacesRoot();
  setWorkspacesRoot(path.join(await createTempDir('tool-detail'), 'workspaces'));
  neumaId = `detail-proof-${Math.floor(Math.random() * 1e9).toString(36)}`;
  await workspace.create(neumaId);
});

afterAll(() => {
  setWorkspacesRoot(oldRoot);
  if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
  else process.env.DNA_ENCRYPTION_KEY = prevKey;
});

describe('a platform tool whose chip came up bare', () => {
  it('is followed by its result as tool:detail, and the turn record keeps it', async () => {
    const events = [];
    const ws = { send: (raw) => events.push(JSON.parse(raw)), readyState: 1 };
    const connection = { companion: { name: 'Prooflet', neumaId }, toolMode: 'auto', _sessionToolPolicy: null };
    openTurnRecord(ws);
    try {
      const results = await processToolCalls(ws, '', connection, [{ server: 'vault', toolName: 'vault_list', args: {} }]);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('ok');
      const chip = events.find((e) => e.type === 'tool:usage' && e.status === 'ok');
      expect(chip?.tool).toBe('vault/vault_list');
      expect(chip.detail).toBeUndefined(); // the bare chip this fix exists for
      const detail = events.find((e) => e.type === 'tool:detail');
      expect(detail).toEqual({ type: 'tool:detail', tool: 'vault/vault_list', detail: results[0].content });
      expect(detail.detail).toMatch(/vault is empty/i);
      expect(events.indexOf(detail)).toBeGreaterThan(events.indexOf(chip));
      const record = turnRecordFor(ws);
      expect(record.at(-1)).toMatchObject({ tool: 'vault/vault_list', status: 'ok', detail: results[0].content });
    } finally {
      closeTurnRecord?.(ws);
    }
  }, 30_000);
});

describe('the desk fills the chip', () => {
  const streamingWith = (...results) => results.reduce(
    (state, data) => reducer(state, { type: 'TOOL_RESULT', data }),
    reducer(initialState, { type: 'SPEECH', text: 'Let me check the book.' }),
  );
  const tools = (state) => state.messages.at(-1).segments.filter((s) => s.kind === 'tool');

  it('a bare chip takes the detail; the newest chip of that tool is the one filled', () => {
    let state = streamingWith(
      { tool: 'lp/book_read', status: 'ok', summary: 'book read' },
      { tool: 'lp/market_read', status: 'ok', summary: 'market read' },
      { tool: 'lp/book_read', status: 'ok', summary: 'book read' },
    );
    state = reducer(state, { type: 'TOOL_DETAIL', data: { tool: 'lp/book_read', detail: 'position $480.43, in range' } });
    const [first, market, second] = tools(state);
    expect(second.detail).toBe('position $480.43, in range');
    expect(first.detail).toBe('');
    expect(market.detail).toBe('');
  });

  it('a chip with its own detail keeps it', () => {
    let state = streamingWith({ tool: 'fs/read', status: 'ok', summary: 'read a.md', detail: 'the file itself' });
    state = reducer(state, { type: 'TOOL_DETAIL', data: { tool: 'fs/read', detail: 'something else' } });
    expect(tools(state)[0].detail).toBe('the file itself');
  });

  it('with no reply streaming, nothing is invented', () => {
    const state = reducer(initialState, { type: 'TOOL_DETAIL', data: { tool: 'lp/book_read', detail: 'x' } });
    expect(state).toBe(initialState);
  });
});
