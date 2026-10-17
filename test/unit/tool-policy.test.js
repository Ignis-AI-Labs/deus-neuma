import { describe, it, expect } from 'vitest';
import { resolvePolicy, checkToolAccess, GLOBAL_DEFAULTS, TOOL_MODES, normalizeToolMode, applyToolMode, annotateToolAccess, addAllowedTool, addGrantedReadRoot, addGrantedWriteRoot } from '../../backend/services/tool-policy.js';

describe('resolvePolicy', () => {
  it('builds policy from global defaults', () => {
    const policy = resolvePolicy(GLOBAL_DEFAULTS);
    expect(policy['fs/read']).toBe('allowed');
    // Irreversible — every delete asks until the operator grants ALWAYS.
    expect(policy['filesystem/delete_file']).toBe('approval_required');
  });

  it('grants a neuma write access to the fs primitives (enforcement is in the sandbox)', () => {
    // Writing its own record/memory/DNA is core to a neuma's being — not gated
    // behind per-write approval. Confinement is enforced in tool-sandbox.js;
    // the delete sub-op is destructive, so it ASKS by default (2026-07-23 —
    // its outright denial made a being fake deletions by overwriting files).
    const policy = resolvePolicy(GLOBAL_DEFAULTS);
    for (const tool of ['read', 'write', 'edit', 'list', 'search']) {
      expect(policy[`fs/${tool}`], `${tool} should be allowed`).toBe('allowed');
    }
    expect(policy['filesystem/delete_file']).toBe('approval_required');
  });

  it('neuma overrides take precedence', () => {
    const overrides = {
      filesystem: { allowed: ['write_file'], denied: [], requireApproval: [] },
    };
    const policy = resolvePolicy(GLOBAL_DEFAULTS, overrides);
    expect(policy['filesystem/write_file']).toBe('allowed');
  });

  it('session overrides take highest precedence', () => {
    const neumaOverrides = {
      filesystem: { allowed: ['write_file'], denied: [], requireApproval: [] },
    };
    const sessionOverrides = {
      filesystem: { allowed: [], denied: ['write_file'], requireApproval: [] },
    };
    const policy = resolvePolicy(GLOBAL_DEFAULTS, neumaOverrides, sessionOverrides);
    expect(policy['filesystem/write_file']).toBe('denied');
  });

  it('handles null overrides', () => {
    const policy = resolvePolicy(GLOBAL_DEFAULTS, null, null);
    expect(policy['fs/read']).toBe('allowed');
  });

  it('lets local neuma execute in isolated code while retaining Git approval', () => {
    const policy = resolvePolicy(GLOBAL_DEFAULTS);
    expect(policy['coding/sandbox_status']).toBe('allowed');
    expect(policy['coding/inspect']).toBe('allowed');
    expect(policy['coding/execute']).toBe('allowed');
    expect(policy['coding/ground_git']).toBe('approval_required');
  });
});

describe('checkToolAccess', () => {
  it('returns access level from policy', () => {
    const policy = { 'filesystem/read_file': 'allowed', 'filesystem/delete_file': 'denied' };
    expect(checkToolAccess(policy, 'filesystem', 'read_file')).toBe('allowed');
    expect(checkToolAccess(policy, 'filesystem', 'delete_file')).toBe('denied');
  });

  it('defaults to approval_required for unknown tools (fail-closed)', () => {
    expect(checkToolAccess({}, 'unknown', 'unknown_tool')).toBe('approval_required');
  });

  it('returns approval_required', () => {
    const policy = { 'filesystem/write_file': 'approval_required' };
    expect(checkToolAccess(policy, 'filesystem', 'write_file')).toBe('approval_required');
  });
});

describe('normalizeToolMode', () => {
  it('passes valid modes through', () => {
    for (const mode of TOOL_MODES) expect(normalizeToolMode(mode)).toBe(mode);
  });

  it('fails unknown or malicious values to ask', () => {
    for (const raw of [undefined, null, '', 'bypass', 'ALLOW_ALL', 42, {}, ['auto']]) {
      expect(normalizeToolMode(raw)).toBe('ask');
    }
  });
});

