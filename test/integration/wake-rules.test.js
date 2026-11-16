/**
 * Wake rules a house member sets for itself (house-clock/wake-rules.js,
 * wake-rules-tick.js, intent house/wake) over REAL parts (RULE 0): the staff
 * office fixture (a real house: realm, ground, three lanes owned by its
 * wallet), the real charter store, the real wake queue and sink exactly as the
 * clock wires them, the real intent sweep, a real HTTP listener in Umbrae's
 * place for prices, and the member's real LP book file for its worth.
 */
import path from 'node:path';
import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import { createStaffOfficeFixture, WALLET, OPTIO, HOUSEMATE, BYSTANDER } from '../helpers/staff-office-fixture.js';
import { connectionsOn } from '../helpers/connections-kit.js';
import { viaIntent } from '../helpers/intent-path.js';
import { startUmbraeStandIn } from '../helpers/umbrae-stand-in.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { writeCharter, approveCharter } from '../../backend/services/house-clock/charter-store.js';
import { setWakeSink } from '../../backend/services/house-clock/wake-signal.js';
import { setWakeRunner, configureWakeQueue, readWakeQueue, whenHouseIdle } from '../../backend/services/house-clock/wake-queue.js';
import { takeSignal } from '../../backend/services/house-clock/house-clock.js';
import { wakeRulesTick } from '../../backend/services/house-clock/wake-rules-tick.js';
import { readWakeRules } from '../../backend/services/house-clock/wake-rules.js';
import { wakeThought } from '../../backend/services/house-clock/wake-thought.js';
import { makePost, appendPost } from '../../backend/services/house-post.js';

let office, umbrae, connections;
const member = (neumaId) => ({ companion: { neumaId, name: neumaId }, walletAddress: WALLET, sessionId: 's-1', toolMode: 'ask' });
const rule = (neumaId, add, extra = {}) => viaIntent(member(neumaId), 'house/wake', { add, ...extra });
const queued = async () => (await readWakeQueue(WALLET)).items.filter((i) => i.reason === 'rule');
const charter = async () => {
  const c = await writeCharter(WALLET, { goal: 'Earn for the house.', seats: [{ laneId: OPTIO, dailyCap: 10 }, { laneId: HOUSEMATE, dailyCap: 10 }] }, { by: WALLET, ownedLanes: [OPTIO, HOUSEMATE, BYSTANDER] });
  return approveCharter(WALLET, { version: c.version, by: WALLET });
};

beforeAll(async () => {
  umbrae = await startUmbraeStandIn({ provider: new ethers.JsonRpcProvider('http://127.0.0.1:9', ethers.Network.from(8453), { staticNetwork: true }) });
});
afterAll(async () => { await umbrae?.close(); });

beforeEach(async () => {
  office = await createStaffOfficeFixture();
  configureWakeQueue({ settleMs: 60_000 }); // queued wakes stay in view; nothing runs
  setWakeSink(takeSignal);
  setWakeRunner(null);
  umbrae.reset();
  connections = connectionsOn(['umbrae-liquidity']);
  await charter();
});
afterEach(async () => {
  connections?.restore();
  await whenHouseIdle(WALLET);
  setWakeSink(null);
  configureWakeQueue({ settleMs: 3000, retryMs: 60_000 });
  await office.teardown();
});

