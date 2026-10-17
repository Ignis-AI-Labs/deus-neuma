/**
 * Map window — pure shaping of the architecture graph (grouping + indexing).
 * Tested without a DOM.
 */
import { describe, expect, it } from 'vitest';
import {
  groupRoutesByPrefix, groupChannelsByNamespace, isUnpaired, fileFunctionIndex, baseName,
  systemFocus, wireLayout, defnKindCounts, groupExternalByKind, groupStorageByKind,
  orderEnvVars, looksSecret, splitDuplicates, looksGuard,
} from '../../frontend/app/RelinkShell/map-view.js';

describe('groupRoutesByPrefix', () => {
  it('groups by prefix (sorted) with routes sorted by path', () => {
    const groups = groupRoutesByPrefix([
      { method: 'GET', path: '/api/b/z', prefix: '/api/b' },
      { method: 'GET', path: '/api/a/y', prefix: '/api/a' },
      { method: 'GET', path: '/api/a/a', prefix: '/api/a' },
    ]);
    expect(groups.map((g) => g.prefix)).toEqual(['/api/a', '/api/b']);
    expect(groups[0].routes.map((r) => r.path)).toEqual(['/api/a/a', '/api/a/y']);
  });
});

describe('groupChannelsByNamespace', () => {
  it('groups channels under their namespace', () => {
    const groups = groupChannelsByNamespace([
      { name: 'portal:b', namespace: 'portal', producers: [], consumers: [] },
      { name: 'wallet:a', namespace: 'wallet', producers: [], consumers: [] },
      { name: 'portal:a', namespace: 'portal', producers: [], consumers: [] },
    ]);
    expect(groups.map((g) => g.namespace)).toEqual(['portal', 'wallet']);
    expect(groups[0].channels.map((c) => c.name)).toEqual(['portal:a', 'portal:b']);
  });
});

describe('isUnpaired', () => {
  it('is true when a channel has only one side wired', () => {
    expect(isUnpaired({ producers: ['a'], consumers: [] })).toBe(true);
    expect(isUnpaired({ producers: [], consumers: ['b'] })).toBe(true);
    expect(isUnpaired({ producers: ['a'], consumers: ['b'] })).toBe(false);
    expect(isUnpaired({ producers: [], consumers: [] })).toBe(false);
  });
});

describe('fileFunctionIndex', () => {
  it('indexes functions and call edges per file, ranked by connectedness', () => {
    const idx = fileFunctionIndex(
      [{ file: 'a.js', name: 'x' }, { file: 'b.js', name: 'y' }],
      [{ from: 'a.js', to: 'b.js', via: ['y'], count: 2 }],
    );
    const a = idx.find((e) => e.file === 'a.js');
    const b = idx.find((e) => e.file === 'b.js');
    expect(a.fns.map((f) => f.name)).toEqual(['x']);
    expect(a.out).toHaveLength(1);
    expect(b.in).toHaveLength(1);
  });
  it('tallies definition kinds per file (function default, method, class)', () => {
    const idx = fileFunctionIndex([
      { file: 'e.js', name: 'Engine', kind: 'class' },
      { file: 'e.js', name: 'run', kind: 'method' },
      { file: 'e.js', name: 'top' }, // no kind → counts as function
    ], []);
    const e = idx.find((x) => x.file === 'e.js');
    expect(e.kinds).toEqual({ function: 1, method: 1, class: 1 });
  });
});

describe('groupExternalByKind', () => {
  it('groups egress by kind with site totals, files, and distinct hosts', () => {
    const groups = groupExternalByKind([
      { file: 'a.js', kind: 'http', count: 3, hosts: ['api.x'] },
      { file: 'b.js', kind: 'http', count: 1, hosts: [] },
      { file: 'c.js', kind: 'rpc', count: 1, hosts: ['base.org'] },
    ]);
    expect(groups.map((g) => g.kind)).toEqual(['http', 'rpc']);
    const http = groups.find((g) => g.kind === 'http');
    expect(http.sites).toBe(4);
    expect(http.files).toBe(2);
    expect(http.hosts).toEqual(['api.x']);
    expect(http.entries[0].file).toBe('a.js'); // heaviest first
  });
});

