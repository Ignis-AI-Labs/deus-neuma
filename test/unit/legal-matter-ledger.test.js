// The CLO office's record and its heartbeat, on real temp disk (RULE 0): the
// matters ledger (dedup, the cited-verdict law, history, review dates, the
// opinions drawer), the standing watch run end to end over a real git repo
// through the real watch store, the 24-hour due logic, and the briefing.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { initRepo, commitFiles } from '../helpers/legal-repo-fixture.js';
import { createMatterLedger, mattersDueForReview, matterCounts, validateVerdict } from '../../backend/services/legal/matter-ledger.js';
import { journalOpinion } from '../../backend/services/legal/opinion-journal.js';
import { runLegalWatch, legalTick } from '../../backend/services/legal/legal-scheduler.js';
import { legalBriefingText } from '../../backend/services/legal/legal-briefing.js';
import { createWatchStore } from '../../backend/services/security/watch-store.js';
import { standTwoHouses, HOUSE_A } from '../helpers/house-office-kit.js';

const MATTER = {
  area: 'license', source: 'license-scan', repo: 'neuma',
  externalId: 'license:fixture', title: 'fixture@1.0.0 ships under GPL-3.0-only (strong-copyleft)',
  severity: 'high', summary: 'fixture', affected: ['fixture@1.0.0'],
};
const CITED = {
  status: 'concern',
  assessment: 'GPL-3.0 §5 reaches the combined work we distribute.',
  citations: ['https://www.gnu.org/licenses/gpl-3.0.html#section5'],
  reviewBy: '2027-01-01',
};

let root;
let houses;
// The watch's alert reads the house's seat and its state moves home from the
// machine path — the realm and every legacy office path are tmp, never the
// operator's real ones.
beforeAll(async () => {
  houses = await standTwoHouses({ label: 'legal-ledger' });
  root = houses.tmp;
});
afterAll(async () => {
  houses.restore();
  await fs.rm(root, { recursive: true, force: true });
});

