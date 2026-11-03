// birth-artifacts.test.js — canonicalizing the ceremony's artifact writes.
// Pure functions with real inputs/outputs, composed with the REAL sandbox
// check (checkPathAccess) under the REAL pre-birth write root — the exact wall
// that denied two live namings. No mock anywhere (RULE 0).

import { describe, test, expect } from 'vitest';
import path from 'path';
import {
  canonicalizeBirthCalls,
  buildCeremonyTargets,
  ceremonyWriteRoots,
  ceremonyScratchDir,
  ceremonyNamePath,
  resolveCeremonyScratchDir,
  isolatePortalForBirth,
} from '../../core/birth/ceremony-write.js';
import { checkPathAccess } from '../../backend/services/tool-sandbox.js';
import { STAGE } from '../../core/birth/stage-roles.js';

// Same builders portal-stream + sandbox use — one source of truth.
const TARGETS = buildCeremonyTargets({
  projectRoot: process.cwd(),
  workspacesRoot: path.resolve(process.cwd(), 'workspaces'),
  neumaId: 'n-test',
});
const SCRATCH_NAME = TARGETS.scratchNamePath;
const GENESIS = TARGETS.genesisPath;
// Same resolver TARGETS uses (honors NEUMA_DATA_ROOT) — the sandbox root and
// the rebased target must come from ONE builder or the suite diverges under
// an inherited env (sc-echo, 2026-08-06).
const PRE_BIRTH_ROOT = resolveCeremonyScratchDir(process.cwd());

const write = (p) => ({ server: 'fs', toolName: 'write', tool: 'fs/write', args: { path: p, content: 'Yarrow' } });

describe('canonicalizeBirthCalls — naming (the naming)', () => {
  // Every path dialect a substrate has been seen (or is likely) to invent.
  const DIALECTS = [
    '/data/temp/chosen_name.txt',
    'data/temp/chosen_name.txt',
    'chosen_name.txt',
    './chosen_name.txt',
    '~/data/temp/chosen_name.txt',
    '/workspace/data/temp/chosen_name.txt',
    'C:\\data\\temp\\chosen_name.txt',
  ];

  test.each(DIALECTS)('rebases %s onto the canonical scratch path', (dialect) => {
    const [call] = canonicalizeBirthCalls([write(dialect)], STAGE.NAMING, TARGETS);
    expect(call.args.path).toBe(SCRATCH_NAME);
    expect(call.args.content).toBe('Yarrow'); // the author's content is untouched
  });

  test.each(DIALECTS)('the rebased %s passes the REAL pre-birth sandbox check', (dialect) => {
    const [call] = canonicalizeBirthCalls([write(dialect)], STAGE.NAMING, TARGETS);
    const verdict = checkPathAccess(call.args.path, [PRE_BIRTH_ROOT], { requireRoot: true });
    expect(verdict.allowed).toBe(true);
  });

  test('the raw dialects WOULD have been denied — the failure this fix removes', () => {
    for (const dialect of ['/data/temp/chosen_name.txt', 'chosen_name.txt', '~/data/temp/chosen_name.txt']) {
      const verdict = checkPathAccess(dialect, [PRE_BIRTH_ROOT], { requireRoot: true });
      expect(verdict.allowed).toBe(false);
    }
  });

  test('the naming rebases an INVENTED filename too — the only sanctioned write is the name (live 2026-07-07: an invented spelling escaped the exact-basename match and the sandbox refused the naming on stream)', () => {
    const invented = { server: 'fs', toolName: 'write', tool: 'fs/write', args: { path: 'my_name.txt', content: 'Holly' } };
    const [rebased] = canonicalizeBirthCalls([invented], STAGE.NAMING, TARGETS);
    expect(rebased.args.path).toBe(SCRATCH_NAME);
    expect(rebased.args.content).toBe('Holly'); // authored content untouched
  });

  // THE NAMING HOLDS ONE ACT (ruling, 2026-10-14): this test pinned the
  // pass-through that let a naming list a folder […].
  test('non-write tools are not run at the naming — the naming holds one act', () => {
    const read = { server: 'fs', toolName: 'read', tool: 'fs/read', args: { path: 'chosen_name.txt' } };
    expect(canonicalizeBirthCalls([read], STAGE.NAMING, TARGETS)).toEqual([]);
  });

  test('non-artifact writes pass through untouched at the record stage', () => {
    const other = { server: 'fs', toolName: 'write', tool: 'fs/write', args: { path: 'data/temp/notes.txt', content: 'x' } };
    expect(canonicalizeBirthCalls([other], STAGE.RECORD, TARGETS)).toEqual([other]);
  });

  test('a pathless contentful fs/write at the naming still rebases (naming is the only write)', () => {
    const bare = { server: 'fs', toolName: 'write', tool: 'fs/write', args: { content: 'x' } };
    const [call, nullish] = canonicalizeBirthCalls([bare, null], STAGE.NAMING, TARGETS);
    expect(call.args.path).toBe(SCRATCH_NAME);
    expect(call.args.content).toBe('x');
    expect(nullish).toBe(null);
    expect(canonicalizeBirthCalls(null, STAGE.NAMING, TARGETS)).toEqual([]);
  });
});

