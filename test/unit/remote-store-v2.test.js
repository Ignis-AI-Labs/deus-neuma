// remote-store v2: the roads shape, the v1 migration, and the device-row
// law — one credential kind per row, either a cookie hash or native
// spki+cert, never both, never neither. Real tmp file, real normalize.
import fs from 'fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createRemoteStore, normalizeRemoteState, EMPTY_REMOTE_STATE,
} from '../../backend/services/remote/remote-store.js';

const NATIVE_ROW = Object.freeze({
  id: 'native1', spki: 'aa'.repeat(32), cert: '-----BEGIN CERTIFICATE-----\\nX\\n-----END CERTIFICATE-----\\n',
  label: 'Android · via LAN', address: '0xabc', createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(),
});
const COOKIE_ROW = Object.freeze({
  id: 'cookie1', hash: 'bb'.repeat(32),
  label: 'iPhone · Safari', address: '0xabc', createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(),
});

afterAll(async () => {
  // no shared state beyond tmp dirs created per store below
});

describe('normalizeRemoteState', () => {
  it('v1 state migrates: the tailnet road carries the old origin', () => {
    const state = normalizeRemoteState({ version: 1, enabled: true, origin: 'Desk.example.ts.net', devices: [COOKIE_ROW] });
    expect(state.version).toBe(2);
    expect(state.roads.tailnet).toBe('desk.example.ts.net');
    expect(state.origin).toBe('desk.example.ts.net');
    expect(state.enabled).toBe(true);
    expect(state.devices).toHaveLength(1);
  });

  it('v1 disabled reads as every road off', () => {
    const state = normalizeRemoteState({ version: 1, enabled: false, origin: 'x.ts.net', devices: [] });
    expect(state.roads).toEqual({ tailnet: null, lan: null, relay: null });
    expect(state.enabled).toBe(false);
    expect(state.origin).toBe(null);
  });

  it('enabled is derived: any road on', () => {
    const lan = normalizeRemoteState({ roads: { tailnet: null, lan: { port: 27777 }, relay: null } });
    const relay = normalizeRemoteState({ roads: { tailnet: null, lan: null, relay: { url: 'wss://relay.example/v1' } } });
    expect(lan.enabled).toBe(true);
    expect(relay.enabled).toBe(true);
    expect(lan.roads.lan).toEqual({ port: 27777 });
  });

  it('malformed roads read as off — the safe direction', () => {
    expect(normalizeRemoteState({ roads: { lan: { port: 99999 } } }).roads.lan).toBe(null);
    expect(normalizeRemoteState({ roads: { relay: { url: 'http://insecure' } } }).roads.relay).toBe(null);
    expect(normalizeRemoteState(null)).toEqual(EMPTY_REMOTE_STATE);
  });

  it('device rows: cookie XOR native — never both, never neither', () => {
    const both = { ...COOKIE_ROW, spki: 'cc'.repeat(32), cert: NATIVE_ROW.cert };
    const neither = { id: 'x', label: 'l', address: 'a', createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() };
    const state = normalizeRemoteState({ roads: { lan: { port: 1 } }, devices: [COOKIE_ROW, NATIVE_ROW, both, neither] });
    expect(state.devices.map((d) => d.id)).toEqual(['cookie1', 'native1']);
  });
});

describe('createRemoteStore on a real file', () => {
  it('saves and reloads the v2 shape', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-store-v2-'));
    try {
      const file = path.join(dir, 'remote.json');
      const store = createRemoteStore({ path: file });
      await store.save({ roads: { tailnet: null, lan: { port: 28001 }, relay: null }, devices: [NATIVE_ROW] });
      const reloaded = createRemoteStore({ path: file });
      const state = await reloaded.load();
      expect(state.roads.lan).toEqual({ port: 28001 });
      expect(state.enabled).toBe(true);
      expect(state.devices[0].spki).toBe(NATIVE_ROW.spki);
      expect(state.devices[0].cert).toContain('BEGIN CERTIFICATE');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
