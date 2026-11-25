/**
 * The pure half of the decoy tripwire: what a decoy holds, how /proc and
 * inotifywait lines are read, who may be frozen, and what a hit says in the
 * ledger. Real inputs, real outputs — nothing stands in for anything.
 */
import { describe, expect, test } from 'vitest';
import { randomBytes } from 'crypto';
import {
  solanaKeypair, ethKeystore, ethKeystoreName, electrumWallet, bitcoinWallet, awsCredentials,
} from '../../backend/services/security/tripwire/decoy-content.js';
import { DECOYS, decoyName } from '../../backend/services/security/tripwire/decoy-catalog.js';
import { parseProcStat, parseBootTimeMs, scriptOf } from '../../backend/services/security/tripwire/reader-finder.js';
import { parseInotifyLine } from '../../backend/services/security/tripwire/decoy-watch.js';
import {
  readerStanding, mayFreeze, incidentFinding, clipboardFinding,
} from '../../backend/services/security/tripwire/tripwire-findings.js';
import { validateThreat } from '../../backend/services/security/threat-ledger.js';

describe('decoy content', () => {
  test('every decoy is the shape its app writes, and random each time', () => {
    const key = JSON.parse(solanaKeypair(randomBytes).toString());
    expect(key).toHaveLength(64);
    expect(key.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)).toBe(true);
    const keystore = JSON.parse(ethKeystore(randomBytes).toString());
    expect(keystore.version).toBe(3);
    expect(keystore.address).toMatch(/^[0-9a-f]{40}$/);
    expect(keystore.crypto.kdf).toBe('scrypt');
    expect(ethKeystoreName(randomBytes, Date.UTC(2026, 0, 2))).toMatch(/^UTC--2026-01-02T00-00-00\.000Z--[0-9a-f]{40}$/);
    const electrum = JSON.parse(electrumWallet(randomBytes).toString());
    expect(electrum.keystore.xprv).toMatch(/^xprv/);
    expect(electrum.keystore.seed.split(' ')).toHaveLength(12);
    expect(bitcoinWallet(randomBytes).readUInt32LE(12)).toBe(0x00053162);
    expect(awsCredentials(randomBytes).toString()).toMatch(/^\[default\]\naws_access_key_id = [A-Z2-7]{20}\naws_secret_access_key = \S{40}\n/);
    expect(solanaKeypair(randomBytes).equals(solanaKeypair(randomBytes))).toBe(false);
  });

  test('the catalog: six decoys, each under its own hidden folder', () => {
    expect(DECOYS.map((d) => d.id)).toEqual(['solana', 'ethereum', 'electrum', 'exodus', 'bitcoin', 'aws']);
    for (const decoy of DECOYS) {
      expect(decoy.marker.startsWith('.')).toBe(true);
      for (const file of decoy.files(randomBytes, Date.now())) {
        expect(file.rel.startsWith(`${decoy.marker}/`)).toBe(true);
        expect(file.data.length).toBeGreaterThan(0);
      }
    }
    expect(decoyName('solana')).toBe('Solana key');
    expect(decoyName('gone')).toBe('gone');
  });
});

describe('reading /proc', () => {
  test('a stat line with spaces and parentheses in the command name', () => {
    const line = '4242 (Web Content (x)) S 4000 4242 4242 0 -1 4194560 100 0 0 0 5 3 0 0 20 0 9 0 987654 1000 200 18446744073709551615 0 0 0 0 0 0 0 0 0 0 0 0 17 3 0 0 0 0 0';
    expect(parseProcStat(line)).toEqual({ comm: 'Web Content (x)', state: 'S', ppid: 4000, startTicks: 987654 });
    expect(parseProcStat('garbage')).toBeNull();
  });

  test('boot time', () => {
    expect(parseBootTimeMs('cpu 1 2 3\nbtime 1763600000\nprocesses 5\n')).toBe(1763600000000);
    expect(parseBootTimeMs('cpu 1 2 3\n')).toBeNull();
  });

  test('a runtime names its script, and never any other argument', () => {
    expect(scriptOf('/usr/bin/node', ['node', '--token=secret', '/tmp/x/steal.js', '/home/a/b'])).toBe('/tmp/x/steal.js');
    expect(scriptOf('/usr/bin/python3.14', ['python3', '-c', 'print(1)'])).toBeNull();
    expect(scriptOf('/usr/bin/cat', ['cat', '/home/a/.aws/credentials'])).toBeNull();
  });
});

describe('inotifywait lines', () => {
  test('open and access are a read; a deleted or moved file is a removal', () => {
    expect(parseInotifyLine('OPEN|/h/.bitcoin/wallet.dat')).toEqual({ kind: 'read', path: '/h/.bitcoin/wallet.dat' });
    expect(parseInotifyLine('ACCESS|/h/a b|c')).toEqual({ kind: 'read', path: '/h/a b|c' });
    expect(parseInotifyLine('DELETE_SELF|/h/x')).toEqual({ kind: 'removed', path: '/h/x' });
    expect(parseInotifyLine('MOVE_SELF|/h/x')).toEqual({ kind: 'removed', path: '/h/x' });
    expect(parseInotifyLine('ATTRIB|/h/x')).toBeNull();
    expect(parseInotifyLine('nonsense')).toBeNull();
  });
});

