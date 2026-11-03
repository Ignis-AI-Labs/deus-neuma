// The owner claim's two clients beside the desk app's main (electron/owner-claim.cjs,
// proven in test/integration/owner-claim.test.js): the desk's sign-in header and
// the CLI's reader. Real functions, a real file on a temp data root; nothing replaced.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { ownerClaimHeaders, deskOwnerClaim } from '../../frontend/services/owner-claim.js';
import { localOwnerClaim } from '../../cli/lib/auth.js';

const CLAIM = 'c0'.repeat(32);
let dir;
afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); dir = null; });

const writeClaim = (text) => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-owner-claim-'));
  const file = path.join(dir, 'settings', 'owner-claim', 'claim.key');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, text, { mode: 0o600 });
  return dir;
};

describe('the desk sign-in carries the claim only when it has one', () => {
  it('a well-formed claim rides one header; anything else adds none', () => {
    expect(ownerClaimHeaders(CLAIM)).toEqual({ 'X-Neuma-Owner-Claim': CLAIM });
    for (const bad of [null, undefined, '', 'x'.repeat(64), CLAIM.slice(1), `${CLAIM}\n`, 42]) {
      expect(ownerClaimHeaders(bad)).toEqual({});
    }
  });

  it('outside the desk app there is no bridge and no claim', async () => {
    expect(await deskOwnerClaim(undefined)).toBeNull();
  });
});

describe('the CLI reads the claim from its own data root, for a loopback backend only', () => {
  it('reads the claim a backend wrote under NEUMA_DATA_ROOT', () => {
    const root = writeClaim(`${CLAIM}\n`);
    expect(localOwnerClaim('http://127.0.0.1:47317', { NEUMA_DATA_ROOT: root })).toBe(CLAIM);
    expect(localOwnerClaim('http://localhost:47317', { NEUMA_DATA_ROOT: root })).toBe(CLAIM);
  });

  it('never sends it to a backend that is not on this computer', () => {
    const root = writeClaim(CLAIM);
    expect(localOwnerClaim('http://192.168.1.20:47317', { NEUMA_DATA_ROOT: root })).toBeNull();
    expect(localOwnerClaim('https://desk.example.ts.net', { NEUMA_DATA_ROOT: root })).toBeNull();
    expect(localOwnerClaim('not a url', { NEUMA_DATA_ROOT: root })).toBeNull();
  });
});
