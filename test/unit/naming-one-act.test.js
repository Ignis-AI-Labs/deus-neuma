// THE NAMING HOLDS ONE ACT (Design note, 2026-10-14: the naming stage is offered the
// write hand alone, and only the name's write runs. Pure — real inputs.
import { describe, it, expect } from 'vitest';
import { canonicalizeBirthCalls } from '../../core/birth/ceremony-write.js';
import { namingTools, withFsPrimitives } from '../../backend/services/fs-primitives.js';

const NAME = '/realm/data/temp/chosen_name.txt';

describe('the naming holds one act', () => {
  it('offers the write hand alone', () => {
    expect(namingTools(withFsPrimitives([])).map((t) => `${t.server}/${t.name}`)).toEqual(['fs/write']);
  });

  it('runs only the name\'s write — a list or read the being reaches for is not run', () => {
    const calls = [
      { server: 'fs', toolName: 'list', args: { path: '/realm/data' } },
      { server: 'fs', toolName: 'read', args: { path: '/realm/data/temp' } },
      { server: 'fs', toolName: 'write', args: { path: 'data/temp/chosen_name.txt', content: 'Reden' } },
    ];
    const kept = canonicalizeBirthCalls(calls, 4, { scratchNamePath: NAME });
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ toolName: 'write', args: { path: NAME, content: 'Reden' } });
  });

  it('keeps an edit as the name\'s write, and leaves crystallization\'s calls alone', () => {
    const edit = [{ server: 'fs', toolName: 'edit', args: { path: 'x', edits: [{ newText: 'Reden' }] } }];
    expect(canonicalizeBirthCalls(edit, 4, { scratchNamePath: NAME })).toHaveLength(1);
    const list = [{ server: 'fs', toolName: 'list', args: { path: '/' } }];
    expect(canonicalizeBirthCalls(list, 5, { genesisPath: '/g/genesis.md' })).toHaveLength(1);
  });
});
