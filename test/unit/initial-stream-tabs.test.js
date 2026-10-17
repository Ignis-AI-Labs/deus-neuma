import { describe, it, expect } from 'vitest';
import { initialStreamTabs } from '../../frontend/app/RelinkShell/initial-stream-tabs.js';
import { emptyTabs, openTab, tearOutPayload, serializeTabs } from '../../core/runtime/tabs-model.js';
import { encodeStreamTransfer, decodeStreamTransfer } from '../../frontend/app/RelinkShell/stream-tab-transfer.js';
import { reducer, initialState } from '../../frontend/app/windowing/window-manager-reducer.js';

const tab = Object.freeze({
  id: 'held-tab', neumaId: 'fixture-a', kind: 'local', name: 'Fixture A',
  sessionId: 'session-a', createdAt: '2026-09-05T00:00:00Z',
  focus: Object.freeze({ kind: 'folder', path: '/tmp/folder-a' }),
});

describe('initial transferred sitting', () => {
  it('adopts the full sitting instead of minting identity on the fallback lens', () => {
    const windows = reducer(initialState, { type: 'OPEN_NEW', appId: 'chat', payload: encodeStreamTransfer(tab) });
    const result = initialStreamTabs(emptyTabs(), decodeStreamTransfer(windows.windows[0].payload), 'wrong-new-id');
    expect(result.focusedId).toBe(tab.id);
    expect(result.tabs).toEqual([tab]);
    expect(serializeTabs(result).tabs).toEqual([tab]);
  });

  it('refuses oversized transfers and malformed stored payloads without reseeding them', () => {
    expect(encodeStreamTransfer({ ...tab, name: 'x'.repeat(4096) })).toBeNull();
    expect(decodeStreamTransfer('stream-adopted')).toBeNull();
    expect(decodeStreamTransfer('{broken')).toBeNull();
    expect(decodeStreamTransfer(JSON.stringify({ tab: { ...tab, kind: 'foreign' } }))).toBeNull();
  });

  it('keeps the existing top-level window payload contract including session and focus', () => {
    const result = initialStreamTabs(emptyTabs(), tearOutPayload(tab), 'new-strip-id');
    expect(result.tabs[0]).toMatchObject({ ...tearOutPayload(tab), id: 'new-strip-id' });
  });

  it('leaves a normal window restore alone and ordinary new tabs remain fresh', () => {
    const restored = openTab(emptyTabs(), tab);
    expect(initialStreamTabs(restored, null, 'unused')).toBe(restored);
    const fresh = openTab(restored, { id: 'fresh', neumaId: tab.neumaId, kind: 'local' });
    expect(fresh.tabs[1]).toMatchObject({ id: 'fresh', sessionId: null, focus: null });
    expect(fresh.tabs[0]).toEqual(tab);
  });
});