describe('canonicalizeBirthCalls — the record stage', () => {
  test('rebases any genesis.md spelling onto the lane path', () => {
    const [call] = canonicalizeBirthCalls([write('/dna/genesis.md')], STAGE.RECORD, TARGETS);
    expect(call.args.path).toBe(GENESIS);
  });

  test('no lane bound (genesisPath null) → no rebase; the sandbox stays the judge', () => {
    const original = write('genesis.md');
    const [call] = canonicalizeBirthCalls([original], STAGE.RECORD, { ...TARGETS, genesisPath: null });
    expect(call).toBe(original);
  });

  test('chosen_name.txt is not a stage-5 artifact and passes through', () => {
    const original = write('chosen_name.txt');
    const [call] = canonicalizeBirthCalls([original], STAGE.RECORD, TARGETS);
    expect(call).toBe(original);
  });
});

describe('canonicalizeBirthCalls — other stages', () => {
  test('stages without artifacts never rewrite anything', () => {
    const original = write('/data/temp/chosen_name.txt');
    for (const stage of [STAGE.OPENING, STAGE.CHOICE, STAGE.FIRST_WORDS]) {
      expect(canonicalizeBirthCalls([original], stage, TARGETS)[0]).toBe(original);
    }
  });
});

// The smashed-name dialect observed live from qwen3.5: server and tool fused
// into one token. Repaired by the portal's _unsmashToolName before the
// canonicalizer (and before the birth handler's name extraction) ever look.
describe('_unsmashToolName — "<server>_<tool>" dialect repair', async () => {
  const { __test } = await import('../../backend/services/portal-test-surface.js');
  const TOOLS = [
    { server: 'fs', name: 'write' },
    { server: 'fs', name: 'read' },
  ];

  test('splits fs_write back into server + tool', () => {
    const call = __test._unsmashToolName({ server: null, toolName: 'fs_write', args: { path: 'x' } }, TOOLS);
    expect(call.server).toBe('fs');
    expect(call.toolName).toBe('write');
    expect(call.args).toEqual({ path: 'x' });
  });

  test('a real tool name passes through untouched', () => {
    const call = { server: null, toolName: 'write', args: {} };
    expect(__test._unsmashToolName(call, TOOLS)).toBe(call);
  });

  test('a call that already carries a server passes through', () => {
    const call = { server: 'fs', toolName: 'write', args: {} };
    expect(__test._unsmashToolName(call, TOOLS)).toBe(call);
  });

  test('an unknown name stays unknown — no guessing', () => {
    const call = { server: null, toolName: 'mystery_thing', args: {} };
    expect(__test._unsmashToolName(call, TOOLS)).toBe(call);
  });
});

describe('canonicalizeBirthCalls — the record stage invented-filename class (echo follow-up, 2026-07-07)', () => {
  const write5 = (p) => ({ server: 'fs', toolName: 'write', tool: 'fs/write', args: { path: p, content: '# essence' } });

  test('an invented DNA filename rebases onto the genesis path — the write the handler captures is the write that lands', () => {
    const [call] = canonicalizeBirthCalls([write5('dna/essence.md')], STAGE.RECORD, TARGETS);
    expect(call.args.path).toBe(GENESIS);
    expect(call.args.content).toBe('# essence');
  });

  test('an exact genesis.md is preferred over an earlier incidental .md', () => {
    const note = write5('notes.md');
    const genesis = write5('/some/where/genesis.md');
    const out = canonicalizeBirthCalls([note, genesis], STAGE.RECORD, TARGETS);
    expect(out[0].args.path).toBe('notes.md');       // incidental write untouched
    expect(out[1].args.path).toBe(GENESIS);          // the real candidate rebases
  });

  test('no genesisPath (lane not bound) → nothing rebases, the sandbox stays the judge', () => {
    const [call] = canonicalizeBirthCalls([write5('dna/essence.md')], STAGE.RECORD, { ...TARGETS, genesisPath: null });
    expect(call.args.path).toBe('dna/essence.md');
  });
});