describe('applyToolMode', () => {
  it('ask leaves every access level untouched', () => {
    for (const access of ['allowed', 'denied', 'approval_required']) {
      expect(applyToolMode(access, 'ask', 'write_file')).toBe(access);
    }
  });

  it('auto lifts approval_required to allowed but never widens a denial', () => {
    expect(applyToolMode('approval_required', 'auto', 'directory_tree')).toBe('allowed');
    expect(applyToolMode('allowed', 'auto', 'write_file')).toBe('allowed');
    expect(applyToolMode('denied', 'auto', 'delete_file')).toBe('denied');
  });

  it('observe holds every acting tool, even policy-allowed ones', () => {
    expect(applyToolMode('allowed', 'observe', 'write_file')).toBe('denied');
    expect(applyToolMode('approval_required', 'observe', 'wallet_send')).toBe('denied');
  });

  it('observe lets read-shaped tools keep their policy access', () => {
    expect(applyToolMode('allowed', 'observe', 'read')).toBe('allowed');
    expect(applyToolMode('approval_required', 'observe', 'read')).toBe('approval_required');
    expect(applyToolMode('denied', 'observe', 'read')).toBe('denied');
  });
});

describe('addAllowedTool', () => {
  it('grows a fresh layer from null', () => {
    expect(addAllowedTool(null, 'filesystem', 'directory_tree')).toEqual({
      filesystem: { allowed: ['directory_tree'] },
    });
  });

  it('appends to an existing server without duplicating', () => {
    const layer = { filesystem: { allowed: ['read_file'], denied: ['delete_file'] } };
    const once = addAllowedTool(layer, 'filesystem', 'directory_tree');
    const twice = addAllowedTool(once, 'filesystem', 'directory_tree');
    expect(twice.filesystem.allowed).toEqual(['read_file', 'directory_tree']);
    expect(twice.filesystem.denied).toEqual(['delete_file']);
  });

  it('never mutates the input layer', () => {
    const layer = Object.freeze({ filesystem: Object.freeze({ allowed: Object.freeze(['read_file']) }) });
    const next = addAllowedTool(layer, 'filesystem', 'directory_tree');
    expect(layer.filesystem.allowed).toEqual(['read_file']);
    expect(next.filesystem.allowed).toEqual(['read_file', 'directory_tree']);
  });

  it('a granted tool resolves to allowed through the full policy cascade', () => {
    const neumaLayer = addAllowedTool(null, 'filesystem', 'directory_tree');
    const policy = resolvePolicy(GLOBAL_DEFAULTS, neumaLayer);
    expect(checkToolAccess(policy, 'filesystem', 'directory_tree')).toBe('allowed');
  });
});

describe('the fs primitives', () => {
  it('the five being-facing filesystem tools are allowed by default (own-lane law)', () => {
    // The organ spellings are internal now (fs-primitives.js routes fs/* onto
    // them) — the tier lives on the name the being actually calls.
    const policy = resolvePolicy(GLOBAL_DEFAULTS);
    for (const tool of ['read', 'write', 'list', 'search', 'edit']) {
      expect(checkToolAccess(policy, 'fs', tool)).toBe('allowed');
    }
  });

  it('the retired organ spellings fail closed — no row, no silent allow', () => {
    const policy = resolvePolicy(GLOBAL_DEFAULTS);
    for (const tool of ['read_text_file', 'write_file', 'edit_file', 'list_directory']) {
      expect(checkToolAccess(policy, 'filesystem', tool)).toBe('approval_required');
    }
  });
});

describe('addGrantedReadRoot / pathGrants', () => {
  it('grows a fresh layer from null and dedupes', () => {
    const once = addGrantedReadRoot(null, '/proc');
    const twice = addGrantedReadRoot(once, '/proc');
    expect(twice.pathGrants.read).toEqual(['/proc']);
  });

  it('never mutates the input layer', () => {
    const layer = Object.freeze({ pathGrants: Object.freeze({ read: Object.freeze(['/a']) }) });
    const next = addGrantedReadRoot(layer, '/b');
    expect(layer.pathGrants.read).toEqual(['/a']);
    expect(next.pathGrants.read).toEqual(['/a', '/b']);
  });

  it('preserves tool-name rules alongside the grant', () => {
    const layer = addAllowedTool(null, 'filesystem', 'directory_tree');
    const next = addGrantedReadRoot(layer, '/proc');
    expect(next.filesystem.allowed).toEqual(['directory_tree']);
    expect(next.pathGrants.read).toEqual(['/proc']);
  });

  it('resolvePolicy treats pathGrants as reserved — it never leaks into the tool-name map', () => {
    const layer = addGrantedReadRoot(null, '/proc');
    const policy = resolvePolicy(GLOBAL_DEFAULTS, layer);
    expect(Object.keys(policy).some((k) => k.startsWith('pathGrants'))).toBe(false);
  });

  it('addGrantedWriteRoot records a write scope (deduped) without mutating the input', () => {
    const layer = addGrantedWriteRoot(null, '/repos/proj');
    expect(layer.pathGrants.write).toEqual(['/repos/proj']);
    const again = addGrantedWriteRoot(layer, '/repos/proj'); // dedup
    expect(again.pathGrants.write).toEqual(['/repos/proj']);
    expect(layer.pathGrants.write).toEqual(['/repos/proj']); // input untouched
  });

  it('read and write grants coexist on pathGrants and stay reserved from the tool map', () => {
    const layer = addGrantedWriteRoot(addGrantedReadRoot(null, '/ro'), '/rw');
    expect(layer.pathGrants).toEqual({ read: ['/ro'], write: ['/rw'] });
    const policy = resolvePolicy(GLOBAL_DEFAULTS, layer);
    expect(Object.keys(policy).some((k) => k.startsWith('pathGrants'))).toBe(false);
  });
});

