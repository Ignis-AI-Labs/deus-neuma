/**
 * The watch closes what has been handled and keeps the operator told —
 * proven through the REAL scheduler on real tmp houses (RULE 0, no double):
 * a real `runSecurityScan` with a real watched git repo (real `git ls-files`,
 * real secret sweep), the real host and house probes, the real per-house
 * ledger, the real notification bus and store. Nothing in the scanned path
 * is faked; the planted "secret" is a fixed fake key shape in a tmp repo.
 *
 * Claims: a secret removed from the repo is closed by the next scan and
 * reopens (with a card) when it returns; the OSV leg that errored (no
 * lockfile) closes nothing in its scope; a stale host row closes on a clean
 * host read; a house with no CSO seated is walked and its operator carded;
 * an open critical reminds at most once a day until settled; the CSO
 * briefing leads with the worst, newest threats.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { standTwoHouses, HOUSE_A, HOUSE_B } from '../helpers/house-office-kit.js';
import { createWatchStore } from '../../backend/services/security/watch-store.js';
import { threatLedgerFor } from '../../backend/services/security/threat-ledger.js';
import { csoDesignation } from '../../backend/services/security/cso-designation.js';
import { runSecurityScan, tickSecurityHouses, scannedScopes } from '../../backend/services/security/security-scheduler.js';
import { remindOpenCriticals } from '../../backend/services/security/security-alerts.js';
import { csoBriefingSection } from '../../backend/services/security/security-briefing.js';
import { readNotifications } from '../../backend/services/notification-store.js';
import { __resetCoalesce } from '../../backend/services/notification-bus.js';
import { KIND } from '../../core/runtime/notification-record.js';

const git = promisify(execFile);
const HOUR = 3600 * 1000;
// A fake AWS access-key shape, assembled so this file itself never matches.
const FAKE_KEY = ['AKIA', 'Q'.repeat(16)].join('');

const cards = async (wallet) => (await readNotifications(wallet)).records.filter((r) => r.kind === KIND.securityAlert);

describe('the watch closes, reopens, and tells the operator (real scheduler, real stores)', () => {
  let houses, repoDir, watchStore, ledger;
  const scan = () => runSecurityScan({ wallet: HOUSE_A, trigger: 'manual', watchStore, ledger });
  // Staged on every plant: the sweep reads what git holds, never the working
  // tree alone (a deleted or unreadable working copy must not read as clean).
  const plant = async (text) => {
    await fs.writeFile(path.join(repoDir, 'config.txt'), text);
    await git('git', ['add', 'config.txt'], { cwd: repoDir });
  };
  const sweepRow = async () => (await ledger.load()).find((e) => e.source === 'secret-sweep');

  beforeEach(async () => {
    houses = await standTwoHouses({ label: 'security-watch-lifecycle' });
    __resetCoalesce();
    repoDir = path.join(houses.tmp, 'watched');
    await fs.mkdir(repoDir, { recursive: true });
    await git('git', ['init', '-q'], { cwd: repoDir });
    await plant(`AWS_ACCESS_KEY_ID=${FAKE_KEY}\n`);
    await git('git', ['add', 'config.txt'], { cwd: repoDir });
    watchStore = createWatchStore({ path: path.join(houses.tmp, 'watch.json'), seedRepos: [repoDir] });
    ledger = await threatLedgerFor(HOUSE_A);
  });
  afterEach(() => houses.restore());

  // real scans: their self-checks import the whole route tree (self-check.js, machine-owner-gate),
  // ~4 s cold in a worker alone and past the 15 s default under the full parallel lane
  test('vanish → closed by the watch; return → reopened and carded; an errored OSV leg closes nothing', async () => {
    // Rows from an earlier era of the watch: an advisory on this repo, and a
    // listener long gone from the host.
    await ledger.ingest([
      { layer: 'software', source: 'osv', repo: 'watched', externalId: 'GHSA-old0-0000-0000', title: 'old advisory', severity: 'high' },
      { layer: 'hardware', source: 'host-probe', externalId: 'host:listener:203.0.113.9:1', title: 'long-gone listener', severity: 'medium' },
    ]);

    const first = await scan();
    expect(first.repos[0].error).toMatch(/no package-lock\.json/); // the OSV leg is blind here
    // The platform's own walls are re-proven on every pass, and hold here.
    expect(first.selfCheck).toEqual({ findings: [], errors: [] });
    expect(first.added).toBeGreaterThanOrEqual(1);
    expect(await sweepRow()).toMatchObject({ status: 'new', severity: 'high' });
    // No CSO is seated in house A: the card goes to its operator anyway.
    const firstCards = await cards(HOUSE_A);
    expect(firstCards).toHaveLength(1);
    expect(firstCards[0].detail).toContain('no CSO seated');
    // The card stamps what it named, so the daily reminder counts from it.
    expect(Date.parse((await sweepRow()).alertedAt)).toBeGreaterThan(0);

    const stale = (await ledger.load()).find((e) => e.externalId === 'host:listener:203.0.113.9:1');
    if (first.host.errors.length === 0) {
      expect(stale).toMatchObject({ status: 'mitigated', assessedBy: 'watch' });
    } else {
      expect(stale.status).toBe('new'); // a blind host read closes nothing
    }

    await plant('AWS_ACCESS_KEY_ID=read-from-the-vault\n');
    const second = await scan();
    expect(second.closed).toBeGreaterThanOrEqual(1);
    const closed = await sweepRow();
    expect(closed).toMatchObject({ status: 'mitigated', assessedBy: 'watch' });
    expect(closed.history.at(-1).event).toBe('vanished');
    // The OSV scope errored on every run: its old row is untouched.
    expect((await ledger.load()).find((e) => e.externalId === 'GHSA-old0-0000-0000').status).toBe('new');

    // The host leg reads this machine's real listeners, and a loaded box can
    // blind one read and not the next — so the reopen's card is counted from
    // here, not from the start of the test.
    const cardsBefore = (await cards(HOUSE_A)).length;
    await plant(`AWS_ACCESS_KEY_ID=${FAKE_KEY}\n`);
    const third = await scan();
    expect(third.reopened).toBe(1);
    const back = await sweepRow();
    expect(back.status).toBe('new');
    expect(back.history.map((h) => h.event)).toEqual(['vanished', 'reopened']);
    expect((await ledger.load()).filter((e) => e.source === 'secret-sweep')).toHaveLength(1);
    const allCards = await cards(HOUSE_A);
    expect(allCards).toHaveLength(cardsBefore + 1);
    expect(allCards.at(-1).detail).toContain('sweep:aws-access-key:config.txt');
    expect(await cards(HOUSE_B)).toHaveLength(0);
  }, 60_000);

  test('a scope is whole only when every leg that feeds it ran clean', async () => {
    // Real leg results: the real sweep of the real tmp repo, and the real
    // advisory read failing on its missing lockfile.
    const repo = { id: 'watched', path: repoDir };
    const { sweepRepo } = await import('../../backend/services/security/secret-sweep.js');
    const { runAdvisoryScan } = await import('../../backend/services/security/advisory-scan.js');
    const sweep = await sweepRepo(repo);
    const advisories = await runAdvisoryScan(repo);
    expect(sweep.error).toBeNull();
    expect(advisories.error).toBeTruthy();
    const scopes = (legs) => scannedScopes({ repoLegs: legs }).map((s) => `${s.source}/${s.repo}`);
    // The history pass shares the secret-sweep scope: errored, null or never
    // run → not whole, or a leak still in a pushed commit would close.
    expect(scopes([{ repo: 'watched', advisories, sweep }])).toEqual([]);
    expect(scopes([{ repo: 'watched', advisories, sweep, history: { findings: [], error: 'git history scan timed out' } }])).toEqual([]);
    expect(scopes([{ repo: 'watched', advisories, sweep, history: null }])).toEqual([]);
    const { sweepRepoHistory } = await import('../../backend/services/security/history-sweep.js');
    const history = await sweepRepoHistory(repo);
    expect(history.error).toBeNull();
    expect(scopes([{ repo: 'watched', advisories, sweep, history }])).toEqual(['secret-sweep/watched']);
    // An installed app is not a checkout: its sweep is skipped, never "clean".
    const skipped = { repo: 'watched', scanned: 0, findings: [], error: null, skipped: true };
    expect(scopes([{ repo: 'watched', advisories, sweep: skipped, history: { ...skipped, durationMs: 0 } }])).toEqual([]);
    expect(scannedScopes({ host: { errors: ['ss failed — listeners unmeasured'] }, house: { errors: [] } }))
      .toEqual([{ source: 'house-probe', repo: null }]);
  });

  test('a served house with NO CSO seated is walked', async () => {
    const walked = [];
    await tickSecurityHouses({ runFor: async (wallet) => { walked.push(wallet); } });
    expect(walked).toEqual([HOUSE_A]);
  });

  test('an open critical reminds at most once a day, and stops once settled', async () => {
    const t0 = Date.now();
    const { added } = await ledger.ingest([{
      layer: 'house', source: 'house-probe', externalId: 'house:plaintext-secret:env.fixture',
      title: 'env.fixture holds a plaintext secret', severity: 'critical',
    }, {
      layer: 'software', source: 'osv', repo: 'watched', externalId: 'GHSA-high-0000-0000', title: 'a high', severity: 'high',
    }]);
    const remind = (offsetHours) => remindOpenCriticals({ wallet: HOUSE_A, nowMs: t0 + offsetHours * HOUR, ledger });

    expect(await remind(1)).toBeNull(); // first sighting an hour ago
    const card = await remind(25);
    expect(card.title).toBe('Security watch: 1 critical threat still open');
    expect(card.detail).toContain('house:plaintext-secret:env.fixture');
    expect(card.detail).not.toContain('GHSA-high'); // highs never remind
    expect(await remind(26)).toBeNull();
    expect(await remind(48)).toBeNull();
    expect(await remind(49)).not.toBeNull();
    await ledger.assess(added[0].id, { status: 'mitigated', assessment: 'rotated and sealed', assessedBy: 'op' });
    expect(await remind(80)).toBeNull();
    expect(await cards(HOUSE_A)).toHaveLength(2);
  });

  test('the CSO briefing leads with the worst, newest threats', async () => {
    await csoDesignation.designate(HOUSE_A, 'dovan');
    const mediums = Array.from({ length: 20 }, (_, i) => ({
      layer: 'software', source: 'osv', repo: 'watched', externalId: `GHSA-med-${i}`, title: `medium ${i}`, severity: 'medium',
    }));
    await ledger.ingest(mediums);
    await ledger.ingest([{ layer: 'house', source: 'house-probe', externalId: 'house:keypair-custody:keir', title: 'custody owed', severity: 'critical' }]);
    const text = await csoBriefingSection({ companion: { neumaId: 'dovan' }, walletAddress: HOUSE_A });
    const lane = text.split('### New threats awaiting YOUR assessment\n')[1].split('\n');
    expect(lane[0]).toContain('critical');
    expect(lane[0]).toContain('custody owed');
    expect(lane.filter((l) => l.startsWith('- [')).length).toBe(15);
  });
});