describe('a member sets what wakes it', () => {
  test('a daily moment: set through the real sweep, it fires in its minute, into the queue, with the member\'s own note in its wake', async () => {
    const [set] = await rule(HOUSEMATE, { kind: 'time', daily: '10:00' }, { label: 'morning book', note: 'read lp_book, then market_map' });
    expect(set.status).toBe('ok');
    expect(set.content).toMatch(/^Rule set: w-[0-9a-f]{6} "morning book" daily at 10:00 · note: read lp_book, then market_map\. You hold 1 rule\(s\)\. You may wake up to 10 times a day\./);
    const ten = new Date(); ten.setHours(10, 0, 30, 0);
    await wakeRulesTick(WALLET, ten.getTime() - 60_000); // the first look, a minute before
    expect(await queued()).toEqual([]);
    await wakeRulesTick(WALLET, ten.getTime());
    const [item] = await queued();
    expect(item).toMatchObject({ seat: HOUSEMATE, reason: 'rule', detail: { label: 'morning book', note: 'read lp_book, then market_map' } });
    await wakeRulesTick(WALLET, ten.getTime() + 60_000);
    expect(await queued()).toHaveLength(1); // once per day
    const note = wakeThought({ items: [item], charter: { goal: 'Earn for the house.', escalate: [] } });
    expect(note).toMatch(/Your own wake rule "morning book" fired \[w-[0-9a-f]{6}:daily-[\d-]+\]: your daily 10:00\. Your note to yourself: "read lp_book, then market_map"/);
  });

  test('a price crossing: fires when the token crosses into its level, not again while it stays there', async () => {
    await rule(HOUSEMATE, { kind: 'price', token: 'WETH', above: 3300 }, { note: 'take profit on half' });
    const t0 = Date.now();
    await wakeRulesTick(WALLET, t0); // WETH at $3,200 on the stand-in: below the level
    expect(await queued()).toEqual([]);
    umbrae.state.wethPrice = 3400;
    await wakeRulesTick(WALLET, t0 + 60_000); // too soon: event rules look every 5 minutes
    expect(await queued()).toEqual([]);
    await wakeRulesTick(WALLET, t0 + 6 * 60_000);
    expect((await queued())[0].detail.what).toBe('WETH is at $3,400, above $3,300');
    await wakeRulesTick(WALLET, t0 + 12 * 60_000);
    expect(await queued()).toHaveLength(1);
    expect((await readWakeRules(HOUSEMATE)).rules[0]).toMatchObject({ inside: true, lastValue: 3400 });
  });

  test('its LP wallet\'s worth, read from its own book', async () => {
    await neumaWorkspace._writeJSON(path.join(neumaWorkspace._path(HOUSEMATE), 'config', 'lp-book.json'), { days: { '2026-11-15': { valueUsd: 480, earnedUsd: -20 } } });
    await rule(HOUSEMATE, { kind: 'lp-value', below: 500 }, { label: 'drawdown' });
    await wakeRulesTick(WALLET, Date.now());
    expect((await queued())[0].detail).toMatchObject({ label: 'drawdown', what: 'your LP wallet is worth $480, below $500' });
  });

  test('who may wake it with a house post: anyone by default, only named housemates, or nobody', async () => {
    const post = (to, from) => appendPost(office.ground, makePost({ from, to, body: `from ${from}`, now: new Date().toISOString() }));
    const posts = async () => (await readWakeQueue(WALLET)).items.filter((i) => i.reason === 'post' && i.seat === HOUSEMATE).map((i) => i.detail.from);
    await post(HOUSEMATE, OPTIO);
    await new Promise((r) => setTimeout(r, 50));
    expect(await posts()).toEqual([OPTIO]);
    await rule(HOUSEMATE, { kind: 'posts', from: [BYSTANDER] });
    await post(HOUSEMATE, OPTIO);
    await post(HOUSEMATE, BYSTANDER);
    await new Promise((r) => setTimeout(r, 50));
    expect(await posts()).toEqual([OPTIO, BYSTANDER]); // the second Optio post did not wake it
    await rule(HOUSEMATE, { kind: 'posts', from: 'nobody' }); // replaces the last posts rule
    expect((await readWakeRules(HOUSEMATE)).rules.filter((r) => r.kind === 'posts')).toHaveLength(1);
  });

  test('list shows its rules and whether it can wake; a bad rule is refused as invalid; remove drops one; another house cannot reach them', async () => {
    const [bad] = await rule(HOUSEMATE, { kind: 'time', everyMinutes: 5 });
    expect(bad.status).toBe('error');
    expect(bad.error).toMatch(/everyMinutes is a whole number from 15/);
    await rule(BYSTANDER, { kind: 'time', everyMinutes: 60 }, { label: 'hourly' });
    const [list] = await viaIntent(member(BYSTANDER), 'house/wake', { list: true });
    expect(list.content).toMatch(/^YOUR WAKE RULES \(1 of 16\):\n- w-[0-9a-f]{6} "hourly" every 60 min\nYOU ARE NOT SEATED in the house charter/);
    const id = (await readWakeRules(BYSTANDER)).rules[0].id;
    expect((await viaIntent(member(BYSTANDER), 'house/wake', { remove: id }))[0].content).toMatch(new RegExp(`^Rule ${id} removed\\. You hold 0 rule`));
    const stranger = { ...member(HOUSEMATE), walletAddress: `0x${'b'.repeat(40)}` };
    expect((await viaIntent(stranger, 'house/wake', { list: true }))[0].status).not.toBe('ok');
  });
});
