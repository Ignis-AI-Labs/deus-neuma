// Secrets are shown in the trusted window and never handed to the page (audit PR600 P6-10).
// Real wallet vaults (scrypt, AES, ethers) and a real key lock on real files; the real gate, the
// real reveal and kit doors, the real view builders. The two trusted windows need Electron, so
// here a "desk" stands where they stand: it is handed exactly what the window would draw
// (built by the real builders) and answers as the person would.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createWalletService } = require('../../electron/wallet/wallet-service.cjs');
const { createSecretGate } = require('../../electron/wallet/secret-gate.cjs');
const { walletRevealDoors } = require('../../electron/wallet/reveal-doors.cjs');
const { buildGateView, buildSecretView } = require('../../electron/wallet/confirm-view.cjs');
const { kitDoors } = require('../../electron/key-lock/kit-doors.cjs');
const lock = require('../../electron/key-lock/key-lock.cjs');

const SEAL = { available: true, strong: true, encrypt: (s) => Buffer.from(s, 'utf8'), decrypt: (b) => Buffer.from(b).toString('utf8') };
const PW = 'a-strong-operator-passphrase';

// The person at the trusted windows: answers each prompt in turn, and keeps what each window drew.
const desk = (answers) => {
  const seen = { prompts: [], secrets: [] };
  let clock = 1_000_000;
  const gate = createSecretGate({
    ask: async (spec) => { seen.prompts.push(buildGateView(spec)); return answers.shift() === true; },
    show: async (spec) => { seen.secrets.push(buildSecretView(spec)); },
    now: () => clock,
  });
  return { gate, seen, wait: (ms) => { clock += ms; } };
};

describe('the wallet\'s recovery secret', () => {
  let dir, service;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-secret-gate-'));
    service = createWalletService({ walletDir: dir, outerSeal: SEAL, scryptParams: { N: 1024, r: 8, p: 1, dkLen: 32 } });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('is shown in the trusted window, named for its wallet, and the asker gets none of it', async () => {
    const { address, mnemonic } = service.create(PW);
    const { gate, seen } = desk([true]);
    const answer = await walletRevealDoors({ service, gate }).reveal(null, PW);
    expect(answer).toEqual({ shown: true });
    expect(JSON.stringify(answer)).not.toContain(mnemonic.split(' ')[0]);
    expect(seen.prompts[0].fields).toEqual([{ label: 'WALLET', value: address, mono: true }]);
    expect(seen.prompts[0].armMs).toBeGreaterThan(0);
    expect(seen.secrets[0].fields[0].value).toBe(address);
    expect(seen.secrets[0].single).toBe(true);
    expect(seen.secrets[0].body.match(/[a-z]+/g)).toEqual(mnemonic.split(' '));
  });

  it('a new wallet\'s phrase is shown in the trusted window at creation; the asker gets its id and address only', async () => {
    const { gate, seen } = desk([]);
    const doors = walletRevealDoors({ service, gate });
    const cases = [
      [await doors.create(PW), (id) => service.revealSecret(id, PW)],
      [await doors.createForMe(), (id) => service.revealMadeMnemonic(id)],
    ];
    for (const [i, [made, phrase]] of cases.entries()) {
      expect(made).toEqual({ id: expect.any(String), address: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/), shown: true });
      const words = phrase(made.id).split(' ');
      expect(words).toHaveLength(24);
      const drawn = seen.secrets[i];
      expect(drawn.fields[0].value).toBe(made.address);
      expect(drawn.body.match(/[a-z]+/g)).toEqual(words);
      for (const word of words) expect(Object.values(made).filter((value) => typeof value === 'string').join(' ')).not.toContain(word);
    }
    expect(seen.secrets).toHaveLength(2);
    expect(seen.prompts).toHaveLength(0);
  });

  it('a wrong password, or a wallet that was not made here, raises no window at all', async () => {
    service.create(PW);
    const { gate, seen } = desk([true, true]);
    const doors = walletRevealDoors({ service, gate });
    await expect(doors.reveal(null, 'not-the-password')).rejects.toThrow();
    await expect(doors.revealMade(null)).rejects.toThrow(/not made for you/);
    expect(seen.prompts).toHaveLength(0);
    expect(seen.secrets).toHaveLength(0);
  });

  it('a made key\'s phrase goes to the trusted window too; a "no" shows nothing and rests the prompt', async () => {
    const made = service.createForMe();
    const { gate, seen, wait } = desk([false, true]);
    const doors = walletRevealDoors({ service, gate });
    await expect(doors.revealMade(null)).rejects.toThrow(/cancelled/);
    await expect(doors.revealMade(null)).rejects.toThrow(/Wait \d+ seconds/); // asked again at once: no window
    expect(seen.prompts).toHaveLength(1);
    expect(seen.secrets).toHaveLength(0);
    wait(20_000);
    expect(await doors.revealMade(null)).toEqual({ shown: true });
    expect(seen.prompts).toHaveLength(2);
    expect(seen.secrets[0].body.match(/[a-z]+/g)).toEqual(made.mnemonic.split(' '));
  });
});

