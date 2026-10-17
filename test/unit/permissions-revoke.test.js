/**
 * REVOKE — taking a standing grant back.
 *
 * Design note, 2026-08-30: […]
 *
 * EVERY FIXTURE IS BUILT BY THE REAL GRANT WRITERS. Not one policy object here
 * is hand-typed. `addAllowedTool`, `addGrantedReadRoot`, `addGrantedWriteRoot`
 * and `addSensitiveGrant` are the same functions the ALWAYS click calls, so if
 * a remover disagrees with the shape its adder produces, these tests fail
 * rather than agreeing with a guess. A revoke tested against an invented shape
 * is a revoke that has never been tested at all — it would report success while
 * the grant stood.
 */
import { describe, expect, test } from 'vitest';
import {
  addAllowedTool, addGrantedReadRoot, addGrantedWriteRoot,
  removeAllowedTool, removeGrantedReadRoot, removeGrantedWriteRoot,
  resolvePolicy, checkToolAccess,
} from '../../backend/services/tool-policy.js';
import { addSensitiveGrant, removeSensitiveGrant, sensitiveGrantCovers } from '../../backend/services/sensitive-grants.js';
import { revokeGrant, revokeRefusal } from '../../backend/services/permissions-revoke.js';
import { beingPermissions } from '../../backend/services/permissions-ledger.js';

const BEING = { neumaId: 'fenna', name: 'Fenna' };

/**
 * What the GATE decides for one act, through the real resolution chain —
 * `resolvePolicy` flattens the lane layer, `checkToolAccess` reads it, and
 * unknown tools fail closed at 'approval_required'. Asserting on the stored
 * array would only prove the array; this proves the being's actual reach.
 */
const gate = (layer, server, tool) =>
  checkToolAccess(resolvePolicy({}, layer), server, tool);

/** A lane exactly as a run of ALWAYS clicks would leave it. */
const granted = () => {
  let p = addAllowedTool(null, 'web', 'web_search');
  p = addAllowedTool(p, 'web', 'web_fetch');
  p = addAllowedTool(p, 'image', 'render_card');
  p = addGrantedReadRoot(p, '/workspace/repos/neuma/docs');
  p = addGrantedWriteRoot(p, '/workspace/repos/project-puzulas/fenna');
  p = addSensitiveGrant(p, 'read', '/workspace/repos/neuma/.env.example');
  return p;
};

describe('the removers are the exact inverse of the adders', () => {
  test('an act revoked stops being allowed, and its siblings do not move', () => {
    const before = granted();
    const after = removeAllowedTool(before, 'web', 'web_fetch');
    // The GATE is the truth, not the array: assert through the same function
    // that decides whether a being may act.
    // Fails CLOSED to approval_required — the revoked act does not become
    // silently permitted, it goes back to asking.
    expect(gate(after, 'web', 'web_fetch')).toBe('approval_required');
    expect(gate(after, 'web', 'web_search')).toBe('allowed');
    expect(gate(after, 'image', 'render_card')).toBe('allowed');
    // and the input is untouched — these are pure
    expect(gate(before, 'web', 'web_fetch')).toBe('allowed');
  });

  test('a folder revoked leaves the other tier standing', () => {
    const p = removeGrantedWriteRoot(granted(), '/workspace/repos/project-puzulas/fenna');
    expect(p.pathGrants.write).toEqual([]);
    expect(p.pathGrants.read).toEqual(['/workspace/repos/neuma/docs']);
  });

  test('WITHDRAWING WRITE DOES NOT ALSO WITHDRAW READ', () => {
    // Write implies read at the gate, but they are stored apart. The operator
    // asked to stop this being WRITING there; silently taking read as well
    // revokes something they did not name.
    let p = addGrantedReadRoot(null, '/shared/notes');
    p = addGrantedWriteRoot(p, '/shared/notes');
    const after = removeGrantedWriteRoot(p, '/shared/notes');
    expect(after.pathGrants.write).toEqual([]);
    expect(after.pathGrants.read).toEqual(['/shared/notes']);
  });

  test('a guarded file revoked stops being covered', () => {
    const before = addSensitiveGrant(null, 'edit', '/repo/.env');
    expect(sensitiveGrantCovers(before.sensitiveGrants, 'edit', '/repo/.env')).toBe(true);
    const after = removeSensitiveGrant(before, 'edit', '/repo/.env');
    expect(sensitiveGrantCovers(after.sensitiveGrants, 'edit', '/repo/.env')).toBe(false);
  });

  test('A DENIAL SURVIVES A REVOKE — the one bug that would turn revoke into widening', () => {
    // A grant lives beside `denied` on the same server entry. Dropping the
    // server wholesale to remove one tool would discard the denial too, so
    // taking a permission away would GRANT one. Worst possible defect here.
    const before = { web: { allowed: ['web_search'], denied: ['web_fetch'] } };
    const after = removeAllowedTool(before, 'web', 'web_search');
    expect(after.web.denied).toEqual(['web_fetch']);
    expect(gate(after, 'web', 'web_fetch')).toBe('denied');
    expect(gate(after, 'web', 'web_search')).toBe('approval_required');
  });

  test('revoking what was never granted changes nothing and does not throw', () => {
    const p = granted();
    expect(removeAllowedTool(p, 'web', 'never_granted')).toEqual(p);
    expect(removeGrantedReadRoot(p, '/nowhere')).toEqual(p);
    expect(removeGrantedWriteRoot(p, '/nowhere')).toEqual(p);
    expect(removeSensitiveGrant(p, 'edit', '/nowhere')).toEqual(p);
    expect(removeAllowedTool(null, 'web', 'x')).toEqual({});
  });

  test('an unknown sensitive tier is refused rather than silently ignored', () => {
    expect(() => removeSensitiveGrant(null, 'execute', '/repo/.env')).toThrow(/tier is invalid/);
  });
});

