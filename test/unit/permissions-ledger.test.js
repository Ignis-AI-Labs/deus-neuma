/**
 * permissions-ledger — reading back what the operator has permanently granted.
 *
 * Why (2026-08-30): the operator needs one place to see every permission
 * granted to any house member — the permanent ones above all — so nothing
 * granted goes unwatched.
 *
 * RULE 0: every function here is pure and is called with REAL policy shapes —
 * built by the actual writers (`addAllowedTool`, `addGrantedReadRoot`,
 * `addGrantedWriteRoot`, `addSensitiveGrant`), not hand-typed guesses at what
 * they produce. If a writer changes shape, these go red, which is the whole
 * point: an audit surface that reads a shape nobody writes any more would show
 * an empty list and call it safety.
 */
import { describe, test, expect } from 'vitest';
import {
  addAllowedTool, addGrantedReadRoot, addGrantedWriteRoot,
} from '../../backend/services/tool-policy.js';
import { addSensitiveGrant } from '../../backend/services/sensitive-grants.js';
import {
  GRANT_KINDS, serverSense, shortPath, beingPermissions, housePermissions,
} from '../../backend/services/permissions-ledger.js';

const HAZEL = { neumaId: 'hazel', name: 'Hazel', kind: 'local' };

/** A policy built by the REAL writers, exactly as a live ALWAYS click builds it. */
const realPolicy = () => {
  let p = null;
  p = addAllowedTool(p, 'web', 'web_search');
  p = addAllowedTool(p, 'web', 'web_fetch');
  p = addAllowedTool(p, 'image', 'render_card');
  p = addGrantedReadRoot(p, '/workspace/repos/neuma/docs');
  p = addGrantedWriteRoot(p, '/workspace/repos/project-puzulas/hazel');
  p = addSensitiveGrant(p, 'read', '/workspace/repos/neuma/.env.example');
  return p;
};

describe('the shapes the real writers produce are the shapes we read', () => {
  test('every granted act is found, one row per tool', () => {
    const r = beingPermissions(HAZEL, realPolicy());
    expect(r.grants.act.map((a) => `${a.server}/${a.tool}`)).toEqual([
      'image/render_card', 'web/web_fetch', 'web/web_search',
    ]);
  });

  test('folders and files are found through their own writers', () => {
    const r = beingPermissions(HAZEL, realPolicy());
    expect(r.grants.folder.map((f) => f.full)).toEqual([
      '/workspace/repos/project-puzulas/hazel',   // write first
      '/workspace/repos/neuma/docs',
    ]);
    expect(r.grants.file.map((f) => f.full)).toEqual(['/workspace/repos/neuma/.env.example']);
  });

  test('pathGrants and sensitiveGrants are NOT read as tool servers', () => {
    // They live in the same object as the servers. Treating them as one would
    // invent a "pathGrants" tool family in the operator's audit list.
    const r = beingPermissions(HAZEL, realPolicy());
    expect(r.grants.act.some((a) => a.server === 'pathGrants')).toBe(false);
    expect(r.grants.act.some((a) => a.server === 'sensitiveGrants')).toBe(false);
  });

  test('the total counts every kind', () => {
    // 3 acts + 2 folders + 1 file + 0 spend
    expect(beingPermissions(HAZEL, realPolicy()).total).toBe(6);
  });
});

describe('WRITE is the escalation, and it reads first', () => {
  test('a write-granted folder is listed once, as write', () => {
    // addGrantedWriteRoot's own doc says write also grants read. Listing the
    // same folder twice would overstate how many decisions the operator made.
    let p = addGrantedWriteRoot(null, '/repo/app');
    p = addGrantedReadRoot(p, '/repo/app');
    const folders = beingPermissions(HAZEL, p).grants.folder;
    expect(folders).toHaveLength(1);
    expect(folders[0].access).toBe('write');
  });

  test('write sorts above read', () => {
    let p = addGrantedReadRoot(null, '/repo/aaa-read');
    p = addGrantedWriteRoot(p, '/repo/zzz-write');
    expect(beingPermissions(HAZEL, p).grants.folder.map((f) => f.access))
      .toEqual(['write', 'read']);
  });

  test('an edit-granted file is listed once, as edit', () => {
    let p = addSensitiveGrant(null, 'edit', '/repo/secrets.json');
    p = addSensitiveGrant(p, 'read', '/repo/secrets.json');
    const files = beingPermissions(HAZEL, p).grants.file;
    expect(files).toHaveLength(1);
    expect(files[0].access).toBe('edit');
  });
});

