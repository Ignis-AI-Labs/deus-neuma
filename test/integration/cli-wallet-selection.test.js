// P6-118 — real process, real wallet derivation, real files. Selection reports
// never print key material; generic selection requires the explicit opt-in.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Wallet } from 'ethers';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const MODULE = path.resolve('cli/lib/wallet.js');
let root;
let envPath;
let wallet;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-wallet-selection-'));
  envPath = path.join(root, 'wallet.env');
  wallet = Wallet.createRandom();
});

afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const resolve = (keyName, optIn = false) => {
  fs.writeFileSync(envPath, `${keyName}=${wallet.privateKey}\n`, { mode: 0o600 });
  const env = { ...process.env };
  if (optIn) env.NEUMA_WALLET_ALLOW_GENERIC_KEY = '1';
  else delete env.NEUMA_WALLET_ALLOW_GENERIC_KEY;
  return spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { readOperatorWallet } from ${JSON.stringify(MODULE)};
    const selected = readOperatorWallet(${JSON.stringify(envPath)});
    console.log(JSON.stringify({ keyName: selected.keyName, address: selected.address }));
  `], { env, encoding: 'utf8' });
};

describe('visible, explicit CLI wallet selection', () => {
  test('a generic key refuses implicitly, then reports only its name and address after opt-in', () => {
    const refused = resolve('CONTRACT_DEPLOYER_PRIVATE_KEY');
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('Refusing implicit wallet key CONTRACT_DEPLOYER_PRIVATE_KEY');
    expect(refused.stderr).not.toContain(wallet.privateKey);

    const accepted = resolve('CONTRACT_DEPLOYER_PRIVATE_KEY', true);
    expect(accepted.status).toBe(0);
    expect(accepted.stderr).toContain(`using CONTRACT_DEPLOYER_PRIVATE_KEY for ${wallet.address}`);
    expect(JSON.parse(accepted.stdout)).toEqual({ keyName: 'CONTRACT_DEPLOYER_PRIVATE_KEY', address: wallet.address });
    expect(`${accepted.stdout}${accepted.stderr}`).not.toContain(wallet.privateKey);
  });

  test('a preferred key succeeds without the generic flag and reports the same non-secret identity', () => {
    const accepted = resolve('OPERATOR_WALLET_PRIVATE_KEY');
    expect(accepted.status).toBe(0);
    expect(accepted.stderr).toContain(`using OPERATOR_WALLET_PRIVATE_KEY for ${wallet.address}`);
    expect(JSON.parse(accepted.stdout)).toEqual({ keyName: 'OPERATOR_WALLET_PRIVATE_KEY', address: wallet.address });
    expect(`${accepted.stdout}${accepted.stderr}`).not.toContain(wallet.privateKey);
  });
});