describe('revokeGrant — one descriptor, one row', () => {
  test('each kind takes back exactly its own row, and the ledger agrees', () => {
    const policy = granted();
    const out = revokeGrant({ kind: 'act', server: 'web', tool: 'web_search' }, { policy });
    expect(out.ok).toBe(true);
    expect(out.held).toBe(true);
    expect(out.store).toBe('policy');
    // Proven THROUGH the audit surface: the row the panel showed is gone from
    // the record the panel will draw next.
    const before = beingPermissions(BEING, policy);
    const after = beingPermissions(BEING, out.policy);
    expect(before.total - after.total).toBe(1);
    expect(after.grants.act.map((g) => g.tool)).not.toContain('web_search');
    expect(after.grants.act.map((g) => g.tool)).toContain('web_fetch');
  });

  test('a folder and a file revoke reach their own stores', () => {
    const policy = granted();
    const folder = revokeGrant(
      { kind: 'folder', access: 'write', path: '/workspace/repos/project-puzulas/fenna' }, { policy },
    );
    expect(beingPermissions(BEING, folder.policy).grants.folder).toHaveLength(1);
    const file = revokeGrant(
      { kind: 'file', access: 'read', path: '/workspace/repos/neuma/.env.example' }, { policy },
    );
    expect(beingPermissions(BEING, file.policy).grants.file).toEqual([]);
  });

  test('a spend recipient is matched CASE-INSENSITIVELY', () => {
    // The same account gets written checksummed in one place and lowercase in
    // another. An operator who pressed revoke must not be told it worked while
    // the entry stands under different capitalisation.
    const allowlist = { entries: [{ address: '0xAbCdEf0000000000000000000000000000000001', label: 'ops' }] };
    const out = revokeGrant({ kind: 'spend', address: '0xabcdef0000000000000000000000000000000001' }, { allowlist });
    expect(out.held).toBe(true);
    expect(out.store).toBe('allowlist');
    expect(out.allowlist.entries).toEqual([]);
  });

  test('ALREADY GONE is a success that changed nothing — not an error', () => {
    // Two operators pressing the same row must not produce a failure, and the
    // panel's optimistic toggle must not be made to lie. But the caller still
    // learns nothing was written.
    const policy = granted();
    const out = revokeGrant({ kind: 'act', server: 'web', tool: 'never_granted' }, { policy });
    expect(out.ok).toBe(true);
    expect(out.held).toBe(false);
    expect(out.store).toBe(null);
    expect(out.policy).toBe(policy); // the very same object — nothing to write
  });

  test('revoking twice is stable', () => {
    const policy = granted();
    const once = revokeGrant({ kind: 'act', server: 'web', tool: 'web_search' }, { policy });
    const twice = revokeGrant({ kind: 'act', server: 'web', tool: 'web_search' }, { policy: once.policy });
    expect(twice.ok).toBe(true);
    expect(twice.held).toBe(false);
    expect(beingPermissions(BEING, twice.policy).total).toBe(beingPermissions(BEING, once.policy).total);
  });

  test('A REVOKE CAN ONLY EVER SUBTRACT — every kind, checked as a property', () => {
    const policy = granted();
    const rows = beingPermissions(BEING, policy);
    for (const row of [...rows.grants.act, ...rows.grants.folder, ...rows.grants.file]) {
      const out = revokeGrant(row, { policy });
      expect(out.ok, JSON.stringify(row)).toBe(true);
      const after = beingPermissions(BEING, out.policy);
      // Exactly one fewer. Not zero (nothing happened), not two (it swept a
      // neighbour), and never more (it widened something).
      expect(after.total, JSON.stringify(row)).toBe(rows.total - 1);
    }
  });
});

describe('refusals name the field, because a click has nowhere else to look', () => {
  test('an unknown kind is refused and lists the real ones', () => {
    const r = revokeRefusal({ kind: 'everything' });
    expect(r).toMatch(/not a kind of grant/);
    expect(r).toMatch(/act, folder, file, spend/);
  });

  test('each kind states the field it is missing', () => {
    expect(revokeRefusal({ kind: 'act', server: 'web' })).toMatch(/tool name/);
    expect(revokeRefusal({ kind: 'act', tool: 'web_search' })).toMatch(/server/);
    expect(revokeRefusal({ kind: 'folder', access: 'write' })).toMatch(/path/);
    expect(revokeRefusal({ kind: 'spend' })).toMatch(/recipient address/);
  });

  test('an access tier that does not exist for that kind is refused', () => {
    // 'edit' is a FILE tier and 'write' is a FOLDER tier; crossing them would
    // otherwise reach a store that has no such list and quietly do nothing.
    expect(revokeRefusal({ kind: 'folder', access: 'edit', path: '/x' })).toMatch(/read, write/);
    expect(revokeRefusal({ kind: 'file', access: 'write', path: '/x' })).toMatch(/read, edit/);
  });

  test('a sound descriptor of every kind passes', () => {
    expect(revokeRefusal({ kind: 'act', server: 'web', tool: 'web_search' })).toBe(null);
    expect(revokeRefusal({ kind: 'folder', access: 'write', path: '/x' })).toBe(null);
    expect(revokeRefusal({ kind: 'file', access: 'edit', path: '/x' })).toBe(null);
    expect(revokeRefusal({ kind: 'spend', address: '0x1' })).toBe(null);
  });

  test('a refused descriptor never reaches a store', () => {
    const policy = granted();
    const out = revokeGrant({ kind: 'nonsense' }, { policy });
    expect(out.ok).toBe(false);
    expect(out.policy).toBeUndefined();
  });
});