describe('annotateToolAccess — the catalog carries the tier the gate will enforce', () => {
  const CATALOG = Object.freeze([
    Object.freeze({ server: 'fs', name: 'read', description: 'read' }),
    Object.freeze({ server: 'filesystem', name: 'delete_file', description: 'delete' }),
    Object.freeze({ server: 'web', name: 'web_fetch', description: 'fetch' }),
    Object.freeze({ server: 'nowhere', name: 'unknown_tool', description: 'unknown' }),
  ]);
  const POLICY = resolvePolicy(GLOBAL_DEFAULTS);
  const tierOf = (annotated, name) => annotated.find((t) => t.name === name).access;

  it('stamps each tool with the SAME answer checkToolAccess + applyToolMode give', () => {
    const annotated = annotateToolAccess(CATALOG, POLICY, 'ask');
    for (const tool of CATALOG) {
      const expected = applyToolMode(checkToolAccess(POLICY, tool.server, tool.name), 'ask', tool.name);
      expect(tierOf(annotated, tool.name)).toBe(expected);
    }
  });

  it('ask mode: reads are open, delete and egress ask, unknown fails closed', () => {
    const annotated = annotateToolAccess(CATALOG, POLICY, 'ask');
    expect(tierOf(annotated, 'read')).toBe('allowed');
    expect(tierOf(annotated, 'delete_file')).toBe('approval_required');
    expect(tierOf(annotated, 'web_fetch')).toBe('approval_required');
    expect(tierOf(annotated, 'unknown_tool')).toBe('approval_required');
  });

  it('auto mode keeps protected asks without a grant; observe holds everything that acts', () => {
    const auto = annotateToolAccess(CATALOG, POLICY, 'auto');
    expect(tierOf(auto, 'delete_file')).toBe('approval_required');
    expect(tierOf(auto, 'web_fetch')).toBe('allowed');

    const observe = annotateToolAccess(CATALOG, POLICY, 'observe');
    expect(tierOf(observe, 'read')).toBe('allowed');   // reading is observation
    expect(tierOf(observe, 'delete_file')).toBe('denied');
    expect(tierOf(observe, 'web_fetch')).toBe('denied');    // egress is not observation
  });

  it('an ALWAYS grant on the lane shows up in the catalog the being reads', () => {
    const granted = resolvePolicy(GLOBAL_DEFAULTS, addAllowedTool(null, 'web', 'web_fetch'));
    expect(tierOf(annotateToolAccess(CATALOG, granted, 'ask'), 'web_fetch')).toBe('allowed');
  });

  it('an explicit ALWAYS grant is honored for protected acts in AUTO', () => {
    const lane = { filesystem: { allowed: ['delete_file'] } };
    const policy = resolvePolicy(GLOBAL_DEFAULTS, lane);
    const explicit = resolvePolicy({}, lane);
    expect(tierOf(annotateToolAccess(CATALOG, policy, 'auto', explicit), 'delete_file')).toBe('allowed');
  });

  it('is pure — the input catalog is never mutated', () => {
    annotateToolAccess(CATALOG, POLICY, 'observe');
    expect(CATALOG.every((t) => t.access === undefined)).toBe(true);
  });

  it('an empty or missing catalog is an empty list, not a throw', () => {
    expect(annotateToolAccess([], POLICY, 'ask')).toEqual([]);
    expect(annotateToolAccess(null, POLICY, 'ask')).toEqual([]);
  });
});
