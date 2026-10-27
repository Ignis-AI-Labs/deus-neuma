// The MARKETING board's slice-4 ground, laid over the kit's house
// (marketing-office-kit.js) by the browser proof of the new panels only — the
// kit's own house stays as every other suite measures it. All through the
// real stores and the real sweep (RULE 0); placeholder keys; drafts only,
// never `approved`; no scheduler runs.
//
//   history     two older readings of the kit's X post and its Bluesky post,
//               so a PLATFORM trace has days to draw (results store)
//   telegram    an account under Brookmere — a platform that reports no post
//               numbers — with a sent post whose tracked link the site
//               counter stand-in counted on two days, read by the REAL sweep
//   week        drafts staged across the next 7 days on X and Bluesky
//   repo        a REAL git repository listed on Northwind's kit (dated
//               commits, a changelog fragment, release notes), the house's
//               CMO seated (Kestrel) and granted its read; a second repo
//               listed and not granted
//   office      a locked weekly plan, a granted mandate, one image act in its
//               journal, an open ask from the CMO on the kit's campaign
//
// impure — tmp disk, git, the kit's stand-ins.
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect } from 'vitest';
import { addAccount } from '../../backend/services/social/account-store.js';
import { listCompanies, setCompanyRepos } from '../../backend/services/marketing/companies.js';
import { changeResults } from '../../backend/services/marketing/results-store.js';
import { appendLinks } from '../../backend/services/marketing/link-store.js';
import { sweepHouse } from '../../backend/services/social/stats/stats-sweep.js';
import { postQueue } from '../../backend/services/social/post-queue.js';
import { cmoDesignation } from '../../backend/services/marketing/cmo-designation.js';
import { grantRepoRead } from '../../backend/services/marketing/company-repo-grants.js';
import { weeklyPlanStoreFor } from '../../backend/services/marketing/weekly-plan.js';
import { campaignStoreFor } from '../../backend/services/marketing/campaign-store.js';
import { grantMandate } from '../../backend/services/marketing/mandate/mandate-lifecycle.js';
import { readMandate, journalMandate } from '../../backend/services/marketing/mandate/mandate-store.js';

const run = promisify(execFile);
const D = 864e5;
const iso = (offset) => new Date(Date.now() + offset).toISOString();
const day = (offset) => new Date(Date.now() + offset * D).toISOString().slice(0, 10);

