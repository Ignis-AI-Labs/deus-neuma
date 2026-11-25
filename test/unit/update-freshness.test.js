import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { MAX_FEED_AGE_MS, acceptFreshFeed, readFloor } = require('../../electron/update-freshness.cjs');
const roots = [];
const floorPath = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-update-floor-'));
  roots.push(root);
  return path.join(root, 'state', 'update-floor.json');
};
const bytes = (text) => Buffer.from(text);
const offer = (version, signedMs) => ({ version, releaseDate: '2020-01-01T00:00:00.000Z', signedAt: new Date(signedMs).toISOString(), minimumVersion: version });

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('signed update freshness and its real filesystem floor', () => {
  it('accepts a current feed, writes a 0600 floor, and allows its exact replay', () => {
    const file = floorPath();
    const nowMs = Date.now();
    const ymlBytes = bytes('version: 1.2.3\n');
    expect(acceptFreshFeed({ floorFile: file, signed: offer('1.2.3', nowMs - 1000), ymlBytes, nowMs })).toEqual({ ok: true });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(readFloor(file)).toMatchObject({ releaseVersion: '1.2.3', signedMs: nowMs - 1000 });
    expect(acceptFreshFeed({ floorFile: file, signed: offer('1.2.3', nowMs - 1000), ymlBytes, nowMs })).toEqual({ ok: true });
  });

  it('advances to a newer version and refuses the older signed timestamp without lowering the floor', () => {
    const file = floorPath();
    const nowMs = Date.now();
    expect(acceptFreshFeed({ floorFile: file, signed: offer('2.0.0', nowMs - 1000), ymlBytes: bytes('new'), nowMs })).toEqual({ ok: true });
    const before = fs.readFileSync(file, 'utf8');
    expect(acceptFreshFeed({ floorFile: file, signed: offer('1.9.0', nowMs - 2000), ymlBytes: bytes('old'), nowMs })).toEqual({
      ok: false,
      reason: 'the signed feed is older than the newest release already seen',
    });
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    expect(readFloor(file).releaseVersion).toBe('2.0.0');
  });

  it('refuses different bytes at the same signed timestamp', () => {
    const file = floorPath();
    const nowMs = Date.now();
    const signed = offer('2.0.0', nowMs - 1000);
    expect(acceptFreshFeed({ floorFile: file, signed, ymlBytes: bytes('first'), nowMs })).toEqual({ ok: true });
    expect(acceptFreshFeed({ floorFile: file, signed, ymlBytes: bytes('different'), nowMs })).toEqual({
      ok: false,
      reason: 'a different signed feed replays the newest signature timestamp',
    });
  });

  it('refuses missing, invalid, future, and expired signature dates without creating a floor', () => {
    const file = floorPath();
    const nowMs = Date.now();
    const cases = [
      [{ version: '1.0.0' }, 'the signed feed has no valid signedAt'],
      [{ version: '1.0.0', signedAt: 'not-a-date' }, 'the signed feed has no valid signedAt'],
      [offer('1.0.0', nowMs + 60 * 60 * 1000), 'the signed feed signedAt is in the future'],
      [offer('1.0.0', nowMs - MAX_FEED_AGE_MS - 1000), 'the signed feed was signed more than 30 days ago'],
    ];
    for (const [signed, reason] of cases) {
      expect(acceptFreshFeed({ floorFile: file, signed, ymlBytes: bytes('feed'), nowMs })).toEqual({ ok: false, reason });
    }
    expect(fs.existsSync(file)).toBe(false);
  });

  it('accepts a newer signed release and enforces minimumVersion against that release', () => {
    const signed = offer('2.0.0', Date.now() - 1000);
    expect(acceptFreshFeed({ signed, ymlBytes: bytes('feed') })).toEqual({ ok: true });
    expect(acceptFreshFeed({ signed: { ...signed, minimumVersion: '2.0.1' }, ymlBytes: bytes('feed') })).toEqual({
      ok: false,
      reason: 'the signed release is below its minimumVersion',
    });
    expect(acceptFreshFeed({ signed: { ...signed, minimumVersion: undefined }, ymlBytes: bytes('feed') })).toEqual({
      ok: false,
      reason: 'the signed feed has no valid minimumVersion',
    });
  });

  it('fails closed on malformed or unsupported floor records and never replaces them', () => {
    for (const contents of ['{not json', JSON.stringify({ version: 99 })]) {
      const file = floorPath();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, contents);
      const verdict = acceptFreshFeed({ floorFile: file, signed: offer('2.0.0', Date.now() - 1000), ymlBytes: bytes('feed') });
      expect(verdict.ok).toBe(false);
      expect(verdict.reason).toMatch(/saved update floor is unreadable/);
      expect(fs.readFileSync(file, 'utf8')).toBe(contents);
    }
  });
});
