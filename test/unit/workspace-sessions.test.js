import { describe, test, expect } from 'vitest';
import { toDisplayMessages } from '../../frontend/app/RelinkShell/workspace-sessions.js';

// The retention rule that decides whether a resumed chat still shows its
// chips: speech may be stripped to empty, but an acted turn is never dropped.

describe('toDisplayMessages (pure mapping + retention)', () => {
  test('a tool-only assistant turn survives with its chips and no speech', () => {
    const out = toDisplayMessages([
      { role: 'user', content: 'research it' },
      { role: 'assistant', content: '', tools: [{ tool: 'web/web_search', status: 'ok', summary: '5 results', detail: '' }] },
    ]);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ role: 'assistant', content: '' });
    expect(out[1].tools).toHaveLength(1);
  });

  test('a truly empty assistant record (no speech, no tools, no images) is dropped', () => {
    const out = toDisplayMessages([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '' },
    ]);
    expect(out).toHaveLength(1);
  });

  test('tool blocks are stripped from speech while the structured tools ride beside it', () => {
    const out = toDisplayMessages([
      { role: 'assistant', content: 'looked it up [TOOL: web/web_search {"query":"x"}] done',
        tools: [{ tool: 'web/web_search', status: 'ok', summary: '', detail: '' }] },
    ]);
    expect(out[0].content).not.toContain('[TOOL:');
    expect(out[0].tools).toHaveLength(1);
  });

  test('user docs keep their record alongside text — the attachment survives the fold (2026-09-17)', () => {
    const out = toDisplayMessages([
      { role: 'user', content: 'see attached', turnId: 'tp-1', docs: [{ name: 'campaign-brief.md', text: '# brief' }] },
    ]);
    expect(out[0].docs).toEqual([{ name: 'campaign-brief.md', text: '# brief' }]);
  });

  test('the record\'s timestamp rides into the display as `at`; absent stays absent', () => {
    const out = toDisplayMessages([
      { role: 'user', content: 'when was this', timestamp: '2026-07-20T14:00:00.000Z' },
      { role: 'assistant', content: 'a record predating the stamp' },
    ]);
    expect(out[0].at).toBe('2026-07-20T14:00:00.000Z');
    expect('at' in out[1]).toBe(false);
  });

  test('user images keep their record even without text; the tail bound holds', () => {
    const out = toDisplayMessages([
      { role: 'user', content: '', images: ['data:image/png;base64,xx'] },
      ...Array.from({ length: 60 }, (_, i) => ({ role: 'user', content: `m${i}` })),
    ], 50);
    expect(out).toHaveLength(50);
    expect(out.some((m) => m.images)).toBe(false); // the image fell off the tail
  });
});