// impure — commit `files` in `dir` at `when`; returns the sha.
const commitAt = async (dir, when, subject, files) => {
  for (const [rel, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await fs.writeFile(path.join(dir, rel), content);
  }
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid', GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when };
  await run('git', ['add', '-A'], { cwd: dir, env });
  await run('git', ['commit', '-q', '-m', subject], { cwd: dir, env });
  return (await run('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim();
};

// impure — older readings beneath the sweep's own, oldest first.
const seedHistory = (house) => changeResults(house, (r) => {
  const like = (entryId) => r.results.find((x) => x.entryId === entryId);
  const older = (entryId, offset, metrics) => ({ ...like(entryId), at: iso(offset), metrics });
  return {
    ...r,
    results: [
      older('p1', -3 * D, { views: 900, likes: 12, replies: 1, shares: 2, quotes: 0, saves: 1 }),
      older('p1', -1 * D, { views: 2600, likes: 40, replies: 3, shares: 6, quotes: 1, saves: 2 }),
      older('p2', -1 * D, { likes: 3, shares: 1, replies: 0, quotes: 0 }),
      ...r.results,
    ],
  };
});

// impure — Brookmere's Telegram: a sent post, its tracked link, two days of counted clicks, read by the real sweep.
const seedTelegram = async (ctx) => {
  const house = ctx.auth.address;
  const ids = (await listCompanies(house)).map((c) => c.id);
  expect((await addAccount(house, 'telegram', { companyId: 'brookmere' }, ids)).ok).toBe(true);
  const queue = JSON.parse(await fs.readFile(process.env.NEUMA_SOCIAL_POST_QUEUE_PATH, 'utf8'));
  queue.push({
    id: 't1', channelId: 'telegram', accountId: 'telegram-1', text: 't1: the channel heard it first.', scheduledFor: null, media: [], authorNeumaId: null,
    queuedBy: house, status: 'sent', createdAt: iso(-2 * D), decidedBy: house, sentAt: iso(-2 * D + 36e5), postId: '42',
  });
  await fs.writeFile(process.env.NEUMA_SOCIAL_POST_QUEUE_PATH, `${JSON.stringify(queue, null, 2)}\n`);
  await appendLinks(house, [{ code: 'tg9k2m', destination: 'https://brookmere.example/', entryId: 't1', accountId: 'telegram-1', companyId: 'brookmere', createdAt: iso(-2 * D) }]);
  ctx.counter.codes.set('tg9k2m', { code: 'tg9k2m', destination: 'https://brookmere.example/', company: 'brookmere' });
  ctx.counter.count('click', 'tg9k2m', day(-1), 3);
  ctx.counter.count('click', 'tg9k2m', day(0), 5);
  // The counter was read at the kit's start; the sweep reads it again once its record is cleared.
  await changeResults(house, (r) => ({ ...r, links: null }));
  await sweepHouse(house);
};

// impure — drafts across the coming week (the kit already stages one in two days on X).
const seedWeek = async (ctx) => {
  const house = ctx.auth.address;
  ctx.week = [];
  for (const [channelId, accountId, offset, text] of [['x', 'x-1', 0.2 * D, 'Tonight: the numbers, plainly.'], ['bluesky', 'bluesky-1', 3.4 * D, 'Sunday: the long read.'],
    ['x', 'x-2', 5.5 * D, 'Labs: what the build changed.']]) {
    ctx.week.push((await postQueue.add({ channelId, accountId, text, queuedBy: house, scheduledFor: iso(offset) })).id);
  }
};

// impure — Northwind's repos (one granted to the seated CMO), the plan, the mandate and its act, an ask.
const seedOffice = async (ctx) => {
  const house = ctx.auth.address;
  await cmoDesignation.designate(house, 'kestrel');
  const app = path.join(ctx.tmp, 'repos', 'northwind-app');
  const site = path.join(ctx.tmp, 'repos', 'northwind-site');
  for (const dir of [app, site]) { await fs.mkdir(dir, { recursive: true }); await run('git', ['init', '-q', dir]); }
  const at = (days) => new Date(Date.now() - days * D).toISOString().replace(/\.\d+Z$/, 'Z');
  ctx.repo = {
    path: app,
    fix: await commitAt(app, at(4), 'fix(seal): the seal no longer stalls', { 'changelog.d/seal.md': 'Fixed\n- The seal no longer stalls on a slow disk.\n' }),
    add: await commitAt(app, at(2), 'feat(download): a Linux download page', { 'changelog.d/download.md': 'Added\n- A download page for Linux, with its checksum.\n' }),
    release: await commitAt(app, at(1), 'docs: release notes 0.3.0', { 'docs/operations/release-notes-0.3.0.md': '# 0.3.0\n' }),
  };
  await commitAt(site, at(1), 'feat: the new landing page', { 'index.html': '<h1>Northwind</h1>\n' });
  expect((await setCompanyRepos(house, 'northwind', [{ path: app, remote: 'https://github.com/northwind/app', role: 'the app' }, { path: site, role: 'the website' }])).ok).toBe(true);
  expect((await grantRepoRead(house, 'northwind', app)).ok).toBe(true);
  await (await weeklyPlanStoreFor(house)).approve([
    { day: 'monday', theme: 'proof', objective: 'show the harness, not the model', posts: 2 },
    { day: 'thursday', theme: 'speed', objective: 'the clip', posts: 1 },
  ]);
  expect((await grantMandate(house, { accounts: [{ id: 'x-1', pace: 2 }], timeZone: 'UTC' })).ok).toBe(true);
  await journalMandate(house, { mandateId: (await readMandate(house)).id, kind: 'act', act: 'image', text: 'the launch card' });
  await (await campaignStoreFor(house)).ask(ctx.campaign.id, { from: 'cmo', text: 'May the clip run on Thursday?', by: 'kestrel' });
};

/** impure — the whole slice-4 ground over the kit's house. */
export const seedKinds = async (ctx) => {
  await seedHistory(ctx.auth.address);
  await seedTelegram(ctx);
  await seedWeek(ctx);
  await seedOffice(ctx);
};
