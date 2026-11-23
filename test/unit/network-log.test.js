/**
 * THE NETWORK LOG (network/network-log.js, network-recorder.js) — Design note, 2026-11-22: […] The readings are the watch's own shape; the log is written to a real folder.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import { standing, changes, historyOf, auditOf, keepEvents, readEvents, readNetworkHistory, prune, logDir, RETENTION_DAYS } from '../../backend/services/network/network-log.js';
import { startNetworkRecorder } from '../../backend/services/network/network-recorder.js';

const T0 = Date.parse('2026-11-22T10:00:00Z');
const at = (s) => T0 + s * 1000;
const out = (process_, address, o = {}) => ({ proto: 'tcp', process: process_, pid: 41, address, port: 443, place: 'internet', ours: false, ...o });
const net = (o = {}) => ({ measured: true, out: [], in: [], listening: [], ...o });
const open = (port, reach, process_ = 'sshd') => ({ proto: 'tcp', address: reach === 'machine' ? '127.0.0.1' : '0.0.0.0', port, reach, process: process_, pid: 9, owner: null, ours: false });

describe('what changed between two readings is kept, and what stands out is named', () => {
  test('only what reaches beyond this machine is kept; a connection is written once when seen and once when gone', () => {
    const first = standing(net({ out: [out('node', '104.18.2.3', { ours: true }), out('brave', '127.0.0.1', { place: 'machine' })], listening: [open(22, 'any'), open(3375, 'machine', 'node')] }));
    expect([...first.keys()]).toEqual(['out|tcp|node|104.18.2.3|443', 'open|tcp|sshd|0.0.0.0|22']);
    const one = changes(new Map(), first, at(0), { baseline: true });
    expect(one.events.map((e) => [e.type, e.dir, e.address, e.baseline])).toEqual([['seen', 'out', '104.18.2.3', true], ['seen', 'open', '0.0.0.0', true]]);
    const two = changes(one.next, first, at(5));
    expect(two.events).toEqual([]);
    const three = changes(two.next, standing(net({ listening: [open(22, 'any')], in: [{ proto: 'tcp', process: 'sshd', pid: 9, address: '203.0.113.9', port: 22, place: 'internet', ours: false }] })), at(10));
    expect(three.events.map((e) => [e.type, e.dir, e.seconds ?? e.address])).toEqual([['seen', 'in', '203.0.113.9'], ['gone', 'out', 10]]);
  });

  test('the audit: what came in, a port that opened, a program not shown, something there and gone, the platform reaching a new place', () => {
    const seen = (dir, o, s, extra = {}) => ({ type: 'seen', key: `${dir}|tcp|${o.process ?? '?'}|${o.address}|${o.port}`, dir, ...o, at: new Date(at(s)).toISOString(), ...extra });
    const gone = (e, s) => ({ type: 'gone', key: e.key, dir: e.dir, at: new Date(at(s)).toISOString(), seconds: s - (Date.parse(e.at) - T0) / 1000 });
    const ssh = seen('open', { proto: 'tcp', process: 'sshd', pid: 9, address: '0.0.0.0', port: 22, place: 'any', ours: false }, 0, { baseline: true });
    const intruder = seen('in', { proto: 'tcp', process: 'sshd', pid: 9, address: '203.0.113.9', port: 22, place: 'internet', ours: false }, 10);
    const again = { ...seen('in', { proto: 'tcp', process: 'sshd', pid: 9, address: '203.0.113.9', port: 22, place: 'internet', ours: false }, 600) };
    const newPort = seen('open', { proto: 'tcp', process: 'nc', pid: 77, address: '0.0.0.0', port: 4444, place: 'any', ours: false }, 20);
    const hidden = seen('out', { proto: 'tcp', process: null, pid: null, address: '198.51.100.7', port: 8443, place: 'internet', ours: false }, 30);
    const lan = seen('in', { proto: 'tcp', process: 'llama-server', pid: 5, address: '192.168.1.77', port: 8089, place: 'lan', ours: true }, 40);
    const ours = seen('out', { proto: 'tcp', process: 'node', pid: 41, address: '104.18.2.3', port: 443, place: 'internet', ours: true }, 50);
    const browser = seen('out', { proto: 'tcp', process: 'brave', pid: 900, address: '142.250.1.1', port: 443, place: 'internet', ours: false }, 60);
    const history = historyOf([{ type: 'began', at: new Date(at(0)).toISOString() }, ssh, intruder, gone(intruder, 15), newPort, hidden, lan, ours, browser, again]);
    expect(history[0]).toMatchObject({ address: '203.0.113.9', there: true, firstSeen: '2026-11-22T10:10:00.000Z' });
    expect(history.find((r) => r.address === '203.0.113.9' && !r.there)).toMatchObject({ seconds: 5, lastSeen: '2026-11-22T10:00:15.000Z' });
    const audit = auditOf(history);
    expect(audit.map((a) => [a.weight, a.kind, a.what, a.times])).toEqual([
      ['high', 'in', '203.0.113.9 connected IN to port 22 (sshd) from the internet', 2],
      ['high', 'open', 'port 4444 began listening beyond this machine (nc), bound to 0.0.0.0', 1],
      ['high', 'brief', '203.0.113.9 was connected IN to port 22 for 5 s and gone', 1],
      ['medium', 'in', '192.168.1.77 connected IN to port 8089 (llama-server) from your network', 1],
      ['medium', 'noName', 'a program the system does not show connected OUT to 198.51.100.7:8443', 1],
      ['low', 'newPlace', "the platform's own node reached 104.18.2.3:443 for the first time", 1],
    ]);
    // The port that was open when the watch began is not "opened"; another program's ordinary traffic is not flagged.
    expect(audit.some((a) => /port 22 began/.test(a.what) || /142\.250/.test(a.what))).toBe(false);
    expect(audit[0]).toMatchObject({ at: '2026-11-22T10:00:10.000Z', lastAt: '2026-11-22T10:10:00.000Z' });
    // The desk stopping, or starting again, closes what stood at the last moment it was known to stand.
    const restarted = historyOf([ssh, { type: 'began', at: new Date(at(900)).toISOString() }]);
    expect(restarted[0]).toMatchObject({ there: false, lastSeen: ssh.at, seconds: 0 });
  });
});

describe('the recorder keeps it on this machine\'s own disk', () => {
  const prior = process.env.NEUMA_DATA_ROOT; let dir;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'network-log-')); process.env.NEUMA_DATA_ROOT = dir; });
  afterAll(() => { if (prior === undefined) delete process.env.NEUMA_DATA_ROOT; else process.env.NEUMA_DATA_ROOT = prior; fs.rmSync(dir, { recursive: true, force: true }); });

  test('readings are diffed and written; the history and audit read back; the file is private; old days are dropped', async () => {
    const readings = [net({ listening: [open(22, 'any')] }), net({ listening: [open(22, 'any')], in: [{ proto: 'tcp', process: 'sshd', pid: 9, address: '203.0.113.9', port: 22, place: 'internet', ours: false }] }), net({ listening: [open(22, 'any')] }), { measured: false, why: 'unreadable' }];
    let clock = T0; let i = 0;
    const stop = startNetworkRecorder({ intervalMs: 15, now: () => clock, read: async () => { const r = readings[Math.min(i, readings.length - 1)]; i += 1; clock += 5000; return r; } });
    for (let w = 0; w < 100 && i < 5; w += 1) await new Promise((resolve) => { setTimeout(resolve, 15); });
    stop();
    await new Promise((resolve) => { setTimeout(resolve, 60); });
    const events = await readEvents({ now: clock });
    expect(events.map((e) => e.type)).toEqual(['began', 'seen', 'seen', 'gone', 'stopped']);
    expect(logDir().startsWith(dir)).toBe(true);
    const file = path.join(logDir(), 'network-2026-11-22.jsonl');
    expect((fs.statSync(file).mode & 0o777).toString(8)).toBe('600');
    const read = await readNetworkHistory({ now: clock });
    expect(read).toMatchObject({ since: '2026-11-22T10:00:00.000Z', kept: 2, retentionDays: RETENTION_DAYS });
    expect(read.audit.map((a) => a.what)).toEqual(['203.0.113.9 connected IN to port 22 (sshd) from the internet', '203.0.113.9 was connected IN to port 22 for 5 s and gone']);
    // A day past retention goes; today's stays.
    await keepEvents([{ type: 'began', at: '2026-09-01T00:00:00.000Z' }], Date.parse('2026-09-01T00:00:00Z'));
    expect(await prune(clock)).toBe(1);
    expect(fs.readdirSync(logDir())).toEqual(['network-2026-11-22.jsonl']);
  });
});
