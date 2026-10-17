// The sensitive-grant law — pure shapes, never-requestable walls, the
// containment match, and the rogue-detector's grant predicate (all pure).
import { describe, expect, it } from 'vitest';
import {
  addSensitiveGrant,
  NEVER_REQUESTABLE,
  requestablePattern,
  sensitiveGrantCovers,
  SENSITIVE_TIERS,
} from '../../backend/services/sensitive-grants.js';
import { checkToolArgs } from '../../backend/services/rogue-detector.js';

describe('requestablePattern — what may be asked for at all', () => {
  it('lets the secret-shaped files be requested', () => {
    for (const token of ['.env', '.pem', '.key', '.ssh/', 'vault/', 'node_modules/', 'config/']) {
      expect(requestablePattern(token), token).toBe(true);
    }
  });

  it('bars every never-requestable shape, in every spelling', () => {
    for (const token of ['data/dna/', 'data/dna-cache/', 'data/memory-store/', '.git/', 'keys/', 'keys/keypair', 'owner.json', 'config/tool-policy.json']) {
      expect(requestablePattern(token), token).toBe(false);
      expect(NEVER_REQUESTABLE.map((n) => n.toLowerCase())).toContain(token.toLowerCase());
    }
  });

  it('never lets a never-requestable prefix slip through', () => {
    expect(requestablePattern('data/dna-cache/')).toBe(false);
    expect(requestablePattern('.git/')).toBe(false);
    expect(requestablePattern('')).toBe(false);
    expect(requestablePattern(null)).toBe(false);
  });
});

describe('sensitiveGrantCovers — the containment match', () => {
  const grants = {
    read: ['/ground/repo/.env', '/ground/secrets'],
    edit: ['/ground/repo/.env'],
  };

  it('an exact path grant covers exactly that path', () => {
    expect(sensitiveGrantCovers(grants, 'read', '/ground/repo/.env')).toBe(true);
    expect(sensitiveGrantCovers(grants, 'read', '/ground/repo/.env.local')).toBe(false);
  });

  it('a directory grant covers beneath it — never a sibling with a shared prefix', () => {
    expect(sensitiveGrantCovers(grants, 'read', '/ground/secrets/api.key')).toBe(true);
    expect(sensitiveGrantCovers(grants, 'read', '/ground/secrets-other/api.key')).toBe(false);
  });

  it('the tier law is real: a read grant never confers edit', () => {
    expect(sensitiveGrantCovers(grants, 'edit', '/ground/secrets/api.key')).toBe(false);
    expect(sensitiveGrantCovers(grants, 'edit', '/ground/repo/.env')).toBe(true);
    expect(sensitiveGrantCovers(grants, 'edit', '/ground/repo/.env.local')).toBe(false);
  });

  it('fails closed on crooked input', () => {
    expect(sensitiveGrantCovers(null, 'read', '/ground/repo/.env')).toBe(false);
    expect(sensitiveGrantCovers(grants, 'admin', '/ground/repo/.env')).toBe(false);
    expect(sensitiveGrantCovers(grants, 'read', '')).toBe(false);
    expect(SENSITIVE_TIERS).toEqual(['read', 'edit']);
  });
});

describe('addSensitiveGrant — the persisted shape', () => {
  it('grows a fresh layer and appends unique', () => {
    const once = addSensitiveGrant(null, 'read', '/ground/repo/.env');
    expect(once).toEqual({ sensitiveGrants: { read: ['/ground/repo/.env'] } });
    const twice = addSensitiveGrant(once, 'read', '/ground/repo/.env');
    expect(twice.sensitiveGrants.read).toEqual(['/ground/repo/.env']);
    const edited = addSensitiveGrant(once, 'edit', '/ground/repo/.env');
    expect(edited.sensitiveGrants).toEqual({ read: ['/ground/repo/.env'], edit: ['/ground/repo/.env'] });
  });

  it('refuses crooked tiers and relative paths', () => {
    expect(() => addSensitiveGrant(null, 'admin', '/x')).toThrow(/tier/);
    expect(() => addSensitiveGrant(null, 'read', 'relative/.env')).toThrow(/absolute/);
  });
});

describe('checkToolArgs — the grant predicate at the arg screen', () => {
  const envArgs = { path: '/ground/repo/.env' };

  it('an ungranted sensitive arg is refused with the recourse named', () => {
    const verdict = checkToolArgs('filesystem', 'read_file', envArgs);
    expect(verdict.safe).toBe(false);
    expect(verdict.reason).toContain('request_file_access');
  });

  it('a granted sensitive arg passes the screen', () => {
    const verdict = checkToolArgs('filesystem', 'read_file', envArgs, { grantCovers: () => true });
    expect(verdict.safe).toBe(true);
  });

  it('wallet/security config stays a wall even when the predicate says granted', () => {
    const verdict = checkToolArgs('filesystem', 'read_file', { path: '/lane/config/tool-policy.json' }, { grantCovers: () => true });
    expect(verdict.safe).toBe(false);
    expect(verdict.reason).toContain('wallet/security config');
  });
});