describe('who may be frozen', () => {
  const ctx = { selfPid: 100, selfAncestors: [50, 1], procAncestors: [] };

  test('standing', () => {
    expect(readerStanding({ pid: 100, comm: 'node', exe: '/usr/bin/node' }, ctx)).toBe('self');
    expect(readerStanding({ pid: 50, comm: 'bash', exe: '/usr/bin/bash' }, ctx)).toBe('protected');
    expect(readerStanding({ pid: 1, comm: 'systemd', exe: '/usr/lib/systemd/systemd' }, ctx)).toBe('protected');
    expect(readerStanding({ pid: 7, comm: 'gnome-shell', exe: '/usr/bin/gnome-shell' }, ctx)).toBe('protected');
    expect(readerStanding({ pid: 8, comm: 'localsearch-3', exe: '/usr/libexec/localsearch-3' }, ctx)).toBe('indexer');
    // An indexer's name on a binary outside the system folders is not an indexer.
    expect(readerStanding({ pid: 9, comm: 'localsearch-3', exe: '/home/a/.cache/localsearch-3' }, ctx)).toBe('outside');
    expect(readerStanding({ pid: 10, comm: 'cat', exe: '/usr/bin/cat' }, { ...ctx, procAncestors: [60, 100, 50] })).toBe('house');
    expect(readerStanding({ pid: 11, comm: 'node', exe: '/usr/bin/node' }, ctx)).toBe('outside');
  });

  test('only a reader from outside or from the house is frozen', () => {
    expect(['self', 'protected', 'indexer', 'house', 'outside'].filter(mayFreeze)).toEqual(['house', 'outside']);
  });
});

describe('what a hit says', () => {
  const at = Date.UTC(2026, 10, 20, 12, 0, 0);
  const hit = (decoyId, kind = 'read') => ({ decoyId, path: `/h/${decoyId}`, kind, at });

  test('a read with the reader caught and frozen', () => {
    const finding = incidentFinding({
      startedAt: at,
      hits: [hit('solana')],
      readers: [{ pid: 77, comm: 'node', exe: '/usr/bin/node', script: '/tmp/pkg/postinstall.js', standing: 'outside', frozen: true }],
    });
    expect(validateThreat(finding)).toBeNull();
    expect(finding.severity).toBe('critical');
    expect(finding.title).toBe('A decoy wallet file was opened: Solana key');
    expect(finding.externalId).toBe('tripwire:decoy:2026-11-20T12:00:00.000Z');
    expect(finding.summary).toContain('`/usr/bin/node running /tmp/pkg/postinstall.js` (pid 77): not started by Neuma, **frozen**');
    expect(finding.remedy).toContain('A program is frozen');
  });

  test('a sweep nobody was caught at lists candidates and says so', () => {
    const finding = incidentFinding({
      startedAt: at,
      hits: [hit('solana'), hit('aws'), hit('bitcoin')],
      candidates: [{ pid: 9, comm: 'curl', exe: '/usr/bin/curl', script: null }],
    });
    expect(finding.title).toBe('3 decoy wallet files were opened in one sweep: Solana key, AWS credentials, Bitcoin wallet');
    expect(finding.summary).toContain('The reader was not caught');
    expect(finding.summary).toContain('candidates, not a verdict');
    expect(finding.summary).toContain('`/usr/bin/curl` (pid 9)');
    expect(finding.severity).toBe('critical');
  });

  test('an indexer alone is low; a removal alone is high', () => {
    const indexer = { pid: 8, comm: 'localsearch-3', exe: '/usr/libexec/localsearch-3', script: null, standing: 'indexer', frozen: false };
    expect(incidentFinding({ startedAt: at, hits: [hit('aws')], readers: [indexer] }).severity).toBe('low');
    const removed = incidentFinding({ startedAt: at, hits: [hit('aws', 'removed')] });
    expect(removed.severity).toBe('high');
    expect(removed.title).toBe('A decoy wallet file was removed: AWS credentials');
    expect(removed.summary).not.toContain('The reader was not caught');
  });
});

describe('a swapped clipboard address', () => {
  const copied = `0x${'ab'.repeat(20)}`;
  const found = `0x${'cd'.repeat(20)}`;

  test('two different addresses are a critical threat', () => {
    const finding = clipboardFinding({ copied, found, at: Date.UTC(2026, 10, 20) });
    expect(validateThreat(finding)).toBeNull();
    expect(finding.severity).toBe('critical');
    expect(finding.summary).toContain(copied);
    expect(finding.summary).toContain(found);
  });

  test('nothing but a different address of the same chain is ever filed', () => {
    expect(clipboardFinding({ copied, found: copied, at: 0 })).toBeNull();
    expect(clipboardFinding({ copied, found: copied.toUpperCase().replace('0X', '0x'), at: 0 })).toBeNull();
    expect(clipboardFinding({ copied, found: 'my password is hunter2 and more words', at: 0 })).toBeNull();
    // A long password or key someone copied next is not an address of that chain.
    expect(clipboardFinding({ copied, found: 'Zx9mQ2vLr8TnB4kWc7YpH3sDf6GjA1eU', at: 0 })).toBeNull();
    expect(clipboardFinding({ copied: 'hello', found, at: 0 })).toBeNull();
    expect(clipboardFinding({ copied, found: undefined, at: 0 })).toBeNull();
  });
});