describe('the matters ledger', () => {
  it('ingests once, refreshes on re-sight, and refuses a malformed matter whole', async () => {
    const ledger = createMatterLedger({ path: path.join(root, 'dedup.json') });
    const first = await ledger.ingest([MATTER]);
    expect(first.added).toHaveLength(1);
    expect(first.added[0]).toMatchObject({ status: 'new', area: 'license', citations: [], history: [] });
    const again = await ledger.ingest([{ ...MATTER, affected: ['fixture@1.0.1'] }]);
    expect(again).toMatchObject({ added: [], seen: 1 });
    const [only] = await ledger.load();
    expect(only.affected).toEqual(['fixture@1.0.1']); // the newest evidence
    await expect(ledger.ingest([{ ...MATTER, area: 'vibes' }])).rejects.toThrow(/area must be/);
    await expect(ledger.ingest([MATTER, { ...MATTER, externalId: 'x', title: '' }])).rejects.toThrow(/title/);
    expect(await ledger.load()).toHaveLength(1);
  });

  it('a verdict cites what it rests on — except a hand-off to counsel or the operator', async () => {
    const ledger = createMatterLedger({ path: path.join(root, 'cite.json') });
    const { added: [m] } = await ledger.ingest([MATTER]);
    await expect(ledger.assess([m.id], { status: 'no_issue', assessment: 'fine' })).rejects.toThrow(/cite/);
    await expect(ledger.assess([m.id], { status: 'new', assessment: 'x', citations: ['y'] })).rejects.toThrow(/settling status/);
    await expect(ledger.assess([m.id], { ...CITED, reviewBy: 'next year' })).rejects.toThrow(/YYYY-MM-DD/);
    await expect(ledger.assess([m.id], { status: 'concern', assessment: '  ', citations: ['y'] })).rejects.toThrow(/reasoning/);

    const counsel = await ledger.assess([m.id.slice(0, 8)], { status: 'needs_counsel', assessment: 'Does the IPC boundary make it a separate work? A lawyer must say.' });
    expect(counsel.ok).toBe(true);
    const cited = await ledger.assess([m.id], { ...CITED, assessedBy: 'praetorlane' });
    expect(cited.settled[0]).toMatchObject({ status: 'concern', reviewBy: '2027-01-01', assessedBy: 'praetorlane', citations: CITED.citations });
    // superseded, never overwritten
    const stored = await ledger.get(m.id);
    expect(stored.history.map((h) => h.status)).toEqual(['needs_counsel', 'concern']);
    expect(stored.history[0].assessment).toMatch(/A lawyer must say/);
    // a re-scan never reopens a settled verdict
    await ledger.ingest([MATTER]);
    expect((await ledger.get(m.id)).status).toBe('concern');
  });

  it('a batch reports what failed beside what settled; review dates come due', async () => {
    const ledger = createMatterLedger({ path: path.join(root, 'batch.json') });
    const { added } = await ledger.ingest([MATTER, { ...MATTER, externalId: 'license:two', title: 'two' }]);
    const result = await ledger.assess([added[0].id, 'lm_nope', added[1].id], { ...CITED, reviewBy: '2026-01-01' });
    expect(result.ok).toBe(false);
    expect(result.settled).toHaveLength(2);
    expect(result.failed).toEqual([{ id: 'lm_nope', error: 'no such matter' }]);
    const entries = await ledger.load();
    expect(mattersDueForReview(entries, '2025-12-31')).toHaveLength(0);
    expect(mattersDueForReview(entries, '2026-01-01')).toHaveLength(2);
    expect(matterCounts(entries)).toEqual({ total: 2, byStatus: { concern: 2 }, byArea: { license: 2 } });
  });

  it('every verdict lands in the Praetor\'s opinions drawer — never creating a lane that is not there', async () => {
    const lane = 'praetorlane';
    await fs.mkdir(path.join(houses.rootA, lane), { recursive: true });
    const ledger = createMatterLedger({ path: path.join(root, 'journal.json'), journal: journalOpinion });
    const { added: [m] } = await ledger.ingest([MATTER]);
    await ledger.assess([m.id], { ...CITED, assessedBy: lane });
    const dir = path.join(houses.rootA, lane, 'legal', 'opinions');
    const [note] = await fs.readdir(dir);
    expect(note).toMatch(new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${m.id.slice(3, 11)}\\.md$`));
    const text = await fs.readFile(path.join(dir, note), 'utf8');
    expect(text).toContain('GPL-3.0 §5 reaches the combined work');
    expect(text).toContain('https://www.gnu.org/licenses/gpl-3.0.html#section5');
    expect(text).toContain('review by 2027-01-01');

    // a lane with no workspace: the verdict stands, nothing is created
    await ledger.assess([m.id], { ...CITED, assessedBy: 'ghostlane' });
    expect((await ledger.get(m.id)).assessedBy).toBe('ghostlane');
    await expect(fs.access(path.join(houses.rootA, 'ghostlane'))).rejects.toThrow();
  });
});

describe('the standing watch', () => {
  it('one run reads licences, papers and new work over a real watched repo, and the build window moves', async () => {
    const repo = await initRepo(path.join(root, 'watched'));
    await commitFiles(repo, 'feat: the app, with a wallet', {
      LICENSE: 'Copyright (c) 2026 Fixture LLC. All Rights Reserved.\n',
      'package.json': { name: 'watched', license: 'UNLICENSED', dependencies: { electron: '1.0.0' } },
      'package-lock.json': { lockfileVersion: 3, packages: { '': {}, 'node_modules/served': { version: '1.0.0', license: 'AGPL-3.0-only' } } },
      'src/wallet/send.js': 'x\n',
    });
    const watchStore = createWatchStore({ path: path.join(root, 'watch.json'), seedRepos: [repo] });
    const ledger = createMatterLedger({ path: path.join(root, 'watch-ledger.json') });
    const statePath = path.join(root, 'watch-state.json');

    const first = await runLegalWatch({ wallet: HOUSE_A, trigger: 'test', watchStore, ledger, statePath });
    expect(first.error).toBeNull();
    expect(first.repos[0]).toMatchObject({ repo: 'watched', shipped: 1, commits: 1, error: null });
    const ids = (await ledger.load()).map((m) => m.externalId);
    expect(ids).toContain('license:served');
    expect(ids).toContain('posture:no-terms');
    expect(ids).toContain('posture:no-privacy-policy');
    expect(ids.some((id) => id.startsWith('build:crypto@'))).toBe(true);
    const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
    expect(state.lastRunAt).toBe(first.startedAt);
    expect(state.repos.watched.buildSince).toBe(first.startedAt);

    // the next run reads only what is new: nothing added, the rest re-seen.
    // git keeps commit times to the SECOND and --since includes that whole
    // second, so the next run starts past the commit's second.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await fs.writeFile(statePath, JSON.stringify({ ...state, repos: { ...state.repos, watched: { ...state.repos.watched, buildSince: new Date().toISOString() } } }));
    const second = await runLegalWatch({ wallet: HOUSE_A, trigger: 'test', watchStore, ledger, statePath });
    expect(second.repos[0].commits).toBe(0);
    expect(second.added).toBe(0);
    expect(second.seen).toBeGreaterThan(0);
  }, 30000);

  it('the tick runs only when a day has passed; an unreadable state holds the watch', async () => {
    const statePath = path.join(root, 'tick-state.json');
    let runs = 0;
    const runFn = async () => { runs += 1; return 'ran'; };
    expect(await legalTick(HOUSE_A, Date.now(), runFn, statePath)).toBe('ran'); // never run → due
    await fs.writeFile(statePath, JSON.stringify({ lastRunAt: new Date().toISOString(), repos: {}, runs: [] }));
    expect(await legalTick(HOUSE_A, Date.now(), runFn, statePath)).toBeNull();
    expect(await legalTick(HOUSE_A, Date.now() + 25 * 3600 * 1000, runFn, statePath)).toBe('ran');
    await fs.writeFile(statePath, '{ corrupt');
    expect(await legalTick(HOUSE_A, Date.now() + 25 * 3600 * 1000, runFn, statePath)).toBeNull();
    expect(runs).toBe(2);
  });
});

describe('the briefing', () => {
  it('leads with the new, surfaces what is due, and says when the watch never ran', () => {
    const entries = [
      { id: 'lm_low00000', status: 'new', severity: 'low', area: 'license', repo: 'neuma', title: 'a low one' },
      { id: 'lm_crit0000', status: 'new', severity: 'critical', area: 'license', repo: 'neuma', title: 'a critical one' },
      { id: 'lm_due00000', status: 'no_issue', severity: 'medium', area: 'product', repo: 'neuma', title: 'read long ago', reviewBy: '2026-01-01' },
      { id: 'lm_cons0000', status: 'needs_counsel', severity: 'high', area: 'posture', repo: 'neuma', title: 'for a lawyer' },
    ];
    const text = legalBriefingText({ entries, watch: null, today: '2026-10-01' });
    expect(text).toMatch(/^## CLO office/);
    expect(text).toContain('NEVER run');
    expect(text.indexOf('a critical one')).toBeLessThan(text.indexOf('a low one'));
    expect(text).toMatch(/Due for review[\s\S]*read long ago/);
    expect(text).toContain('1 matter(s) wait on counsel');
    expect(text).toContain('not its counsel');
  });
});

describe('validateVerdict — a reading rests on law the office READ', () => {
  // The live Praetor flight (2026-10-20): web access was off, the seat cited from
  // memory, flagged each citation "NOT source-verified" — and settled anyway. Its
  // remembered quote was another state's wording, not Wyoming's.
  const unread = 'W.S. 17-29-401(a) — Wyoming LLC Act — https://wyoleg.gov/statutes/compress/title17.pdf — read from CLO knowledge, NOT source-verified (web access off 2026-10-20)';
  const read = 'W.S. 17-29-401(a) — read at https://wyoleg.gov/statutes/compress/title17.pdf, p. 678, 2026-10-20';

  test('a citation that says it was not read cannot carry a settled verdict', () => {
    for (const status of ['no_issue', 'concern', 'resolved']) {
      expect(validateVerdict({ status, assessment: 'x', citations: [read, unread] }), status).toMatch(/was not read/);
    }
    for (const c of ['unverified', 'from memory', 'could not fetch the source', 'not checked against the text']) {
      expect(validateVerdict({ status: 'no_issue', assessment: 'x', citations: [`17-29-401 — ${c}`] }), c).toMatch(/was not read/);
    }
  });

  test('the honest hand-off still lands, and a read source settles', () => {
    expect(validateVerdict({ status: 'needs_operator', assessment: 'x', citations: [unread] })).toBeNull();
    expect(validateVerdict({ status: 'needs_counsel', assessment: 'x', citations: [unread] })).toBeNull();
    expect(validateVerdict({ status: 'no_issue', assessment: 'x', citations: [read], reviewBy: '2027-01-01' })).toBeNull();
  });
});