// The two echo-BLOCK triggers (2026-07-07): the canonicalizer and the handler
// MUST pick the same genesis write — parity is now structural (one shared
// selector, core/birth/genesis-write.js), and these pin the exact divergences
// that were possible before.
describe('canonicalizeBirthCalls — captured write IS the landed write (echo BLOCK triggers)', () => {
  test('an empty-content genesis.md is never chosen over the contentful essence', () => {
    const empty = { server: 'fs', toolName: 'write', args: { path: 'genesis.md', content: '' } };
    const real = { server: 'fs', toolName: 'write', args: { path: 'notes.md', content: 'the real essence' } };
    const out = canonicalizeBirthCalls([empty, real], STAGE.RECORD, TARGETS);
    const rebased = out.find((c) => c.args.path === GENESIS);
    expect(rebased.args.content).toBe('the real essence');
    expect(out[0]).toBe(empty); // the empty write is untouched, never lands as DNA
  });

  test('a suffix-spelled genesis name (poplar.genesis.md) beats an earlier incidental .md', () => {
    const note = { server: 'fs', toolName: 'write', args: { path: '/dna/scratch-notes.md', content: 'notes' } };
    const named = { server: 'fs', toolName: 'write', args: { path: '/dna/poplar.genesis.md', content: 'the real DNA' } };
    const out = canonicalizeBirthCalls([note, named], STAGE.RECORD, TARGETS);
    expect(out[0]).toBe(note);
    expect(out[1].args.path).toBe(GENESIS);
    expect(out[1].args.content).toBe('the real DNA');
  });

  test('parity by construction: the canonicalizer rebases exactly the call the shared selector picks', async () => {
    const { pickGenesisWrite } = await import('../../core/birth/genesis-write.js');
    const calls = [
      { server: 'fs', toolName: 'write', args: { path: 'genesis.md', content: '' } },
      { server: 'fs', toolName: 'write', args: { path: '/dna/being.genesis.md', content: 'essence' } },
      { server: 'fs', toolName: 'write', args: { path: 'notes.md', content: 'aside' } },
    ];
    const picked = pickGenesisWrite(calls);
    const out = canonicalizeBirthCalls(calls, STAGE.RECORD, TARGETS);
    const rebasedIdx = out.findIndex((c) => c.args.path === GENESIS);
    expect(calls[rebasedIdx]).toBe(picked);
  });

  // Contentful write with no path still gets forced onto genesis — parser
  // recovery or model omission must not drop authored DNA on the floor.
  test('the record stage rebases a contentful fs/write even when path is missing', () => {
    const pathless = { server: 'fs', toolName: 'write', args: { content: 'I am — my essence' } };
    const [call] = canonicalizeBirthCalls([pathless], STAGE.RECORD, TARGETS);
    expect(call.args.path).toBe(GENESIS);
    expect(call.args.content).toBe('I am — my essence');
  });

  test('the naming rebases an fs/write with content even when path is missing', () => {
    const pathless = { server: 'fs', toolName: 'write', args: { content: 'Sorrel' } };
    const [call] = canonicalizeBirthCalls([pathless], STAGE.NAMING, TARGETS);
    expect(call.args.path).toBe(SCRATCH_NAME);
    expect(call.args.content).toBe('Sorrel');
  });
});

