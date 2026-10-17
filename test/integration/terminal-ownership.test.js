// Real signed-wallet HTTP auth, real transport, real PTY/process table. No doubles.
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { startTerminalKit, connectTerminal, terminalPid, until, pidAlive } from '../helpers/terminal-lifecycle-kit.js';

describe('HR-TERMINAL wallet custody', () => {
  let kit, a, b;
  beforeAll(async () => {
    kit = await startTerminalKit();
    a = await kit.signIn();
    b = await kit.signIn();
  });
  afterAll(async () => { await kit?.dispose(); });

  test('B cannot replay, input, resize or close A; signed reauth A recovers the same marker shell', async () => {
    const first = connectTerminal(kit, a);
    const pid = await terminalPid(first);
    const id = first.hello.id;
    try {
      first.send('NEUMA_MARK=octopus_$((7*6)); printf "MARK=%s\\n" "$NEUMA_MARK"\n');
      await until(() => first.output.includes('MARK=octopus_42'));
      const foreign = connectTerminal(kit, b, id);
      foreign.ws.on('open', () => {
        foreign.send('NEUMA_MARK=stolen\n');
        foreign.ws.send(JSON.stringify({ type: 'terminal:resize', cols: 1, rows: 1 }));
      });
      await until(() => foreign.closed);
      expect(foreign.closed).toBe(1008);
      expect(foreign.hello).toBeNull();
      expect(foreign.output).toBe('');
      expect((await kit.close(b, id)).status).toBe(404);
      expect(await kit.count(a)).toBe(1);
      expect(pidAlive(pid)).toBe(true);

      first.ws.close(4000, 'renderer detached');
      await until(() => first.closed);
      const freshAuth = await kit.signIn(a.wallet);
      const recovered = connectTerminal(kit, freshAuth, id);
      await until(() => recovered.hello);
      expect(recovered.hello).toMatchObject({ id, attached: true });
      await until(() => recovered.output.includes('MARK=octopus_42'));
      recovered.send('printf "RECOVERED=%s:%s\\n" "$NEUMA_MARK" "$$"\n');
      await until(() => recovered.output.includes(`RECOVERED=octopus_42:${pid}`));
      recovered.ws.close(1000, 'operator close');
      await until(() => !pidAlive(pid));
      expect(await kit.count(a)).toBe(0);
      const stale = connectTerminal(kit, freshAuth, id);
      await until(() => stale.closed);
      expect(stale.closed).toBe(1008);
      expect(stale.hello).toBeNull();
      expect(await kit.count(a)).toBe(0);
    } finally { await kit.close(a, id); }
  }, 45000);

  test('explicit close kills all same-wallet views and DELETE kills while detached', async () => {
    const first = connectTerminal(kit, a);
    const pid = await terminalPid(first);
    const id = first.hello.id;
    try {
      const second = connectTerminal(kit, a, id);
      await until(() => second.hello);
      first.ws.close(1000, 'explicit close');
      await until(() => second.closed && !pidAlive(pid));
      expect(await kit.count(a)).toBe(0);
    } finally { await kit.close(a, id); }
    const detached = connectTerminal(kit, a);
    const detachedPid = await terminalPid(detached);
    detached.ws.close(4000, 'effect disposal');
    await until(() => detached.closed);
    expect((await kit.close(a, detached.hello.id)).status).toBe(200);
    await until(() => !pidAlive(detachedPid));
  });

  test('invalid token, empty/unknown ID refuse without a fallback shell', async () => {
    for (const id of ['', 'term-nonexistent']) {
      const client = connectTerminal(kit, a, id);
      await until(() => client.closed);
      expect(client.closed).toBe(1008);
      expect(client.hello).toBeNull();
    }
    const invalid = connectTerminal(kit, { token: 'not-a-signed-session' }, 'term-nonexistent');
    await until(() => invalid.closed);
    expect(invalid.closed).toBe(4001);
    expect(await kit.count(a)).toBe(0);
  });

  test('real token expiry detaches control/output and the owner can authenticate again', async () => {
    const expiring = kit.expiresWithin(a, 2500);
    const client = connectTerminal(kit, expiring);
    const pid = await terminalPid(client);
    const id = client.hello.id;
    try {
      await until(() => client.closed);
      expect(client.closed).toBe(4001);
      expect(pidAlive(pid)).toBe(true);
      const denied = connectTerminal(kit, expiring, id);
      await until(() => denied.closed);
      expect(denied.closed).toBe(4001);
      expect(denied.output).toBe('');
      expect((await kit.close(expiring, id)).status).toBe(401);
      const renewed = await kit.signIn(a.wallet);
      const recovered = connectTerminal(kit, renewed, id);
      expect(await terminalPid(recovered)).toBe(pid);
      expect(recovered.hello.attached).toBe(true);
    } finally { await kit.close(a, id); }
  });

  test('real five-minute detached TTL reaps the process and stale identity refuses', async () => {
    const client = connectTerminal(kit, a);
    const pid = await terminalPid(client);
    const id = client.hello.id;
    try {
      client.ws.close(4000, 'detached TTL proof');
      await until(() => client.closed);
      expect(pidAlive(pid)).toBe(true);
      await until(() => !pidAlive(pid), 310000);
      expect(await kit.count(a)).toBe(0);
      const stale = connectTerminal(kit, a, id);
      await until(() => stale.closed);
      expect(stale.closed).toBe(1008);
      expect(stale.hello).toBeNull();
      expect(await kit.count(a)).toBe(0);
    } finally { await kit.close(a, id); }
  }, 330000);

  test('backend process boundary reaps detached PTYs; a new registry refuses the old ID', async () => {
    let isolated = await startTerminalKit();
    try {
      const owner = await isolated.signIn(a.wallet);
      const client = connectTerminal(isolated, owner);
      const pid = await terminalPid(client);
      const id = client.hello.id;
      client.ws.close(4000, 'renderer detached');
      await until(() => client.closed);
      await isolated.dispose();
      await until(() => !pidAlive(pid));
      isolated = await startTerminalKit();
      const reauthenticated = await isolated.signIn(a.wallet);
      const stale = connectTerminal(isolated, reauthenticated, id);
      await until(() => stale.closed);
      expect(stale.closed).toBe(1008);
      expect(stale.hello).toBeNull();
      expect(await isolated.count(reauthenticated)).toBe(0);
    } finally { await isolated.dispose(); }
  }, 30000);
});
