/**
 * A VERDICT IS VERIFIED, NOT TRUSTED — and a leaked secret is judged by
 * whether its value is still LIVE (Design note, 2026-10-19: the CSO must address
 * threats […]).
 *
 * Proven through the REAL scheduler (runSecurityScan) over a REAL tmp git repo
 * with real commits and a real untracked .env, the real secret sweep + history
 * sweep + liveness check, the real host/house/self-check legs, and the real
 * per-house ledger on tmp disk (RULE 0 — nothing in the scanned path faked).
 * The fake keys are built at runtime, so this file carries no key shape.
 *
 * Claims:
 *   - a CSO `mitigated` on a secret the next whole scan still sees is reopened,
 *     the row naming whose claim the scan contradicted; after the real fix a
 *     fresh claim is VERIFIED (row + verifiedAt), once; the secret's return
 *     reopens it;
 *   - a history leak reads […] (critical, rotate
 *     <VAR>) while the env value matches, then […] (high) once
 *     the value changes — the entry stays open until someone marks it
 *     mitigated, which the watch then verifies NOT LIVE and keeps settled
 *     though history still holds the leak; the old value coming back reopens
 *     it; a claim while live is reopened;
 *   - no value ever reaches the ledger or the scan state on disk.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { standTwoHouses, HOUSE_A } from '../helpers/house-office-kit.js';
import { createWatchStore } from '../../backend/services/security/watch-store.js';
import { threatLedgerFor } from '../../backend/services/security/threat-ledger.js';
import { runSecurityScan } from '../../backend/services/security/security-scheduler.js';
import { __resetCoalesce } from '../../backend/services/notification-bus.js';

const execFileP = promisify(execFile);
const CSO = 'guardianlane';
// Fake key shapes, assembled at runtime so this file never matches a rule.
const FAKE_AWS = ['AKIA', 'V'.repeat(16)].join('');
const LEAKED_EVM = `0x${'5e'.repeat(32)}`;
const ROTATED_EVM = `0x${'6f'.repeat(32)}`;
const LEAKED_OPENAI = ['sk', '-', 'verifiedfixture', 'W'.repeat(24)].join('');
const VALUES = [FAKE_AWS, LEAKED_EVM.slice(2), ROTATED_EVM.slice(2), LEAKED_OPENAI];

const git = (cwd, ...args) => execFileP('git', [
  '-c', 'user.name=verified-test', '-c', 'user.email=verified@test.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null',
  ...args,
], { cwd });

describe('verified verdicts + leak liveness (real scheduler, real git, real ledger)', () => {
  let houses, repoDir, watchStore, ledger;
  const scan = () => runSecurityScan({ wallet: HOUSE_A, trigger: 'manual', watchStore, ledger });
  const write = (rel, text) => fs.writeFile(path.join(repoDir, rel), text);
  const entry = async (pred) => (await ledger.load()).find(pred);
  const claim = (id, assessment) => ledger.assess(id, { status: 'mitigated', assessment, assessedBy: CSO });
  // Every byte the office wrote: the ledger, the scan state, the host file.
  const officeText = async () => {
    const dir = houses.houseFile(HOUSE_A, 'offices', 'security');
    const names = await fs.readdir(dir);
    return (await Promise.all(names.filter((n) => n.endsWith('.json')).map((n) => fs.readFile(path.join(dir, n), 'utf8')))).join('\n');
  };
  const expectNoValues = async () => {
    const text = await officeText();
    for (const value of VALUES) expect(text).not.toContain(value);
  };

  beforeEach(async () => {
    houses = await standTwoHouses({ label: 'security-verified-verdicts' });
    __resetCoalesce();
    repoDir = path.join(houses.tmp, 'watched');
    await fs.mkdir(repoDir, { recursive: true });
    await git(repoDir, 'init', '-q', '-b', 'main');
    await write('README.md', '# watched\n');
    await git(repoDir, 'add', 'README.md');
    await git(repoDir, 'commit', '-q', '-m', 'start');
    watchStore = createWatchStore({ path: path.join(houses.tmp, 'watch.json'), seedRepos: [repoDir] });
    ledger = await threatLedgerFor(HOUSE_A);
  });
  afterEach(() => houses.restore());

  test('a claimed mitigation the scan contradicts is reopened; after the fix it is verified once; a return reopens it', async () => {
    await write('config.txt', `AWS_ACCESS_KEY_ID=${FAKE_AWS}\n`);
    await git(repoDir, 'add', 'config.txt');
    const isSweep = (e) => e.externalId.startsWith('sweep:aws-access-key:config.txt');

    await scan();
    const found = await entry(isSweep);
    expect(found).toMatchObject({ status: 'new', verifiedAt: null });
    expect(found.remedy).toMatch(/^rotate the aws-access-key credential in config\.txt at AWS IAM/);

    // The CSO says it is handled — but the value still sits in the file.
    const said = await claim(found.id, 'rotated; the file is clean now');
    const claimedAt = said.entry.assessedAt;
    const contradicted = await scan();
    expect(contradicted.reopened).toBeGreaterThanOrEqual(1);
    const reopened = await entry(isSweep);
    expect(reopened.status).toBe('new');
    expect(reopened.history.at(-1)).toMatchObject({ event: 'reopened', assessedBy: 'watch', claimedBy: CSO, claimedAt });
    expect(reopened.history.at(-1).assessment)
      .toMatch(new RegExp(`^mitigation claimed by ${CSO} at ${claimedAt}, but the secret-sweep scan still sees it \\(`));
    expect(reopened.history.map((h) => h.status)).toContain('mitigated'); // the claim itself stays on record

    // The real fix, then the claim: the next whole scan proves it.
    await write('config.txt', 'AWS_ACCESS_KEY_ID=read-from-the-vault\n');
    await git(repoDir, 'add', 'config.txt'); // the sweep reads what git holds
    const fixed = await claim(found.id, 'the key is out of the file and rotated');
    const proven = await scan();
    expect(proven.verified).toBeGreaterThanOrEqual(1);
    const verified = await entry(isSweep);
    expect(verified).toMatchObject({ status: 'mitigated', assessedBy: CSO });
    expect(Date.parse(verified.verifiedAt)).toBeGreaterThanOrEqual(Date.parse(fixed.entry.assessedAt));
    expect(verified.history.at(-1)).toMatchObject({ event: 'verified', status: 'mitigated', assessedBy: 'watch' });
    expect(verified.history.at(-1).assessment)
      .toMatch(new RegExp(`^verified by the secret-sweep scan at .+ — no longer seen since the mitigation claimed by ${CSO} at ${fixed.entry.assessedAt}$`));

    // Proven once: another clean scan adds nothing to its record.
    const rows = verified.history.length;
    await scan();
    expect((await entry(isSweep)).history).toHaveLength(rows);

    // The secret comes back: the proven claim no longer holds.
    await write('config.txt', `AWS_ACCESS_KEY_ID=${FAKE_AWS}\n`);
    await git(repoDir, 'add', 'config.txt');
    await scan();
    const back = await entry(isSweep);
    expect(back.status).toBe('new');
    expect(back.verifiedAt).toBeNull();
    expect(back.history.at(-1).event).toBe('reopened');
    await expectNoValues();
  }, 240_000);

  test('a history leak: still live as the variable → no longer live → claimed, verified not live → live again reopens', async () => {
    await fs.mkdir(path.join(repoDir, 'docs'), { recursive: true });
    await write('docs/notes.md', `deploy with\nDEPLOYER_PRIVATE_KEY=${LEAKED_EVM}\nOPENAI_API_KEY=${LEAKED_OPENAI}\n`);
    await git(repoDir, 'add', 'docs/notes.md');
    await git(repoDir, 'commit', '-q', '-m', 'notes');
    await git(repoDir, 'rm', '-q', 'docs/notes.md');
    await git(repoDir, 'commit', '-q', '-m', 'redact the notes');
    // The live values sit in the untracked .env — the wallet key under ANOTHER
    // name than the leak used: the match is the value's own material.
    await write('.env', `WALLET_SIGNER_KEY=${LEAKED_EVM}\nOPENAI_API_KEY=${LEAKED_OPENAI}\n`);
    const isEvm = (e) => e.externalId.startsWith('history:evm-private-key:');
    const isOpenai = (e) => e.externalId.startsWith('history:openai-key:');

    await scan();
    const live = await entry(isEvm);
    expect(live).toMatchObject({ status: 'new', severity: 'critical' });
    expect(live.summary).toMatch(/^Still live as WALLET_SIGNER_KEY in \.env\. A "evm-private-key" value entered the history/);
    expect(live.remedy).toMatch(/^replace WALLET_SIGNER_KEY: a wallet key cannot be revoked/);
    const openai = await entry(isOpenai);
    expect(openai).toMatchObject({ severity: 'critical' });
    expect(openai.summary).toMatch(/^Still live as OPENAI_API_KEY in \.env\./);
    expect(openai.remedy).toBe('rotate OPENAI_API_KEY at OpenAI (platform.openai.com → API keys), then confirm the old key is revoked; put the NEW value in .env — the leaked one stays in history for good.');

    // A claim while the leaked value is still in use is contradicted.
    const early = await claim(live.id, 'rotated it');
    await scan();
    const contradicted = await entry(isEvm);
    expect(contradicted.status).toBe('new');
    expect(contradicted.history.at(-1).assessment).toMatch(new RegExp(
      `^mitigation claimed by ${CSO} at ${early.entry.assessedAt}, but the secret-sweep scan still sees it live as WALLET_SIGNER_KEY in \\.env \\(`,
    ));

    // Rotated for real: the env holds a NEW value. History still has the old
    // one, so the entry stays open — high now, with the revocation to confirm.
    await write('.env', `WALLET_SIGNER_KEY=${ROTATED_EVM}\nOPENAI_API_KEY=${LEAKED_OPENAI}\n`);
    await scan();
    const rotated = await entry(isEvm);
    expect(rotated).toMatchObject({ status: 'new', severity: 'high' });
    expect(rotated.summary).toMatch(/^No longer in use on this machine — no env file of this checkout holds the value\./);
    expect(rotated.remedy).toMatch(/^confirm the old evm-private-key credential is revoked at the provider, then mark this mitigated/);
    expect((await entry(isOpenai)).severity).toBe('critical'); // the other leak is still live

    // The CSO marks it handled; the watch proves the value is not live, and
    // the entry STAYS settled though the history scan still sees the leak.
    const settled = await claim(rotated.id, 'deployer rotated; old address drained');
    const proven = await scan();
    expect(proven.verified).toBeGreaterThanOrEqual(1);
    const verified = await entry(isEvm);
    expect(verified).toMatchObject({ status: 'mitigated', assessedBy: CSO });
    expect(Date.parse(verified.verifiedAt)).toBeGreaterThanOrEqual(Date.parse(settled.entry.assessedAt));
    expect(verified.history.at(-1)).toMatchObject({ event: 'verified', status: 'mitigated', claimedBy: CSO });
    expect(verified.history.at(-1).assessment).toMatch(/^verified not live by the secret-sweep scan at .+ — no env file of this checkout holds the value; the history still carries it/);
    const rows = verified.history.length;
    await scan();
    const still = await entry(isEvm);
    expect(still.status).toBe('mitigated');
    expect(still.history).toHaveLength(rows);

    // The old value comes back into use: the settled leak reopens, critical.
    await write('.env', `WALLET_SIGNER_KEY=${LEAKED_EVM}\nOPENAI_API_KEY=${LEAKED_OPENAI}\n`);
    await scan();
    const relive = await entry(isEvm);
    expect(relive).toMatchObject({ status: 'new', severity: 'critical', verifiedAt: null });
    // The reopen, then the re-rating it brought (high → critical), in that order.
    expect(relive.history.slice(-2).map((h) => h.event)).toEqual(['reopened', 'severity']);
    expect(relive.history.at(-2).assessment).toContain('still sees it live as WALLET_SIGNER_KEY in .env');
    await expectNoValues();
  }, 240_000);
});