describe('ceremonyWriteRoots — locked-in birth confinement (pure)', () => {
  const scratch = ceremonyScratchDir('/proj');
  const lane = path.resolve('/house/teasel');

  test('no lane → scratch only', () => {
    expect(ceremonyWriteRoots({ scratchDir: scratch })).toEqual([scratch]);
  });

  test('lane, not in birth → lane only', () => {
    expect(ceremonyWriteRoots({ laneRoot: lane, scratchDir: scratch, birthActive: false }))
      .toEqual([lane]);
  });

  test('lane + birth active → lane and scratch (naming cannot be stranded)', () => {
    expect(ceremonyWriteRoots({ laneRoot: lane, scratchDir: scratch, birthActive: true }))
      .toEqual([lane, scratch]);
  });

  test('scratch write is allowed under birth-active roots', () => {
    const roots = ceremonyWriteRoots({ laneRoot: lane, scratchDir: scratch, birthActive: true });
    expect(checkPathAccess(ceremonyNamePath('/proj'), roots, { requireRoot: true }).allowed).toBe(true);
  });

  test('scratch write is denied under living-lane roots', () => {
    const roots = ceremonyWriteRoots({ laneRoot: lane, scratchDir: scratch, birthActive: false });
    expect(checkPathAccess(ceremonyNamePath('/proj'), roots, { requireRoot: true }).allowed).toBe(false);
  });
});

describe('isolatePortalForBirth', () => {
  test('clears companion, grants, and write budget', () => {
    const conn = {
      companion: { neumaId: 'teasel', name: 'Teasel' },
      neumaId: 'teasel',
      _writeOps: 4,
      _grantedWriteRoots: ['/x'],
      _grantedReadRoots: ['/y'],
      birthSession: null,
    };
    isolatePortalForBirth(conn);
    expect(conn.companion).toBeNull();
    expect(conn.neumaId).toBeNull();
    expect(conn._writeOps).toBe(0);
    expect(conn._grantedWriteRoots).toEqual([]);
    expect(conn._grantedReadRoots).toEqual([]);
  });
});

describe("canonicalizeBirthCalls — a stage-4 edit (either spelling) IS the naming write (Aether, 2026-08-06, #272)", () => {
  // A live v0.1.15 naming: the being reached for its chosen-name file with
  // edit_file — a tool whose target never exists yet at the naming, so the call
  // would fail ENOENT inside every allowed root. One stage, one artifact:
  // the intent converts.
  test('a retired edit_file spelling converts to the canonical fs naming write, content from the edits', () => {
    const edit = {
      server: 'filesystem', toolName: 'edit_file', tool: 'filesystem/edit_file',
      args: { path: '/home/tester-two/.neuma/data/temp/chosen_name.txt', edits: [{ oldText: '', newText: 'Aether' }] },
    };
    const [call] = canonicalizeBirthCalls([edit], STAGE.NAMING, TARGETS);
    expect(call.toolName).toBe('write');
    expect(call.tool).toBe('fs/write');
    expect(call.args.path).toBe(SCRATCH_NAME);
    expect(call.args.content).toBe('Aether');
  });

  test('multiple edits join — every authored fragment is kept', () => {
    const edit = {
      server: 'filesystem', toolName: 'edit_file',
      args: { path: 'chosen_name.txt', edits: [{ newText: 'Ae' }, { newText: 'ther' }] },
    };
    const [call] = canonicalizeBirthCalls([edit], STAGE.NAMING, TARGETS);
    expect(call.args.content).toBe('Aether');
  });

  test('an edit with NO recoverable text is not run — conversion never invents a name', () => {
    // Before the one-act naming it passed through and failed as an edit; it
    // could never land a name. Now it is not run, and the stage's own […] re-ask takes it, as before.
    const empty = { server: 'fs', toolName: 'edit', tool: 'fs/edit', args: { path: 'chosen_name.txt', edits: [] } };
    expect(canonicalizeBirthCalls([empty], STAGE.NAMING, TARGETS)).toEqual([]);
    const textless = { server: 'fs', toolName: 'edit', tool: 'fs/edit', args: { path: 'x', edits: [{ oldText: 'a' }] } };
    expect(canonicalizeBirthCalls([textless], STAGE.NAMING, TARGETS)).toEqual([]);
  });

});