describe('the Recovery Kit', () => {
  // A real keychain-shaped seal: AES-256-GCM under a key only this object holds.
  const aesSeal = () => {
    const key = crypto.randomBytes(32);
    return {
      backend: () => 'gnome_libsecret',
      encrypt: (text) => {
        const iv = crypto.randomBytes(12);
        const c = crypto.createCipheriv('aes-256-gcm', key, iv);
        const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
        return Buffer.concat([iv, c.getAuthTag(), ct]);
      },
      decrypt: (blob) => {
        const d = crypto.createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12));
        d.setAuthTag(blob.subarray(12, 28));
        return Buffer.concat([d.update(blob.subarray(28)), d.final()]).toString('utf8');
      },
    };
  };
  let dir, file, seal, opened, events;
  const doorsFor = (gate) => kitDoors({
    lock, gate, file: () => file, seal: () => seal, keys: () => opened.keys,
    onSaved: () => events.push('saved'), onReplaced: () => events.push('replaced'),
  });
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-kit-doors-'));
    file = path.join(dir, 'secrets.json');
    seal = aesSeal();
    events = [];
    opened = lock.openKeyLock({ file, seal });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('the code is shown in the trusted window and never returned', async () => {
    const code = lock.revealKit({ file, seal });
    const { gate, seen } = desk([true]);
    const answer = await doorsFor(gate).revealKit();
    expect(answer).toEqual({ shown: true });
    expect(seen.secrets[0].body).toBe(code);
    expect(seen.prompts[0].fields[0].label).toBe('OPENS');
  });

  it('"I saved it" asks first: a "no" keeps this computer\'s copy, a "yes" drops it', async () => {
    const { gate, seen, wait } = desk([false, true]);
    const doors = doorsFor(gate);
    await expect(doors.confirmKit()).rejects.toThrow(/Not confirmed/);
    expect(lock.revealKit({ file, seal })).toMatch(/^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/);
    expect(events).toEqual([]);
    wait(20_000);
    await doors.confirmKit();
    expect(seen.prompts).toHaveLength(2);
    expect(seen.prompts[1].intro).toMatch(/saved your Recovery Kit/);
    expect(lock.revealKit({ file, seal })).toBeNull();
    expect(events).toEqual(['saved']);
    await expect(doors.revealKit()).rejects.toThrow(/nothing to show/); // and no window for it
    expect(seen.prompts).toHaveLength(2);
  });

  it('a new kit is shown in the trusted window, and a declined one changes nothing', async () => {
    const before = lock.revealKit({ file, seal });
    const { gate, seen, wait } = desk([false, true]);
    const doors = doorsFor(gate);
    await expect(doors.newKit()).rejects.toThrow(/cancelled/);
    expect(lock.revealKit({ file, seal })).toBe(before);
    wait(20_000);
    expect(await doors.newKit()).toEqual({ shown: true });
    const after = lock.revealKit({ file, seal });
    expect(after).not.toBe(before);
    expect(seen.secrets[0].body).toBe(after);
    expect(events).toEqual(['replaced']);
  });
});
