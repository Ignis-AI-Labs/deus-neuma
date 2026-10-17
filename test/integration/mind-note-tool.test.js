// Phase 1B write paths of the mind layer, proven on the REAL stack (RULE 0):
// (1) the residue hook — crystallizeObservation (the honest MEM-002 seam, the
//     production caller is streamConsciousness) leaves a mind record for a
//     sub-threshold exchange and none for a crystallized or noise one;
// (2) mind_note — the being's own hand, through the real policy cascade and
//     the real encrypted store. The ports are the dispatcher's injection seam
//     (refinement-being-tools contract); the frame collector is an output we
//     assert on, never a stand-in for the path under claim.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { WorkspaceAdapter } from '../../core/continuity/adapters/workspace.js';
import { activeMindRecords } from '../../core/continuity/mind/mind-store.js';
import { MIND_PHRASE_MAX } from '../../core/continuity/mind/mind-record.js';
import { crystallizeObservation } from '../../backend/services/portal-turn-persist.js';
import { handleMindNoteTool, MIND_NOTE_TOOL } from '../../backend/services/mind-tools.js';

const KEY = 'gnosis-mind-note-tool-key-long-enough';

// The dispatcher's injection seam, with a collector where the socket would be.
const makePorts = (frames) => ({
  sendToolEvent: (_ws, _companion, evt) => frames.push(evt),
});

const makeConnection = (neumaId, overrides = {}) => ({
  companion: { neumaId, name: 'Test Being' },
  space: null,
  sessionId: 'session-mind-test',
  _sessionToolPolicy: null,
  activeTurn: null,
  ...overrides,
});

describe('mind layer write paths — residue hook + mind_note (no mock)', () => {
  let prevKey;
  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const root = await createTempDir('mind-note-tool');
    setWorkspacesRoot(path.join(root, 'workspaces'));
  });
  afterAll(() => {
    vi.restoreAllMocks();
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
  });

  describe('the residue hook at the crystallization seat', () => {
    let neumaId, adapter;
    beforeAll(async () => {
      neumaId = 'test-being-hook-' + Math.floor(Math.random() * 1e9).toString(36);
      await workspace.create(neumaId);
      adapter = new WorkspaceAdapter(neumaId, { workspace });
    });

    it('a sub-threshold exchange leaves a mind record and NO observation', async () => {
      await crystallizeObservation(neumaId, 'Test Being',
        'why do we keep circling the vault question', 'I notice it too.');
      expect(await workspace.listObservations(neumaId)).toHaveLength(0);
      const minds = await activeMindRecords(adapter);
      expect(minds).toHaveLength(1);
      expect(minds[0].content).toBe('I notice it too.');
      expect(minds[0].source.kind).toBe('residue');
    });

    it('a crystallized exchange leaves an observation and NO new mind record', async () => {
      const before = (await activeMindRecords(adapter)).length;
      await crystallizeObservation(neumaId, 'Test Being',
        'store the token in your vault', 'Done — stored.', null, null, { acted: true });
      expect(await workspace.listObservations(neumaId)).toHaveLength(1);
      expect((await activeMindRecords(adapter)).length).toBe(before);
    });

    it('noise leaves neither', async () => {
      const beforeMinds = (await activeMindRecords(adapter)).length;
      const beforeObs = (await workspace.listObservations(neumaId)).length;
      await crystallizeObservation(neumaId, 'Test Being', 'thanks', 'anytime');
      expect((await workspace.listObservations(neumaId)).length).toBe(beforeObs);
      expect((await activeMindRecords(adapter)).length).toBe(beforeMinds);
    });
  });

  describe('mind_note through the real gate and store', () => {
    let neumaId, adapter;
    beforeAll(async () => {
      neumaId = 'test-being-tool-' + Math.floor(Math.random() * 1e9).toString(36);
      await workspace.create(neumaId);
      adapter = new WorkspaceAdapter(neumaId, { workspace });
    });

    it('the tool definition advertises the memory server and requires content', () => {
      expect(MIND_NOTE_TOOL.server).toBe('memory');
      expect(MIND_NOTE_TOOL.inputSchema.required).toContain('content');
    });

    it('sets a working thought down — record lands encrypted, kind honored', async () => {
      const frames = [];
      const result = await handleMindNoteTool(null, makeConnection(neumaId), null, 'ask',
        { content: 'something unresolved about the ceremony pacing', kind: 'tension' }, makePorts(frames));
      expect(result.status).toBe('ok');
      expect(result.content).toMatch(/linger/i);
      expect(frames.some((f) => f.status === 'ok')).toBe(true);
      const minds = await activeMindRecords(adapter, { kinds: ['tension'] });
      expect(minds).toHaveLength(1);
      expect(minds[0].meta.kind).toBe('tension');
      expect(minds[0].source.kind).toBe('mind_note');
    });

    it('the same thought again DEEPENS instead of duplicating', async () => {
      const frames = [];
      const result = await handleMindNoteTool(null, makeConnection(neumaId), null, 'ask',
        { content: 'still unresolved — the ceremony pacing question', kind: 'tension' }, makePorts(frames));
      expect(result.status).toBe('ok');
      expect(result.content).toMatch(/deepened/i);
      expect(await activeMindRecords(adapter, { kinds: ['tension'] })).toHaveLength(1);
    });

    it('an unknown kind falls to trace, never errors', async () => {
      const result = await handleMindNoteTool(null, makeConnection(neumaId), null, 'ask',
        { content: 'a stray flicker about the dock', kind: 'obsession' }, makePorts([]));
      expect(result.status).toBe('ok');
      const traces = await activeMindRecords(adapter, { kinds: ['trace'] });
      expect(traces.some((r) => r.content.includes('stray flicker'))).toBe(true);
    });

    it('bounds hold: empty and oversized content refuse with the correctable message', async () => {
      const empty = await handleMindNoteTool(null, makeConnection(neumaId), null, 'ask',
        { content: '   ' }, makePorts([]));
      expect(empty.status).toBe('error');
      expect(empty.error).toMatch(new RegExp(String(MIND_PHRASE_MAX)));
      const oversized = await handleMindNoteTool(null, makeConnection(neumaId), null, 'ask',
        { content: 'x'.repeat(MIND_PHRASE_MAX + 1) }, makePorts([]));
      expect(oversized.status).toBe('error');
    });

    it('observe mode HOLDS the write — a self-write is an act, not observation', async () => {
      const before = (await activeMindRecords(adapter)).length;
      const frames = [];
      const result = await handleMindNoteTool(null, makeConnection(neumaId), null, 'observe',
        { content: 'this must not land' }, makePorts(frames));
      expect(result.status).toBe('denied');
      expect(result.error).toMatch(/observe/);
      expect(frames.some((f) => f.status === 'denied')).toBe(true);
      expect((await activeMindRecords(adapter)).length).toBe(before);
    });

    it('no bound being refuses before any gate', async () => {
      const result = await handleMindNoteTool(null, makeConnection(null, { companion: {} }), null, 'ask',
        { content: 'nowhere to land' }, makePorts([]));
      expect(result.status).toBe('error');
      expect(result.error).toMatch(/no being/);
    });
  });
});
