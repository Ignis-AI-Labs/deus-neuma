// council-session-acts.test.js — the room’s acts: a misfired tool call
// corrected, the operator’s gate, deletes on the card, the folder ground.
// Split from council-session.test.js (SIZE-033); bodies byte-identical.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  openCouncil, councilSay, closeCouncil, houseCallTool,
} from '../../backend/services/council-session.js';
import { setHouseWorkspace } from '../../backend/services/house-workspace.js';
import {
  ownsNeumaLane, makeConnection, framesOf, sseResponse, scriptedDeps, WALLET, councilBeforeEach, councilAfterEach,
} from '../helpers/council-session-kit.js';

let root;
let realm;
let savedKey;

beforeEach(async () => {
  ({ root, realm, savedKey } = await councilBeforeEach());
});

afterEach(() => {
  councilAfterEach({ root, realm, savedKey });
});

describe('a misfired act never ends a turn wordless — the room corrects, the member finishes', () => {
  it('an unknown tool aim gets ONE honest correction, then the words land', async () => {
    // Tenekom's dead red chip (live sitting 2026-07-23): the whole turn was
    // one refused tool call and the floor yielded in silence. Now the model
    // is told the aim missed and which tools exist, and speaks.
    const ground = path.join(process.cwd(), 'test', `.house-correct-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
    const { setHouseWorkspace } = await import('../../backend/services/house-workspace.js');
    await setHouseWorkspace(WALLET, ground);
    const heard = [];
    const streams = [
      sseResponse(['[TOOL: no_such__tool {"pattern": "doc"}]']),
      sseResponse(['The search would not run — but here is what I actually think.']),
    ];
    const deps = {
      ...scriptedDeps({ hands: { ember: ['OPEN\nI must check the files.'], sable: ['REST'] } }),
      stream: async (messages) => { heard.push(messages.at(-1)); return streams.shift() ?? sseResponse(['(dry)']); },
      ensureRoots: async () => {},
      tools: () => [{ server: 'filesystem', name: 'search_files', description: 'search' }],
      callTool: async () => { throw new Error('nothing should execute for a refused aim'); },
    };
    const conn = makeConnection();
    try {
      await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: 'Founder' }, { ownsNeumaLane }, deps);
      conn.councilRun.deps = { ...conn.councilRun.deps, ...deps };
      await councilSay(conn, { thought: 'Check the docs.', urgency: 'hold' });

      // The correction reached the member, naming the miss and the real tools.
      const correction = heard.find((m) => m.role === 'user' && /did not run/.test(m.content));
      expect(correction).toBeDefined();
      expect(correction.content).toMatch(/no_such\/tool/);
      expect(correction.content).toMatch(/search_files/);

      // And the turn ended with WORDS, not a dead chip: the spoken record
      // carries the second round's speech.
      expect(conn.councilRun.transcript.some((t) => t.speaker === 'ember'
        && t.content.includes('here is what I actually think'))).toBe(true);
    } finally {
      closeCouncil(conn);
      rmSync(ground, { recursive: true, force: true });
    }
  });
});

describe("the operator's gate on the ground's edge — asks, never flat walls", () => {
  const houseTest = async ({ decisions, secondCall = false }) => {
    const ground = path.join(process.cwd(), 'test', `.house-gate-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
    const { setHouseWorkspace } = await import('../../backend/services/house-workspace.js');
    await setHouseWorkspace(WALLET, ground);
    const asked = [];
    const executed = [];
    const widened = [];
    const outsideDoc = path.resolve('/mnt/elsewhere/docs/governance/house-roles.md');
    const streams = [
      sseResponse([`[TOOL: filesystem/read_text_file {"path": "${outsideDoc}"}]`]),
      ...(secondCall ? [sseResponse([`[TOOL: filesystem/read_text_file {"path": "${outsideDoc}"}]`])] : []),
      sseResponse(['I have what I need.']),
    ];
    const deps = {
      ...scriptedDeps({ hands: { ember: ['OPEN\nI need the record.'], sable: ['REST'] } }),
      stream: async () => streams.shift() ?? sseResponse(['(dry)']),
      ensureRoots: async (dirs) => { widened.push(...dirs); },
      tools: () => [{ server: 'filesystem', name: 'read_text_file', description: 'read' }],
      requestApproval: async (connection, req) => { asked.push(req); return decisions.shift(); },
      callTool: async (run, member, call, extraRoots) => {
        executed.push({ toolName: call.toolName, path: call.args.path, extraRoots });
        return { content: [{ type: 'text', text: 'the canon' }] };
      },
    };
    const conn = makeConnection();
    try {
      await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: 'Founder' }, { ownsNeumaLane }, deps);
      conn.councilRun.deps = { ...conn.councilRun.deps, ...deps };
      await councilSay(conn, { thought: 'Read the canon.', urgency: 'hold' });
      // Captured BEFORE the finally closes the room (close nulls councilRun).
      return { conn, run: conn.councilRun, asked, executed, widened, outsideDoc };
    } finally {
      closeCouncil(conn);
      rmSync(ground, { recursive: true, force: true });
    }
  };

  it('an outside read ASKS the witness — ALLOW carries that one call, nothing persists', async () => {
    const { conn, run, asked, executed, widened, outsideDoc } = await houseTest({ decisions: ['allow'] });
    expect(asked).toHaveLength(1);
    expect(asked[0].surface).toBe('council');
    expect(asked[0].scope).toMatch(/Ember asks to READ outside the house ground/);
    expect(asked[0].scope).toContain(outsideDoc);
    // The call ran, carried by a one-shot root; nothing persisted on the run.
    expect(executed).toHaveLength(1);
    expect(executed[0].extraRoots).toEqual([path.dirname(outsideDoc)]);
    expect(widened).toContain(path.dirname(outsideDoc));
    expect(run.granted?.ember?.read ?? []).toEqual([]);
  });

  it('DENY refuses honestly in words the member hears — nothing executes', async () => {
    const { conn, executed } = await houseTest({ decisions: ['deny'] });
    expect(executed).toHaveLength(0);
    const refusal = framesOf(conn, 'council:tool').find((f) => f.ok === false);
    expect(refusal.error).toBe('the operator denied it');
  });

  it('ALWAYS grants the directory for the REST OF THE SITTING — the second call never asks', async () => {
    const { run, asked, executed, outsideDoc } = await houseTest({ decisions: ['always'], secondCall: true });
    expect(asked).toHaveLength(1); // one ask, two calls
    expect(executed).toHaveLength(2);
    // The grant is EMBER'S — grants are per-seat, never sitting-wide (Founder's
    // law, 2026-07-26: an ALWAYS given about one seat's ask must not silently
    // widen another, least of all across the house/external line).
    expect(run.granted.ember.read).toEqual([path.dirname(outsideDoc)]);
    expect(run.granted.sable).toBeUndefined();
  });

  it('a call INSIDE the house ground never asks at all', async () => {
    const ground = path.join(process.cwd(), 'test', `.house-inside-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
    const { setHouseWorkspace } = await import('../../backend/services/house-workspace.js');
    await setHouseWorkspace(WALLET, ground);
    const asked = [];
    const streams = [
      sseResponse([`[TOOL: filesystem/read_text_file {"path": "${path.join(ground, 'notes.md')}"}]`]),
      sseResponse(['Read it.']),
    ];
    const deps = {
      ...scriptedDeps({ hands: { ember: ['OPEN\nx'], sable: ['REST'] } }),
      stream: async () => streams.shift() ?? sseResponse(['(dry)']),
      ensureRoots: async () => {},
      tools: () => [{ server: 'filesystem', name: 'read_text_file', description: 'read' }],
      requestApproval: async () => { asked.push(1); return 'deny'; },
      callTool: async () => ({ content: [{ type: 'text', text: 'notes' }] }),
    };
    const conn = makeConnection();
    try {
      await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: 'Founder' }, { ownsNeumaLane }, deps);
      conn.councilRun.deps = { ...conn.councilRun.deps, ...deps };
      await councilSay(conn, { thought: 'Read the notes.', urgency: 'hold' });
      expect(asked).toHaveLength(0);
    } finally {
      closeCouncil(conn);
      rmSync(ground, { recursive: true, force: true });
    }
  });
});

describe('the room deletes on the card, never on faith', () => {
  it('a delete INSIDE the ground asks, then REALLY unlinks (no stub — the true houseCallTool path); ALWAYS covers the sitting', async () => {
    // GNOSIS (echo finding 2026-07-23): callTool is NOT stubbed here — the
    // council's real default executor runs (houseCallTool → sandbox → local
    // unlink), so this proves the approval gate AND the disk truth together.
    const ground = path.join(process.cwd(), 'test', `.house-del-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
    const { setHouseWorkspace } = await import('../../backend/services/house-workspace.js');
    await setHouseWorkspace(WALLET, ground);
    mkdirSync(ground, { recursive: true });
    const asked = [];
    const target1 = path.join(ground, 'old-map.md');
    const target2 = path.join(ground, 'old-roles.md');
    writeFileSync(target1, 'the old map');
    writeFileSync(target2, 'the old roles');
    const streams = [
      sseResponse([`[TOOL: filesystem/delete_file {"path": "${target1}"}]`]),
      sseResponse([`[TOOL: filesystem/delete_file {"path": "${target2}"}]`]),
      sseResponse(['The ground is clean.']),
    ];
    const deps = {
      ...scriptedDeps({ hands: { ember: ['OPEN\nI will clean the folder.'], sable: ['REST'] } }),
      stream: async () => streams.shift() ?? sseResponse(['(dry)']),
      ensureRoots: async () => {},
      tools: () => [{ server: 'filesystem', name: 'delete_file', description: 'delete' }],
      requestApproval: async (connection, req) => { asked.push(req.scope); return 'always'; },
    };
    const conn = makeConnection();
    try {
      await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: 'Founder' }, { ownsNeumaLane }, deps);
      conn.councilRun.deps = { ...conn.councilRun.deps, ...deps };
      await councilSay(conn, { thought: 'Clean the house folder.', urgency: 'hold' });
      // One card for the FIRST delete (inside the ground!), naming the act;
      // the sitting's ALWAYS covered the second.
      expect(asked).toHaveLength(1);
      expect(asked[0]).toMatch(/asks to DELETE/);
      expect(asked[0]).toContain(target1);
      // The files are GONE from the real disk — the card led to a true act.
      expect(existsSync(target1)).toBe(false);
      expect(existsSync(target2)).toBe(false);
      // And the members heard honest results, not canned ones.
      const toolFrames = framesOf(conn, 'council:tool').filter((f) => f.tool === 'delete_file');
      expect(toolFrames.some((f) => f.ok === true)).toBe(true);
    } finally {
      closeCouncil(conn);
      rmSync(ground, { recursive: true, force: true });
    }
  });

  it('an OUTSIDE-ground delete wears the DELETE verb on its card — never WRITE (echo finding)', async () => {
    const ground = path.join(process.cwd(), 'test', `.house-delout-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
    const elsewhere = path.join(process.cwd(), 'test', `.elsewhere-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
    const { setHouseWorkspace } = await import('../../backend/services/house-workspace.js');
    await setHouseWorkspace(WALLET, ground);
    mkdirSync(ground, { recursive: true });
    mkdirSync(elsewhere, { recursive: true });
    const target = path.join(elsewhere, 'stray.md');
    writeFileSync(target, 'x');
    const asked = [];
    const streams = [
      sseResponse([`[TOOL: filesystem/delete_file {"path": "${target}"}]`]),
      sseResponse(['Done.']),
    ];
    const deps = {
      ...scriptedDeps({ hands: { ember: ['OPEN\nCleaning.'], sable: ['REST'] } }),
      stream: async () => streams.shift() ?? sseResponse(['(dry)']),
      ensureRoots: async () => {},
      tools: () => [{ server: 'filesystem', name: 'delete_file', description: 'delete' }],
      requestApproval: async (connection, req) => { asked.push(req.scope); return 'deny'; },
    };
    const conn = makeConnection();
    try {
      await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: 'Founder' }, { ownsNeumaLane }, deps);
      conn.councilRun.deps = { ...conn.councilRun.deps, ...deps };
      await councilSay(conn, { thought: 'Remove the stray.', urgency: 'hold' });
      expect(asked).toHaveLength(1);
      expect(asked[0]).toMatch(/asks to DELETE outside the house ground/);
      expect(asked[0]).not.toMatch(/WRITE/);
      expect(existsSync(target)).toBe(true); // denied — untouched
    } finally {
      closeCouncil(conn);
      rmSync(ground, { recursive: true, force: true });
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// THE FOCUS GROUND in the room (Design note, 2026-07-26 — the folder standing open in
// the Explorer is the ground EVERY seat works, superseding both older answers:
// the house workspace a housemate got, and the raised cross-house ground an
// external seat needed. The room must never name one folder and work another.
// ---------------------------------------------------------------------------
describe('the room works the folder the operator has open', () => {
  it('the focus ground supersedes the house workspace for a housemate', async () => {
    const house = path.join(process.cwd(), 'test', `.house-focus-h-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
    const focused = path.join(process.cwd(), 'test', `.house-focus-f-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(focused, { recursive: true });
    const { setHouseWorkspace } = await import('../../backend/services/house-workspace.js');
    await setHouseWorkspace(WALLET, house);
    const deps = { ...scriptedDeps({ hands: { ember: ['REST'], sable: ['REST'] } }), ensureRoots: async () => {} };
    const conn = makeConnection();
    // Exactly how portal-routes stamps it from the desk's validated focus.
    conn.toolWorkspace = focused;
    try {
      await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: 'Founder' }, { ownsNeumaLane }, deps);
      const opened = framesOf(conn, 'council:opened')[0];
      // Every seat stands on the focused folder, not the house workspace.
      expect(opened.grounds.ember).toBe(focused);
      expect(opened.grounds.sable).toBe(focused);
      expect(opened.grounds.ember).not.toBe(path.resolve(house));
    } finally {
      rmSync(house, { recursive: true, force: true });
      rmSync(focused, { recursive: true, force: true });
    }
  });

  it('an unfocused desk still falls back to the house workspace', async () => {
    // Removing the fallback would strand every existing sitting; focus only
    // supersedes it while a folder is actually open.
    const house = path.join(process.cwd(), 'test', `.house-focus-n-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
    const { setHouseWorkspace } = await import('../../backend/services/house-workspace.js');
    await setHouseWorkspace(WALLET, house);
    const deps = { ...scriptedDeps({ hands: { ember: ['REST'], sable: ['REST'] } }), ensureRoots: async () => {} };
    const conn = makeConnection(); // no toolWorkspace — desk unfocused
    try {
      await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: 'Founder' }, { ownsNeumaLane }, deps);
      expect(framesOf(conn, 'council:opened')[0].grounds.ember).toBe(path.resolve(house));
    } finally {
      rmSync(house, { recursive: true, force: true });
    }
  });

  it('moving the Explorer mid-sitting moves the room with it', async () => {
    const first = path.join(process.cwd(), 'test', `.house-move-a-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
    const second = path.join(process.cwd(), 'test', `.house-move-b-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(first, { recursive: true });
    mkdirSync(second, { recursive: true });
    const deps = { ...scriptedDeps({ hands: { ember: ['REST'], sable: ['REST'] } }), ensureRoots: async () => {} };
    const conn = makeConnection();
    conn.toolWorkspace = first;
    try {
      await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: 'Founder' }, { ownsNeumaLane }, deps);
      conn.councilRun.deps = deps;
      expect(framesOf(conn, 'council:opened')[0].grounds.ember).toBe(first);
      // The operator opens a different folder, then speaks again.
      conn.toolWorkspace = second;
      await councilSay(conn, { thought: 'Carry on.', urgency: 'hold' });
      expect(conn.councilRun.focusGround).toBe(second);
    } finally {
      rmSync(first, { recursive: true, force: true });
      rmSync(second, { recursive: true, force: true });
    }
  });
});