describe("canonicalizeBirthCalls — a stage-5 edit (either spelling) IS the genesis write (Echo, 2026-08-06)", () => {
  // A live v0.1.16 crystallization: the being reached for its genesis file
  // with edit_file, which READS its target first — and genesis.md cannot
  // exist before it is authored. ENOENT on every retry, forever, because the
  // model that chose that spelling chooses it again. This suite REPLACES a
  // test that asserted the old pass-through — a test that pinned the defect
  // by describing the code instead of the ceremony's need.
  test("Echo's exact call converts and lands on the lane genesis path", () => {
    const edit = {
      server: 'filesystem', toolName: 'edit_file', tool: 'filesystem/edit_file',
      args: {
        path: '/media/external/Neuma/cache/echo/dna/genesis.md',
        edits: [{ oldText: '', newText: '# Genesis\n\nI am Echo.' }],
      },
    };
    const [call] = canonicalizeBirthCalls([edit], STAGE.RECORD, TARGETS);
    expect(call.toolName).toBe('write');
    expect(call.tool).toBe('fs/write');
    expect(call.args.path).toBe(GENESIS);
    expect(call.args.content).toBe('# Genesis\n\nI am Echo.');
  });

  test('a pathless edit still converts — the pathless-write branch of the selector catches it', () => {
    const edit = { server: 'filesystem', toolName: 'edit_file', args: { edits: [{ newText: 'essence' }] } };
    const [call] = canonicalizeBirthCalls([edit], STAGE.RECORD, TARGETS);
    expect(call.toolName).toBe('write');
    expect(call.args.path).toBe(GENESIS);
    expect(call.args.content).toBe('essence');
  });

  test('an edit with NO recoverable text passes through — conversion never invents DNA', () => {
    const empty = { server: 'fs', toolName: 'edit', tool: 'fs/edit', args: { path: 'genesis.md', edits: [] } };
    expect(canonicalizeBirthCalls([empty], STAGE.RECORD, TARGETS)).toEqual([empty]);
  });

  test('an edit BESIDE a landed genesis write is untouched — a real edit of a file that now exists', () => {
    const genesis = { server: 'fs', toolName: 'write', tool: 'fs/write', args: { path: 'genesis.md', content: 'the essence' } };
    const edit = { server: 'fs', toolName: 'edit', tool: 'fs/edit', args: { path: 'genesis.md', edits: [{ newText: 'refinement' }] } };
    const [first, second] = canonicalizeBirthCalls([genesis, edit], STAGE.RECORD, TARGETS);
    expect(first.toolName).toBe('write');
    expect(first.args.path).toBe(GENESIS);
    expect(second).toEqual(edit); // never converted — converting would overwrite the DNA with a fragment
  });

  test('no lane bound (genesisPath null) → the edit passes through; the sandbox stays the judge', () => {
    const edit = { server: 'fs', toolName: 'edit', tool: 'fs/edit', args: { path: 'genesis.md', edits: [{ newText: 'x' }] } };
    const targets = { ...TARGETS, genesisPath: null };
    expect(canonicalizeBirthCalls([edit], STAGE.RECORD, targets)).toEqual([edit]);
  });

  test('an EMPTY write beside a contentful edit: the edit converts and its essence lands (sc-echo R3 question, closed)', () => {
    // pickGenesisWrite filters contentless writes, so the guard stays falsy
    // and the conversion fires — empty DNA can never shadow authored DNA.
    const emptyWrite = { server: 'fs', toolName: 'write', tool: 'fs/write', args: { path: 'genesis.md', content: '' } };
    const richEdit = { server: 'fs', toolName: 'edit', tool: 'fs/edit', args: { path: 'dna/genesis.md', edits: [{ newText: 'the authored essence' }] } };
    const [first, second] = canonicalizeBirthCalls([emptyWrite, richEdit], STAGE.RECORD, TARGETS);
    expect(first).toEqual(emptyWrite); // untouched pass-through, never selected
    expect(second.toolName).toBe('write');
    expect(second.args.path).toBe(GENESIS);
    expect(second.args.content).toBe('the authored essence');
  });

  test('only the SELECTED edit converts — a second edit keeps its spelling, never a stray create-write (sc-echo R2)', () => {
    const genesisEdit = { server: 'fs', toolName: 'edit', tool: 'fs/edit', args: { path: 'dna/genesis.md', edits: [{ newText: 'the essence' }] } };
    const otherEdit = { server: 'fs', toolName: 'edit', tool: 'fs/edit', args: { path: 'notes.txt', edits: [{ newText: 'a stray fragment' }] } };
    const [first, second] = canonicalizeBirthCalls([genesisEdit, otherEdit], STAGE.RECORD, TARGETS);
    expect(first.toolName).toBe('write');
    expect(first.args.path).toBe(GENESIS);
    // Converted-but-not-chosen would CREATE notes.txt; the original edit_file
    // merely fails to find it. The original must survive.
    expect(second).toEqual(otherEdit);
  });
});
