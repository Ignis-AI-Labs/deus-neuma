/**
 * THE NETWORK WATCH (network/network-watch.js) — Design note, 2026-11-22: […] Pure: the text is the
 * kernel's socket table as `ss -H -t -u -n -p -a` prints it on a real machine.
 */
import { describe, test, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseSockets, placeOf, networkOf } from '../../backend/services/network/network-watch.js';

const SS = [
  'tcp   LISTEN 0      511                  127.0.0.1:3375               0.0.0.0:*     users:(("node",pid=41,fd=22))',
  'tcp   LISTEN 0      4096                   0.0.0.0:8089               0.0.0.0:*     users:(("llama-server",pid=77,fd=5))',
  'tcp   LISTEN 0      128                       [::]:22                    [::]:*',
  'udp   UNCONN 0      0      [fe80::76ce:fba3]%wlan0:546                      *:*',
  'tcp   ESTAB  0      0             192.168.1.53:51000         104.18.2.3:443   users:(("node",pid=41,fd=30))',
  'tcp   ESTAB  0      0             192.168.1.53:51001         104.18.2.3:443   users:(("node",pid=41,fd=31))',
  'udp   ESTAB  0      0      [2001:fb1:5b::7f81]:43798 [2404:6800:4003:c0f::65]:443 users:(("brave",pid=900,fd=35))',
  'tcp   ESTAB  0      0             192.168.1.53:51002        192.168.1.1:53    users:(("brave",pid=900,fd=36))',
  'tcp   ESTAB  0      0                127.0.0.1:3375          127.0.0.1:60210  users:(("node",pid=41,fd=40))',
  'tcp   ESTAB  0      0             192.168.1.53:8089        192.168.1.77:60999 users:(("llama-server",pid=77,fd=9))',
  'tcp   ESTAB  0      0            100.101.1.2:51003         100.90.4.4:443    users:(("tailscaled",pid=5,fd=3))',
  'tcp   TIME-WAIT 0   0             192.168.1.53:51009         9.9.9.9:443',
  'not a socket line',
].join('\n');

describe('the network watch reads the machine\'s own socket table', () => {
  test('every socket is read with both its ends and its program; a line that is not one is left', () => {
    const s = parseSockets(SS);
    expect(s).toHaveLength(12);
    expect(s[0]).toEqual({ proto: 'tcp', state: 'LISTEN', local: { address: '127.0.0.1', port: 3375 }, peer: { address: '0.0.0.0', port: null }, process: 'node', pid: 41 });
    expect(s[3].local).toEqual({ address: 'fe80::76ce:fba3', port: 546 });
    expect(s[6].peer).toEqual({ address: '2404:6800:4003:c0f::65', port: 443 });
    expect(s[2]).toMatchObject({ process: null, pid: null });
  });

  test('an address is placed by where it is: this machine, the tailnet, your network, the internet', () => {
    expect(['127.0.0.1', '::1', '100.90.4.4', '192.168.1.1', '10.0.0.5', '172.20.1.1', 'fe80::1', '224.0.0.251', '104.18.2.3', '2404:6800::65', '0.0.0.0', '*', '::ffff:192.168.1.9'].map(placeOf))
      .toEqual(['machine', 'machine', 'tailnet', 'lan', 'lan', 'lan', 'lan', 'lan', 'internet', 'internet', 'any', 'any', 'lan']);
  });

  test('what goes out, what came in and what listens — the platform\'s own told from other programs\', several sockets to one address one line', () => {
    const net = networkOf(parseSockets(SS), { ports: [{ from: 3375, to: 3375, owner: 'the desk' }, { from: 8089, to: 8089, owner: 'house llama-server' }], pids: new Set([41]) });
    // OUT: the internet first, the platform's own before another program's; two sockets to one address are one line.
    expect(net.out.map((r) => [r.place, r.process, r.address, r.port, r.sockets, r.ours])).toEqual([
      ['internet', 'node', '104.18.2.3', 443, 2, true], ['internet', 'brave', '2404:6800:4003:c0f::65', 443, 1, false],
      ['lan', 'brave', '192.168.1.1', 53, 1, false], ['tailnet', 'tailscaled', '100.90.4.4', 443, 1, false],
    ]);
    // IN: its own end is a port something here listens on. From another computer on the network, into the engine's open port.
    expect(net.in.map((r) => [r.place, r.process, r.address, r.port, r.owner, r.ours])).toEqual([['lan', 'llama-server', '192.168.1.77', 8089, 'house llama-server', true], ['machine', 'node', '127.0.0.1', 3375, 'the desk', true]]);
    expect(net.listening.map((l) => [l.port, l.reach, l.owner, l.ours])).toEqual([[3375, 'machine', 'the desk', true], [8089, 'any', 'house llama-server', true], [22, 'any', null, false], [546, 'lan', null, false]]);
    expect(net.counts).toEqual({ leaving: 2, leavingOurs: 1, addresses: 2, lan: 1, onMachine: 1, inFromOutside: 1, open: 3, listening: 4 });
    // A socket closing down is not a connection.
    expect(net.out.some((r) => r.address === '9.9.9.9')).toBe(false);
  });

  test('on the desk: a line of state first, then each kind of connection folded, the platform\'s own marked', async () => {
    const { Sheet } = await import('../../frontend/app/RelinkShell/sheet/Sheet.jsx');
    const net = networkOf(parseSockets(SS), { ports: [], pids: new Set([41]) });
    const html = renderToStaticMarkup(createElement(Sheet, { label: 'connections leaving for the internet', rows: net.out.filter((r) => r.place === 'internet'), rowKey: (r) => r.address,
      columns: [{ head: 'PROGRAM', cell: (r) => `${r.process} (${r.pid})` }, { head: 'ADDRESS', cell: (r) => r.address }, { head: 'WHOSE', cell: (r) => (r.ours ? 'THE PLATFORM' : 'ANOTHER PROGRAM') }] }));
    expect(html).toMatch(/node \(41\).*104\.18\.2\.3.*THE PLATFORM/);
    expect(html).toMatch(/brave \(900\).*2404:6800:4003:c0f::65.*ANOTHER PROGRAM/);
  });
});
