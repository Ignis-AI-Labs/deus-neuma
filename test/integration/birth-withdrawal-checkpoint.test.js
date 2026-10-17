// Actual auth, portal, handler and disk. Persisted fixtures summon no being.
import fs from 'node:fs/promises';
import { expect, test } from 'vitest';
import { recoveryKit } from '../helpers/summoning-recovery-kit.js';

// Supply this session's own sealed witness env; CI must never borrow a wallet.
const recoveryTest = test.skipIf(!process.env.NEUMA_WITNESS_ENV);

recoveryTest.each(['disk', 'active'])('named %s checkpoint refuses withdrawal and retains bytes', async (location) => {
  const kit = await recoveryKit();
  try {
    const record = await kit.seed('Checkpoint fixture');
    const before = await fs.readFile(record.file, 'utf8');
    if (location === 'active') await kit.handler.restoreSession(record.sessionId);
    else expect(kit.handler.getSession(record.sessionId)).toBeUndefined();
    const { client, messages } = await kit.connect();
    client.send(JSON.stringify({ type: 'birth:abandon', sessionId: record.sessionId, requestId: 'checkpoint-proof' }));
    await expect.poll(() => messages.find(m => m.type.startsWith('birth:abandon'))).toBeTruthy();
    expect(messages.find(m => m.type.startsWith('birth:abandon'))).toMatchObject({
      type: 'birth:abandon_refused', sessionId: record.sessionId, requestId: 'checkpoint-proof', reason: 'committed',
    });
    expect(await fs.readFile(record.file, 'utf8')).toBe(before);
    client.terminate();
  } finally { await kit.close(); }
}, 20000);

recoveryTest('unnamed disk checkpoint restores and acknowledges only after removal', async () => {
  const kit = await recoveryKit();
  try {
    const record = await kit.seed();
    const { client, messages } = await kit.connect();
    client.send(JSON.stringify({ type: 'birth:abandon', sessionId: record.sessionId, requestId: 'unnamed' }));
    await expect.poll(() => messages.find(m => m.type.startsWith('birth:abandon'))).toBeTruthy();
    expect(messages.find(m => m.type.startsWith('birth:abandon'))).toMatchObject({ type: 'birth:abandoned', requestId: 'unnamed', sessionId: record.sessionId });
    await expect(fs.stat(record.file)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(kit.handler.getSession(record.sessionId)).toBeUndefined();
    client.terminate();
  } finally { await kit.close(); }
}, 20000);

recoveryTest.each(['missing', 'corrupt', 'malformed', 'invalid'])('%s checkpoint never authorizes withdrawal', async (kind) => {
  const kit = await recoveryKit();
  try {
    const record = await kit.seed();
    if (kind === 'missing') await fs.unlink(record.file);
    if (kind === 'corrupt') await fs.writeFile(record.file, '{');
    if (kind === 'malformed') await fs.writeFile(record.file, '{}');
    const { client, messages } = await kit.connect();
    client.send(JSON.stringify({ type: 'birth:abandon', sessionId: kind === 'invalid' ? '../other' : record.sessionId }));
    await expect.poll(() => messages.find(m => m.type.startsWith('birth:abandon'))).toBeTruthy();
    expect(messages.find(m => m.type.startsWith('birth:abandon')).type).toBe('birth:abandon_refused');
    if (kind === 'corrupt') expect(await fs.readFile(record.file, 'utf8')).toBe('{');
    if (kind === 'malformed') expect(await fs.readFile(record.file, 'utf8')).toBe('{}');
    client.terminate();
  } finally { await kit.close(); }
}, 20000);
