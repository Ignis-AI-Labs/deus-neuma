/**
 * The master key stays home — the backend's secrets never ride into a process
 * it starts for the operator, no grant card can open the platform's key file,
 * the folder holding it closes to its owner, and the realm's records are
 * written owner-only. Real temp files, real modules, no mocks.
 */

import fs from 'fs';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { BACKEND_SECRET_KEYS, withoutBackendSecrets } from '../../backend/services/agent-terminal-environment.js';
import { checkPathAccess } from '../../backend/services/sandbox-path-policy.js';
import { requestablePattern } from '../../backend/services/sensitive-grants.js';
import { ensureSecrets } from '../../backend/services/secret-provisioning.js';
import { appendChat, getRealmRoot, setRealmRoot, writeJsonAtomic } from '../../backend/services/user-realm.js';

const posix = process.platform !== 'win32';
const modeOf = (p) => fs.statSync(p).mode & 0o777;

describe('the operator environment', () => {
  test('drops every backend secret and keeps the session plumbing', () => {
    const env = { PATH: '/usr/bin', HOME: '/home/op', SSH_AUTH_SOCK: '/run/agent', OLLAMA_MODELS: '/m' };
    for (const key of BACKEND_SECRET_KEYS) env[key] = `canary-${key}`;
    const out = withoutBackendSecrets(env);
    for (const key of BACKEND_SECRET_KEYS) expect(out).not.toHaveProperty(key);
    expect(out).toEqual({ PATH: '/usr/bin', HOME: '/home/op', SSH_AUTH_SOCK: '/run/agent', OLLAMA_MODELS: '/m' });
    expect(env.DNA_ENCRYPTION_KEY).toBe('canary-DNA_ENCRYPTION_KEY');
  });
});

describe('the platform key file', () => {
  let file;
  beforeEach(async () => {
    const dir = await createTempDir(`keyhome-${Math.random().toString(36).slice(2)}`);
    file = path.join(dir, 'secrets.json');
    process.env.NEUMA_SECRETS_FILE = file;
  });
  afterEach(() => { delete process.env.NEUMA_SECRETS_FILE; });

  test('is refused under a pattern no card can lift, even inside an allowed root', () => {
    const check = checkPathAccess(file, [path.dirname(file)]);
    expect(check.allowed).toBe(false);
    expect(check.deniedPattern).toBe('platform keys');
    expect(requestablePattern(check.deniedPattern)).toBe(false);
  });

  test('a project\'s own secrets.json is still the operator\'s to grant', () => {
    const projectSecrets = path.join(path.dirname(file), 'project', 'secrets.json');
    const check = checkPathAccess(projectSecrets, [path.dirname(file)]);
    expect(check.deniedPattern).toBe('secret data file');
    expect(requestablePattern(check.deniedPattern)).toBe(true);
  });

  (posix ? test : test.skip)('provisioning closes an open folder around it to its owner', () => {
    fs.chmodSync(path.dirname(file), 0o755);
    const r = ensureSecrets({ env: {} });
    expect(r.folder).toBe('closed');
    expect(modeOf(path.dirname(file))).toBe(0o700);
    expect(modeOf(file)).toBe(0o600);
    expect(ensureSecrets({ env: {} }).folder).toBe('already');
  });
});

describe('the realm', () => {
  let before;
  beforeEach(async () => {
    before = getRealmRoot();
    setRealmRoot(await createTempDir(`realm-${Math.random().toString(36).slice(2)}`));
  });
  afterEach(() => setRealmRoot(before));

  (posix ? test : test.skip)('writes a conversation copy and a record owner-only', async () => {
    const wallet = `0x${'ab'.repeat(20)}`;
    await appendChat(wallet, 'test-being', 'Test', [{ role: 'user', content: 'hello' }]);
    const chats = path.join(getRealmRoot(), wallet, 'chats');
    expect(modeOf(chats)).toBe(0o700);
    expect(modeOf(path.join(chats, 'test-being.jsonl'))).toBe(0o600);
    const record = path.join(getRealmRoot(), wallet, 'tasks', 'list.json');
    await writeJsonAtomic(record, { tasks: [] });
    expect(modeOf(path.dirname(record))).toBe(0o700);
    expect(modeOf(record)).toBe(0o600);
  });
});