describe('groupStorageByKind', () => {
  it('groups fs access by read/write with site totals and files, heaviest first', () => {
    const groups = groupStorageByKind([
      { file: 'a.js', kind: 'write', count: 5 },
      { file: 'b.js', kind: 'read', count: 2 },
      { file: 'c.js', kind: 'read', count: 3 },
    ]);
    expect(groups.map((g) => g.kind)).toEqual(['read', 'write']);
    const read = groups.find((g) => g.kind === 'read');
    expect(read.sites).toBe(5);
    expect(read.files).toBe(2);
    expect(read.entries[0].file).toBe('c.js'); // 3 before 2
  });
});

describe('orderEnvVars', () => {
  it('sorts named vars by file-count desc and pins (dynamic) last', () => {
    const ordered = orderEnvVars([
      { name: '(dynamic)', files: ['a.js', 'b.js'], count: 2 },
      { name: 'PORT', files: ['a.js'], count: 1 },
      { name: 'DNA_KEY', files: ['a.js', 'b.js', 'c.js'], count: 3 },
    ]);
    expect(ordered.map((e) => e.name)).toEqual(['DNA_KEY', 'PORT', '(dynamic)']);
  });
});

describe('looksGuard', () => {
  it('flags auth/security middleware, not ordinary middleware', () => {
    expect(looksGuard('requireAuth')).toBe(true);
    expect(looksGuard('securityHeaders')).toBe(true);
    expect(looksGuard('cors')).toBe(true);
    expect(looksGuard('express.json')).toBe(false);
    expect(looksGuard('rateLimit')).toBe(false);
  });
});

describe('splitDuplicates', () => {
  it('separates confirmed exact copies from same-name candidates', () => {
    const { confirmed, candidates } = splitDuplicates([
      { name: 'authHeaders', confirmed: true, exactCopies: 3 },
      { name: 'main', confirmed: false, exactCopies: 0 },
    ]);
    expect(confirmed.map((d) => d.name)).toEqual(['authHeaders']);
    expect(candidates.map((d) => d.name)).toEqual(['main']);
  });
});

describe('looksSecret', () => {
  it('flags secret-shaped names, not ordinary config', () => {
    expect(looksSecret('DNA_ENCRYPTION_KEY')).toBe(true);
    expect(looksSecret('X_API_SECRET')).toBe(true);
    expect(looksSecret('ACCESS_TOKEN')).toBe(true);
    expect(looksSecret('NODE_ENV')).toBe(false);
    expect(looksSecret('FRONTEND_PORT')).toBe(false);
  });
});

describe('defnKindCounts', () => {
  it('counts kinds and treats an untagged def as a function', () => {
    expect(defnKindCounts([{ kind: 'class' }, { kind: 'method' }, { kind: 'method' }, {}]))
      .toEqual({ function: 1, method: 2, class: 1 });
  });
});

describe('baseName', () => {
  it('returns the last path segment', () => {
    expect(baseName('backend/services/portal-stream.js')).toBe('portal-stream.js');
    expect(baseName('server.js')).toBe('server.js');
  });
});

describe('systemFocus', () => {
  const edges = [
    { from: 'backend/routes', to: 'backend/services', count: 208 },
    { from: 'backend/services', to: 'core', count: 30 },
    { from: 'cli', to: 'backend/services', count: 5 },
  ];
  it('splits a system into who depends on it and what it depends on, heaviest first', () => {
    const f = systemFocus(edges, 'backend/services');
    expect(f.dependents.map((d) => d.id)).toEqual(['backend/routes', 'cli']); // 208 before 5
    expect(f.dependencies.map((d) => d.id)).toEqual(['core']);
  });
  it('is empty for a system with no edges', () => {
    expect(systemFocus(edges, 'nowhere')).toEqual({ dependents: [], dependencies: [] });
  });
});

describe('wireLayout', () => {
  it('positions three columns and emits a bezier path per edge', () => {
    const out = wireLayout(
      [{ id: 'a', label: 'a' }],
      [{ id: 'm', label: 'm' }],
      [{ id: 'b', label: 'b' }],
      [{ side: 'L', a: 'a', b: 'm' }, { side: 'M', a: 'm', b: 'b', sev: true }],
    );
    expect(out.width).toBeGreaterThan(0);
    expect(out.nodes).toHaveLength(3);
    expect(out.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
    expect(out.paths).toHaveLength(2);
    expect(out.paths[0].d.startsWith('M')).toBe(true); // valid SVG path command
    expect(out.paths[1].sev).toBe(true);
  });
});
