// Real signed-wallet terminal routes and isolated PTYs. No swallowed assertions.
import { afterEach, beforeEach, expect, test } from 'vitest';
import { startTerminalKit, connectTerminal, terminalPid, until } from '../helpers/terminal-lifecycle-kit.js';

let kit, owner;
beforeEach(async () => { kit = await startTerminalKit(); owner = await kit.signIn(); });
afterEach(async () => { await kit?.dispose(); });

test('fresh spawn returns a stable terminal identity', async () => {
  const client = connectTerminal(kit, owner);
  expect(await terminalPid(client)).toBeGreaterThan(0);
  expect(client.hello).toMatchObject({ attached: false, id: expect.stringMatching(/^term-/) });
  client.ws.close(1000, 'explicit close');
  await until(() => client.closed);
});

test('abnormal departure replays output and continues the same shell', async () => {
  const first = connectTerminal(kit, owner);
  const pid = await terminalPid(first);
  first.send('NEUMA_MARK=octopus_$((7*6)); printf "MARK=%s\\n" "$NEUMA_MARK"\n');
  await until(() => first.output.includes('MARK=octopus_42'));
  first.ws.close(1011, 'connection lost');
  await until(() => first.closed);
  const second = connectTerminal(kit, owner, first.hello.id);
  await until(() => second.hello);
  expect(second.hello).toMatchObject({ id: first.hello.id, attached: true });
  await until(() => second.output.includes('MARK=octopus_42'));
  second.send('printf "CONTINUED=%s:%s\\n" "$NEUMA_MARK" "$$"\n');
  await until(() => second.output.includes(`CONTINUED=octopus_42:${pid}`));
  second.ws.close(1000, 'explicit close');
  await until(() => second.closed);
});

test('explicit close makes a stale ID refuse without creating a replacement', async () => {
  const first = connectTerminal(kit, owner);
  await terminalPid(first);
  first.ws.close(1000, 'explicit close');
  await until(() => first.closed);
  const second = connectTerminal(kit, owner, first.hello.id);
  await until(() => second.closed);
  expect(second.closed).toBe(1008);
  expect(second.hello).toBeNull();
  expect(await kit.count(owner)).toBe(0);
});
