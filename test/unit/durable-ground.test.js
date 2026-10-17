/**
 * assertDurableGround — the law that a ground the OS sweeps at reboot never
 * gets written into a realm that survives it.
 *
 * This exists because of a real leak: on 2026-07-26 the operator's live realm
 * was found holding `/tmp/alliance-ground-Dj3vO0/house` — a house ground set by
 * a test, pointing at a directory that no longer existed. The old guard keyed
 * off NEUMA_WORKSPACE_SETTINGS_PATH, which isolates WORKSPACE settings and says
 * nothing about where the realm is, so a test could pin workspaces, write a tmp
 * ground, and still land it in the operator's real realm.
 *
 * The rule now is self-consistency: a tmp ground is legitimate only when the
 * realm recording it is ALSO tmp. Both directions are tested, because a guard
 * that is too strict breaks every isolated test stack and a guard that is too
 * loose is the bug itself.
 *
 * Real module, real filesystem paths, no mocks (RULE 0).
 */
import { describe, expect, it, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import { assertDurableGround, getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';

const LIVE_REALM = path.join(os.homedir(), '.neuma', 'realm');
const TMP_REALM = path.join(os.tmpdir(), 'durable-ground-test-realm');
const TMP_GROUND = path.join(os.tmpdir(), 'some-ground', 'house');
const DURABLE_GROUND = path.join(os.homedir(), 'houses', 'omberly');

const original = getRealmRoot();
afterEach(() => setRealmRoot(original));

describe('assertDurableGround', () => {
  it('REFUSES a tmp ground when the realm is the live one — the actual leak', () => {
    setRealmRoot(LIVE_REALM);
    expect(() => assertDurableGround(TMP_GROUND, 'House workspace'))
      .toThrow(/would not survive a reboot/);
  });

  it('allows a tmp ground when the realm is ALSO tmp — a genuinely isolated stack', () => {
    setRealmRoot(TMP_REALM);
    expect(() => assertDurableGround(TMP_GROUND, 'House workspace')).not.toThrow();
  });

  it('allows a durable ground on the live realm — the normal case', () => {
    setRealmRoot(LIVE_REALM);
    expect(() => assertDurableGround(DURABLE_GROUND, 'House workspace')).not.toThrow();
  });

  it('allows a durable ground on a tmp realm', () => {
    setRealmRoot(TMP_REALM);
    expect(() => assertDurableGround(DURABLE_GROUND, 'The alliances root')).not.toThrow();
  });

  it('no longer depends on NEUMA_WORKSPACE_SETTINGS_PATH — pinning workspaces must not license a live-realm write', () => {
    setRealmRoot(LIVE_REALM);
    const saved = process.env.NEUMA_WORKSPACE_SETTINGS_PATH;
    process.env.NEUMA_WORKSPACE_SETTINGS_PATH = path.join(os.tmpdir(), 'pinned.json');
    try {
      expect(() => assertDurableGround(TMP_GROUND, 'House workspace')).toThrow(/reboot/);
    } finally {
      if (saved === undefined) delete process.env.NEUMA_WORKSPACE_SETTINGS_PATH;
      else process.env.NEUMA_WORKSPACE_SETTINGS_PATH = saved;
    }
  });

  it('names the thing being set, so the message tells the operator what was refused', () => {
    setRealmRoot(LIVE_REALM);
    expect(() => assertDurableGround(TMP_GROUND, 'The alliances root'))
      .toThrow(/^The alliances root/);
  });
});
