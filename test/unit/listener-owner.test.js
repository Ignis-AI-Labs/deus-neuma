// listener-owner — the pure readers of the kernel's listening-socket table and the account file,
// and the rule for who may run a server the app found (PR600 audit P6-59, P6-153). The table text
// is the kernel's own layout, as /proc/net/tcp and /proc/net/tcp6 print it on Linux. Pure: real
// inputs, real outputs, nothing stood in.
import { describe, expect, test } from 'vitest';
import { accountUid, answeredStanding, listenRows, listenerStanding, standingOf } from '../../backend/services/listener-owner.js';
import { lsofListeners, netstatListenerPids, tasklistOwner } from '../../backend/services/listener-owner-hosts.js';

const TCP = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:2CAA 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 7726998 1 0000000000000000 100 0 0 10 0
   1: 0100007F:2CAA 00000000:0000 0A 00000000:00000000 00:00000000 00000000 524288        0 7727001 1 0000000000000000 100 0 0 10 0
   2: 0100007F:2CAA 0100007F:D431 01 00000000:00000000 00:00000000 00000000  1000        0 7727044 1 0000000000000000 20 4 30 10 -1
   3: 00000000:0016 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 2211 1 0000000000000000 100 0 0 10 0
`;
const TCP6 = `  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000000000000000000001000000:2CAA 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000   996        0 9001 1 0000000000000000 100 0 0 10 0
`;
const PASSWD = 'root:x:0:0:root:/root:/bin/bash\nollama:x:996:994:Ollama Service:/usr/share/ollama:/bin/false\nmallory:x:1001:1001::/home/mallory:/bin/bash\n';

describe('the kernel\'s table, read for one port', () => {
  test('only sockets LISTENING on that port, each with its account and inode; a connection on the same port is not one', () => {
    expect(listenRows(TCP, 0x2CAA)).toEqual([{ uid: 1000, inode: 7726998 }, { uid: 524288, inode: 7727001 }]);
    expect(listenRows(TCP, 22)).toEqual([{ uid: 0, inode: 2211 }]);
    expect(listenRows(TCP6, 0x2CAA)).toEqual([{ uid: 996, inode: 9001 }]);
    expect(listenRows(TCP, 8080)).toEqual([]);
    expect(listenRows('', 22)).toEqual([]);
  });

  test('a named account\'s id comes from the account file, or null', () => {
    expect(accountUid(PASSWD, 'ollama')).toBe(996);
    expect(accountUid(PASSWD, 'nobody-here')).toBeNull();
    expect(accountUid('ollama:x:not-a-number:1::/:/bin/false', 'ollama')).toBeNull();
  });
});

describe('who may run a server the app found answering', () => {
  const me = { uid: 1000, serviceUids: [996] };
  test('this account, root, or a named service account; never another account, even beside this one', () => {
    expect(standingOf([{ uid: 1000 }], me)).toEqual({ standing: 'own', uid: null });
    expect(standingOf([{ uid: 0 }], me)).toEqual({ standing: 'system', uid: null });
    expect(standingOf([{ uid: 996 }], me)).toEqual({ standing: 'system', uid: null });
    expect(standingOf([{ uid: 1001 }], me)).toEqual({ standing: 'foreign', uid: 1001 });
    expect(standingOf([{ uid: 1000 }, { uid: 524288 }], me)).toEqual({ standing: 'foreign', uid: 524288 });
    expect(standingOf([{ uid: 996 }], { uid: 1000 })).toEqual({ standing: 'foreign', uid: 996 });
  });

  test('where the system cannot say, or nothing here listens, the answer is unknown', () => {
    expect(standingOf(null, me).standing).toBe('unknown');
    expect(standingOf([], me).standing).toBe('unknown');
  });
});

// P6-153 on macOS and Windows: each system's own command output, in the layout it prints. Proven
// here as text only; no macOS or Windows computer ran these commands.
describe('macOS: lsof -nP -iTCP:<port> -sTCP:LISTEN -F pu', () => {
  test('each listening process with its account; a process line with no account names nobody', () => {
    expect(lsofListeners('p612\nu501\np733\nu0\n')).toEqual([{ pid: 612, uid: 501 }, { pid: 733, uid: 0 }]);
    expect(lsofListeners('p612\nf7\nn127.0.0.1:11434\n')).toEqual([{ pid: 612, uid: null }]);
    expect(lsofListeners('')).toEqual([]);
    expect(lsofListeners('u501\n')).toEqual([]);
  });
  test('this account or root may run the server; an account that could not be read is not trusted', () => {
    const me = { uid: 501, serviceUids: [] };
    expect(standingOf(lsofListeners('p612\nu501\n'), me).standing).toBe('own');
    expect(standingOf(lsofListeners('p612\nu0\n'), me).standing).toBe('system');
    expect(standingOf(lsofListeners('p612\nu502\n'), me)).toEqual({ standing: 'foreign', uid: 502 });
    expect(standingOf(lsofListeners('p612\n'), me)).toEqual({ standing: 'foreign', uid: null });
  });
});

describe('Windows: netstat -ano, then tasklist /V /FO CSV /NH for the process', () => {
  const NETSTAT = [
    '', 'Active Connections', '', '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1140',
    '  TCP    127.0.0.1:11434        0.0.0.0:0              LISTENING       9084',
    '  TCP    127.0.0.1:11434        127.0.0.1:52011        ESTABLISHED     9084',
    '  TCP    127.0.0.1:52011        127.0.0.1:11434        ESTABLISHED     7300',
    '  TCP    [::1]:11434            [::]:0                 LISTENING       4412',
    '  TCP    127.0.0.1:1143         0.0.0.0:0              LISTENING       2222',
    '  UDP    0.0.0.0:11434          *:*                                    5555',
  ].join('\r\n');
  const row = (user) => `"ollama.exe","9084","Console","1","48,212 K","Running","${user}","0:00:07","N/A"\r\n`;

  test('only the processes LISTENING on that port, whatever language the state is printed in', () => {
    expect(netstatListenerPids(NETSTAT, 11434)).toEqual([9084, 4412]);
    expect(netstatListenerPids(NETSTAT.replaceAll('LISTENING', 'ABHÖREN'), 11434)).toEqual([9084, 4412]);
    expect(netstatListenerPids(NETSTAT, 8080)).toEqual([]);
  });
  test('the process\'s account, or null where Windows names nobody', () => {
    expect(tasklistOwner(row('DESK\\Founder'))).toBe('desk\\founder');
    expect(tasklistOwner(row('NT AUTHORITY\\SYSTEM'))).toBe('nt authority\\system');
    expect(tasklistOwner(row('N/A'))).toBeNull();
    expect(tasklistOwner('INFO: No tasks are running which match the specified criteria.\r\n')).toBeNull();
  });
  test('this account or a Windows service account may run the server; anyone else, or nobody readable, may not', () => {
    const me = { uid: 'desk\\founder', serviceUids: ['nt authority\\system'] };
    const rows = (user) => [{ pid: 9084, uid: tasklistOwner(row(user)) }];
    expect(standingOf(rows('DESK\\Founder'), me).standing).toBe('own');
    expect(standingOf(rows('NT AUTHORITY\\SYSTEM'), me).standing).toBe('system');
    expect(standingOf(rows('DESK\\Mallory'), me)).toEqual({ standing: 'foreign', uid: 'desk\\mallory' });
    expect(standingOf(rows('N/A'), me)).toEqual({ standing: 'foreign', uid: null });
  });
});

describe('a server that answered, whose owner could not be read', () => {
  test('is another account\'s on macOS and Windows, and stays unknown on Linux', () => {
    const unknown = standingOf(null, { uid: 1 });
    expect(answeredStanding('darwin', unknown)).toEqual({ standing: 'foreign', uid: null });
    expect(answeredStanding('win32', unknown)).toEqual({ standing: 'foreign', uid: null });
    expect(answeredStanding('linux', unknown).standing).toBe('unknown');
    expect(answeredStanding('darwin', { standing: 'own', uid: null }).standing).toBe('own');
  });
  test('a port nothing listens on, asked the macOS way and the Windows way on this computer, is never own or system', () => {
    for (const platform of ['darwin', 'win32']) {
      expect(answeredStanding(platform, listenerStanding(1, { platform })).standing).toBe('foreign');
    }
  });
});