describe('ABSENT IS NOT EMPTY', () => {
  test('a lane with no policy has no grants, and says total 0', () => {
    const r = beingPermissions(HAZEL, null);
    expect(r.unreadable).toBe(false);
    expect(r.total).toBe(0);
    for (const k of GRANT_KINDS) expect(r.grants[k]).toEqual([]);
  });

  test('a lane that could NOT be read says so, and refuses to report a total', () => {
    // The failure this guards: rendering "no permissions" for a lane we simply
    // could not open is a reassuring blank where the honest answer is
    // […] — the worst possible lie in an audit surface.
    const r = beingPermissions(HAZEL, null, null, { unreadable: true });
    expect(r.unreadable).toBe(true);
    expect(r.total).toBe(null);
  });

  test('the house names unreadable lanes rather than folding them into a total', () => {
    const house = housePermissions([
      beingPermissions({ neumaId: 'a', name: 'A' }, addAllowedTool(null, 'web', 'web_search')),
      beingPermissions({ neumaId: 'b', name: 'B' }, null, null, { unreadable: true }),
    ]);
    expect(house.unreadable).toBe(1);
    expect(house.totals.act).toBe(1);
    // …and the lane needing attention sorts to the very top.
    expect(house.beings[0].neumaId).toBe('b');
  });
});

describe('DEFAULTS ARE NOT GRANTS', () => {
  test('only what is IN the lane file is reported', () => {
    // `platform_data`, `flight_check`, `memory_search` and many others are
    // allowed by GLOBAL_DEFAULTS. None was chosen by the operator, and listing
    // them here would bury the handful he actually decided under dozens he
    // did not. This surface reads the lane file and resolves nothing.
    const r = beingPermissions(HAZEL, addAllowedTool(null, 'web', 'web_search'));
    expect(r.total).toBe(1);
    expect(r.grants.act.map((a) => a.tool)).toEqual(['web_search']);
  });
});

describe('the wallet allowlist is a permission too', () => {
  test('recipients are read from their own file', () => {
    const r = beingPermissions(HAZEL, null, {
      version: 1,
      entries: [{ address: '0xabc', label: 'Ops wallet' }, { address: '0xdef' }],
    });
    expect(r.grants.spend).toHaveLength(2);
    expect(r.grants.spend[0].label).toBe('Ops wallet');
    expect(r.grants.spend[1].full).toBe('0xdef');
  });

  test('no allowlist is no spend grants — default-deny, not an error', () => {
    expect(beingPermissions(HAZEL, null, null).grants.spend).toEqual([]);
  });
});

describe('reading it as a person', () => {
  test('servers get plain words', () => {
    expect(serverSense('web').label).toBe('THE OPEN WEB');
    expect(serverSense('fs').label).toBe('FILES');
  });

  test('an UNKNOWN server is shown, never hidden', () => {
    // A new tool family must not go invisible in the audit surface merely
    // because this map was not updated — silence here is a security hole.
    expect(serverSense('brand-new-thing').label).toBe('BRAND-NEW-THING');
  });

  test('long paths keep their tail, which is what identifies them', () => {
    expect(shortPath('/a/b/c/d/e/f')).toBe('…/d/e/f');
    expect(shortPath('/a/b')).toBe('/a/b');
  });
});

describe('the house list is built to be SCANNED', () => {
  test('beings with the most grants read first; empty lanes sink', () => {
    const many = beingPermissions({ neumaId: 'many', name: 'Many' }, realPolicy());
    const none = beingPermissions({ neumaId: 'none', name: 'None' }, null);
    const one = beingPermissions({ neumaId: 'one', name: 'One' }, addAllowedTool(null, 'web', 'web_fetch'));
    const house = housePermissions([none, one, many]);
    expect(house.beings.map((b) => b.neumaId)).toEqual(['many', 'one', 'none']);
  });

  test('house totals count each kind across every being', () => {
    const house = housePermissions([
      beingPermissions({ neumaId: 'a' }, realPolicy()),
      beingPermissions({ neumaId: 'b' }, addGrantedWriteRoot(null, '/repo/x')),
    ]);
    expect(house.totals).toEqual({ act: 3, folder: 3, file: 1, spend: 0 });
  });

  test('an empty house is empty, not broken', () => {
    const house = housePermissions([]);
    expect(house.beings).toEqual([]);
    expect(house.unreadable).toBe(0);
    expect(house.totals).toEqual({ act: 0, folder: 0, file: 0, spend: 0 });
  });
});