describe('toDisplayMessages — THE TAKES: the history fold', () => {
  const POINT = [
    { role: 'user', content: 'q1', turnId: 't1', timestamp: '2026-07-27T10:00:00.000Z' },
    { role: 'assistant', content: 'a1', turnId: 't1', takeIndex: 1, timestamp: '2026-07-27T10:00:01.000Z' },
    { role: 'assistant', content: 'a2', turnId: 't1', takeIndex: 2, timestamp: '2026-07-27T10:00:02.000Z' },
  ];

  test('a multi-take point folds to ONE take-aware message, latest viewed by default', () => {
    const out = toDisplayMessages(POINT);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ role: 'user', content: 'q1', turnId: 't1', at: '2026-07-27T10:00:00.000Z' });
    expect(out[1]).toMatchObject({
      role: 'assistant', turnId: 't1', takeIndex: 2, takeCount: 2,
      content: 'a2', at: '2026-07-27T10:00:02.000Z',
    });
    // Every take is kept, stripped, for the ‹ k/N › switch.
    expect(out[1].takes.map((t) => [t.takeIndex, t.content, t.at])).toEqual([
      [1, 'a1', '2026-07-27T10:00:01.000Z'],
      [2, 'a2', '2026-07-27T10:00:02.000Z'],
    ]);
  });

  test('a branch-view row moves the viewed take — the reload shows what the witness left', () => {
    const out = toDisplayMessages([...POINT, { role: 'system', branchView: { t1: 1 } }]);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ takeIndex: 1, content: 'a1', at: '2026-07-27T10:00:01.000Z' });
    expect(out[1].takeCount).toBe(2);
  });

  test('each take keeps its own tool chips; the viewed take mirrors out', () => {
    const out = toDisplayMessages([
      { role: 'user', content: 'q', turnId: 't1' },
      { role: 'assistant', content: '', turnId: 't1', takeIndex: 1,
        tools: [{ tool: 'web/web_search', status: 'ok', summary: '5 results' }] },
      { role: 'assistant', content: 'spoke instead', turnId: 't1', takeIndex: 2 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[1].takes[0].tools).toHaveLength(1);
    expect(out[1].takes[1].tools).toBeUndefined();
    expect(out[1].content).toBe('spoke instead');
  });

  test('a point whose every take is empty drops; a point with one acting take survives', () => {
    const dropped = toDisplayMessages([
      { role: 'user', content: 'q', turnId: 't1' },
      { role: 'assistant', content: '', turnId: 't1', takeIndex: 1 },
      { role: 'assistant', content: '', turnId: 't1', takeIndex: 2 },
    ]);
    expect(dropped).toHaveLength(1);
    const kept = toDisplayMessages([
      { role: 'user', content: 'q', turnId: 't2' },
      { role: 'assistant', content: '', turnId: 't2', takeIndex: 1 },
      { role: 'assistant', content: '', turnId: 't2', takeIndex: 2,
        tools: [{ tool: 'fs/read_file', status: 'ok', summary: 'read' }] },
    ]);
    expect(kept).toHaveLength(2);
  });

  test('legacy rows beside take-aware points fold each by their own law', () => {
    const out = toDisplayMessages([
      { role: 'user', content: 'old ask' },
      { role: 'assistant', content: 'old answer' },
      ...POINT,
    ]);
    expect(out.map((m) => m.content)).toEqual(['old ask', 'old answer', 'q1', 'a2']);
    expect(out[1].turnId).toBeUndefined();
    expect(out[1].takes).toBeUndefined();
  });
});

// THE POSITION OF AN ACT survives the strip. The record marks each act against
// the RAW answer; the screen sees that answer with its tool blocks removed, so
// the mark has to move with the text or the chips land in the wrong place.
describe('toDisplayMessages — where each act sat in the answer', () => {
  test('a mark rebases past the tool blocks the display strips out', () => {
    const raw = 'Let me look.\n\n[TOOL: filesystem/read_file {"path":"a.js"}]\n\nIt says forty-two.';
    const out = toDisplayMessages([
      { role: 'user', content: 'what does it say' },
      { role: 'assistant', content: raw, tools: [{ tool: 'filesystem/read_file', status: 'ok', summary: 'read a.js', mark: raw.indexOf('\n\nIt says') }] },
    ]);
    const [act] = out[1].tools;
    // The block is gone from the displayed speech; the act still sits exactly
    // where it did — after […] and before "It says forty-two."
    expect(out[1].content).toBe('Let me look.\n\nIt says forty-two.');
    expect(out[1].content.slice(0, act.mark)).toBe('Let me look.');
  });

  test('a record from before marks existed passes through untouched', () => {
    const out = toDisplayMessages([
      { role: 'assistant', content: 'answer', tools: [{ tool: 'web/web_search', status: 'ok', summary: '5 results' }] },
    ]);
    expect(out[0].tools[0].mark).toBeUndefined();
  });

  test('a take carries its own acts and its own positions', () => {
    const out = toDisplayMessages([
      { role: 'user', content: 'q', turnId: 't9' },
      { role: 'assistant', content: 'first go', turnId: 't9', takeIndex: 1,
        tools: [{ tool: 'web/web_search', status: 'ok', summary: 'one', mark: 5 }] },
      { role: 'assistant', content: 'second go, longer', turnId: 't9', takeIndex: 2,
        tools: [{ tool: 'web/web_fetch', status: 'ok', summary: 'two', mark: 9 }] },
    ]);
    expect(out[1].takes.map((t) => t.tools[0].mark)).toEqual([5, 9]);
    expect(out[1].tools[0]).toMatchObject({ tool: 'web/web_fetch', mark: 9 });
  });
});
