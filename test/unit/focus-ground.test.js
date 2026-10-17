/**
 * THE FOCUS GROUND — the folder open in the Explorer is shared reach.
 *
 * Proves the two axes stay separate: focus decides WHERE a participant may act,
 * mode decides WHETHER an act asks. Neither may leak into the other.
 */
import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { focusGroundOf, focusGroundRoots } from '../../backend/services/focus-ground.js';
import {
  checkPathAccess, deniedPatternsFor, findUngrantedReadPaths, findUngrantedWritePaths,
} from '../../backend/services/tool-sandbox.js';
import { applyToolMode, checkToolAccess, resolvePolicy, GLOBAL_DEFAULTS } from '../../backend/services/tool-policy.js';

const INSTALL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('focusGroundOf / focusGroundRoots', () => {
  it('reads the validated focus path off the connection', () => {
    expect(focusGroundOf({ toolWorkspace: '/repos/thing' })).toBe('/repos/thing');
    expect(focusGroundRoots({ toolWorkspace: '/repos/thing' })).toEqual(['/repos/thing']);
  });

  it('an unfocused desk grants nothing', () => {
    for (const connection of [{}, { toolWorkspace: null }, { toolWorkspace: '' }, undefined]) {
      expect(focusGroundOf(connection)).toBeNull();
      expect(focusGroundRoots(connection)).toEqual([]);
    }
  });

  it('refuses a non-string focus rather than coercing it into a root', () => {
    // resolveFocusPath already returns string|null, but a root array is a
    // security surface — a number or object must never become a path.
    for (const bad of [42, {}, [], true]) {
      expect(focusGroundRoots({ toolWorkspace: bad })).toEqual([]);
    }
  });
});

describe('denied paths — install-anchored vs everywhere', () => {
  it('protects the Neuma installation exactly as before', () => {
    const patterns = deniedPatternsFor(path.join(INSTALL_ROOT, 'config', 'tool-policy.json'));
    expect(patterns).toContain('config/');
    expect(checkPathAccess(path.join(INSTALL_ROOT, 'config/tool-policy.json'), []).allowed).toBe(false);
  });

  it("keeps other beings' sovereign state denied wherever the house stands", () => {
    // NOT install-anchored on purpose: setWorkspacesRoot can move the house
    // anywhere, and a relocated house must be exactly as private. Anchoring
    // these to the checkout would have silently opened every temp/relocated
    // root — the integration suite's own house lives outside the install.
    for (const root of [INSTALL_ROOT, '/tmp/some-house', '/mnt/elsewhere/house']) {
      expect(checkPathAccess(path.join(root, 'data/dna/someone.json'), []).allowed, root).toBe(false);
      expect(checkPathAccess(path.join(root, 'data/dna-cache/x.md'), []).allowed, root).toBe(false);
      expect(checkPathAccess(path.join(root, 'data/memory-store/x.db'), []).allowed, root).toBe(false);
    }
  });

  it("lets a focused repository's own config/ be ordinary source", () => {
    // The regression this fixes: 'config/' matched as a substring ANYWHERE, so
    // focusing any normal repo left a swathe of its source unreachable.
    const patterns = deniedPatternsFor('/repos/someone-elses/config/app.json');
    expect(patterns).not.toContain('config/');
    expect(checkPathAccess('/repos/someone-elses/config/app.json', ['/repos/someone-elses']).allowed).toBe(true);
  });

  it('keeps secret-shaped paths denied inside the focus ground', () => {
    // Focus is reach, never a key ring. These fail closed in the ground too.
    const ground = ['/repos/mine'];
    for (const p of [
      '/repos/mine/.env',
      '/repos/mine/.git/config',
      '/repos/mine/keys/keypair.json',
      '/repos/mine/.ssh/id_rsa',
      '/repos/mine/node_modules/pkg/index.js',
      '/repos/mine/secrets/server.pem',
    ]) {
      expect(checkPathAccess(p, ground).allowed, p).toBe(false);
    }
  });

  it('never offers a witness card for a hard-denied path inside the ground', () => {
    // A hard denial must fail as it always did, never become a prompt.
    expect(checkPathAccess('/repos/mine/.env', ['/repos/mine']).grantable).toBeUndefined();
  });
});

describe('focus ground as reach', () => {
  const ground = ['/repos/focused'];

  it('raises no read gap for a path inside the ground', () => {
    expect(findUngrantedReadPaths({ path: '/repos/focused/src/app.js' }, ground)).toEqual([]);
  });

  it('raises no write gap for a path inside the ground', () => {
    expect(findUngrantedWritePaths({ path: '/repos/focused/src/app.js' }, ground)).toEqual([]);
  });

  it('still raises a gap outside the ground — the ordinary rules hold there', () => {
    expect(findUngrantedReadPaths({ path: '/elsewhere/file.js' }, ground)).toEqual(['/elsewhere/file.js']);
    expect(findUngrantedWritePaths({ path: '/elsewhere/file.js' }, ground)).toEqual(['/elsewhere/file.js']);
  });

  it('does not let a sibling directory ride the ground name', () => {
    // /repos/focused must never match /repos/focused-other.
    expect(findUngrantedReadPaths({ path: '/repos/focused-other/x.js' }, ground))
      .toEqual(['/repos/focused-other/x.js']);
  });
});

describe('the two axes never mix', () => {
  const policy = resolvePolicy(GLOBAL_DEFAULTS);
  const accessOf = (tool, mode) => applyToolMode(checkToolAccess(policy, 'filesystem', tool), mode, tool);

  it('focus does not retire the delete card — reach is not permission to act', () => {
    // Founder's pick: delete_file is irreversible, so it keeps asking on `ask`
    // however plainly the folder is open. Focus retires the PATH question only.
    expect(accessOf('delete_file', 'ask')).toBe('approval_required');
  });

  it('observe mode still holds every acting tool, ground or no ground', () => {
    expect(accessOf('write_file', 'observe')).toBe('denied');
    expect(accessOf('delete_file', 'observe')).toBe('denied');
    expect(applyToolMode(checkToolAccess(policy, 'fs', 'read'), 'observe', 'read')).toBe('allowed');
  });

  it('a participant on auto acts silently while its housemate on ask still asks', () => {
    // The scenario the per-participant mode exists for.
    expect(accessOf('delete_file', 'auto')).toBe('allowed');
    expect(accessOf('delete_file', 'ask')).toBe('approval_required');
  });
});

describe('reach never outlives consent — rebinding clears path grants', () => {
  it('drops the previous being\'s granted folders when the lane is rebound', async () => {
    // One connection carries different beings over its life (a manifest
    // switch, a resume onto another lane). Before this, a folder granted to
    // one neuma stayed reachable by whoever was bound next.
    const { clearLaneBinding } = await import('../../backend/routes/portal-routes.js');
    const connection = {
      neumaId: 'neuma-a',
      companion: { neumaId: 'neuma-a' },
      _grantedReadRoots: ['/secret/folder'],
      _grantedWriteRoots: ['/secret/writable'],
      _pathGrantsHydrated: true,
    };
    clearLaneBinding(connection);
    expect(connection._grantedReadRoots).toEqual([]);
    expect(connection._grantedWriteRoots).toEqual([]);
    // ...and the arriving being's OWN persisted grants must be free to load.
    expect(connection._pathGrantsHydrated).toBe(false);
  });
});
