import { describe, test, expect } from 'vitest';
import {
  openTurnRecord, markTurnText, collectToolAction, turnRecordFor, closeTurnRecord,
} from '../../backend/services/tool-action-record.js';

// The record is the seam between the live chips and the session record: result
// events land, 'executing' opens do not, a long action holds ONE row, every act
// carries where in the answer it happened, and a fresh turn starts empty.

describe('the turn\'s tool-action record', () => {
  test('result events land compactly; executing opens are skipped', () => {
    const ws = {};
    openTurnRecord(ws);
    collectToolAction(ws, { tool: 'web/web_search', status: 'executing' });
    collectToolAction(ws, { tool: 'web/web_search', status: 'ok', summary: '5 results' });
    collectToolAction(ws, { tool: 'web/web_fetch', status: 'error', summary: 'failed', detail: 'refused' });
    expect(turnRecordFor(ws)).toEqual([
      { tool: 'web/web_search', status: 'ok', summary: '5 results', detail: '', mark: 0 },
      { tool: 'web/web_fetch', status: 'error', summary: 'failed', detail: 'refused', mark: 0 },
    ]);
    closeTurnRecord(ws);
  });

  test('no open record → nothing is held (events outside a turn)', () => {
    const ws = {};
    collectToolAction(ws, { tool: 'web/web_search', status: 'ok' });
    expect(turnRecordFor(ws)).toEqual([]);
  });

  test('a missing status defaults to ok; a missing tool is dropped', () => {
    const ws = {};
    openTurnRecord(ws);
    collectToolAction(ws, { tool: 'tasks/task_add' });
    collectToolAction(ws, { status: 'ok' });
    expect(turnRecordFor(ws)).toEqual([
      { tool: 'tasks/task_add', status: 'ok', summary: '', detail: '', mark: 0 },
    ]);
    closeTurnRecord(ws);
  });

  // Design note, 2026-08-05, on a chat re-opened after a restart: […]
  test('each act records how much of the answer stood written when it happened', () => {
    const ws = {};
    openTurnRecord(ws);
    markTurnText(ws, 42);
    collectToolAction(ws, { tool: 'image/generate_image', status: 'ok', summary: 'generated 1 image(s)' });
    markTurnText(ws, 117);
    collectToolAction(ws, { tool: 'image/review_image', status: 'ok', summary: 'reviewed' });
    expect(turnRecordFor(ws).map((a) => [a.tool, a.mark])).toEqual([
      ['image/generate_image', 42],
      ['image/review_image', 117],
    ]);
    closeTurnRecord(ws);
  });

  // The screenshot that opened this work: one render came back from a restart
  // as seven finished rows, where the live view had shown one filling bar.
  test('a long action holds ONE row — progress fills it, the result replaces it', () => {
    const ws = {};
    openTurnRecord(ws);
    markTurnText(ws, 30);
    for (const pct of [3, 20, 40, 60, 80, 100]) {
      collectToolAction(ws, { tool: 'image/generate_image', status: 'running', summary: `rendering — ${pct}%` });
    }
    collectToolAction(ws, {
      tool: 'image/generate_image',
      status: 'ok',
      summary: 'generated 1 image(s) — 1822KB image/png',
      images: [{ imageId: 'img-1', url: '/api/v1/image-forge/images/img-1', mime: 'image/png' }],
    });
    const record = turnRecordFor(ws);
    expect(record).toHaveLength(1);
    expect(record[0]).toMatchObject({
      tool: 'image/generate_image',
      status: 'ok',
      summary: 'generated 1 image(s) — 1822KB image/png',
      mark: 30,
    });
    // What it MADE rides the record, so the render is still in the conversation.
    expect(record[0].images).toEqual([
      { imageId: 'img-1', url: '/api/v1/image-forge/images/img-1', mime: 'image/png' },
    ]);
    closeTurnRecord(ws);
  });

  test('the same tool used twice keeps two rows, each at its own position', () => {
    const ws = {};
    openTurnRecord(ws);
    markTurnText(ws, 10);
    collectToolAction(ws, { tool: 'image/generate_image', status: 'running', summary: 'rendering — 50%' });
    collectToolAction(ws, { tool: 'image/generate_image', status: 'ok', summary: 'first' });
    markTurnText(ws, 60);
    collectToolAction(ws, { tool: 'image/generate_image', status: 'running', summary: 'rendering — 50%' });
    collectToolAction(ws, { tool: 'image/generate_image', status: 'ok', summary: 'second' });
    expect(turnRecordFor(ws).map((a) => [a.summary, a.mark])).toEqual([
      ['first', 10],
      ['second', 60],
    ]);
    closeTurnRecord(ws);
  });

  test('a settled row is never folded into — a repeat of a finished tool is its own act', () => {
    const ws = {};
    openTurnRecord(ws);
    collectToolAction(ws, { tool: 'web/web_fetch', status: 'ok', summary: 'page one' });
    collectToolAction(ws, { tool: 'web/web_fetch', status: 'ok', summary: 'page two' });
    expect(turnRecordFor(ws).map((a) => a.summary)).toEqual(['page one', 'page two']);
    closeTurnRecord(ws);
  });

  test('sources and images are omitted when there are none — the old shape, unchanged', () => {
    const ws = {};
    openTurnRecord(ws);
    collectToolAction(ws, { tool: 'tasks/task_add', status: 'ok', summary: 'added' });
    expect(Object.keys(turnRecordFor(ws)[0]).sort()).toEqual(['detail', 'mark', 'status', 'summary', 'tool']);
    closeTurnRecord(ws);
  });

  test('a benchmark launched from the chat keeps its run on the record — the card reads it on resume', () => {
    const ws = {};
    openTurnRecord(ws);
    const bench = { comparisonId: 'desk-2026-10-15t10-30-19', cell: 'smoke', arms: ['bare', 'harness'] };
    collectToolAction(ws, { tool: 'bench/bench_run', status: 'ok', summary: 'launched smoke · bare + harness', bench });
    collectToolAction(ws, { tool: 'bench/bench_list', status: 'ok', summary: '43 benchmarks', bench: {} });
    const [launched, listed] = turnRecordFor(ws);
    expect(launched.bench).toEqual(bench);
    expect(listed).not.toHaveProperty('bench'); // no run, no field — the old shape
    closeTurnRecord(ws);
  });

  test('a closed turn releases the record, and a mark cannot outlive it', () => {
    const ws = {};
    openTurnRecord(ws);
    markTurnText(ws, 99);
    closeTurnRecord(ws);
    markTurnText(ws, 500); // outside a turn: no record to move
    openTurnRecord(ws);
    collectToolAction(ws, { tool: 'tasks/task_add', status: 'ok' });
    expect(turnRecordFor(ws)).toEqual([
      { tool: 'tasks/task_add', status: 'ok', summary: '', detail: '', mark: 0 },
    ]);
    closeTurnRecord(ws);
  });
});
