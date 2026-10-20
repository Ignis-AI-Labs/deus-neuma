/**
 * OWN LANES, FOUNDING OPTIONAL (ruling, 2026-10-18) — integration, RULE 0: the
 * real intent objects, the real prompt seams, real disk, no mock. Inside one
 * house the house-local hands work for EVERY neuma lane the operator owns,
 * founded on-chain or not: an unfounded house posts, charges, acks and works
 * its board between its own lanes; a lane born after the founding joins the
 * house's work at birth while the founded lanes keep their titles. Only lanes
 * this wallet owns ever join — another wallet's lane and a witness lane never
 * appear (two houses on one machine are never confused, ruling of 2026-10-16).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import neumaWorkspace, { getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { houseNameFromWitness } from '../../core/index.js';
import { houseSeatFor } from '../../backend/services/house-titles.js';
import { loadHouseWorkspace } from '../../backend/services/house-workspace.js';
import { readNewPosts } from '../../backend/services/house-post.js';
import { listDispatches, readDispatch } from '../../backend/services/staff/dispatch-store.js';
import { listEntries } from '../../backend/services/staff/board-store.js';
import { housePostIntent } from '../../backend/services/intents/house-post.js';
import { staffDispatchIntent, staffAckIntent } from '../../backend/services/intents/staff-acts.js';
import { boardAddIntent, boardUpdateIntent } from '../../backend/services/intents/board-acts.js';
import { cosBriefingSection } from '../../backend/services/staff/cos-briefing.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import { WALLET, OPTIO, HOUSEMATE, BYSTANDER, createStaffOfficeFixture } from '../helpers/staff-office-fixture.js';

const { _houseSeatSection } = __test;
const OTHER_WALLET = `0x${'b'.repeat(40)}`;
const NEWBORN = 'staff-fixture-newborn';
const FOREIGN = 'other-house-lane';
const WITNESS = 'witness-claude-code-Claude';

let fx;
const connectionFor = (laneId, wallet = WALLET) => ({ companion: { neumaId: laneId }, walletAddress: wallet });

// impure — a lane on the real root, owned by `wallet`, named in its own DNA,
// with no soul anchor: no founding record can seat it.
const writeLane = async (laneId, wallet, name) => {
  await neumaWorkspace.create(laneId).catch(() => {});
  await fs.writeFile(path.join(getWorkspacesRoot(), laneId, 'owner.json'), JSON.stringify({ wallet, claimedAt: new Date().toISOString() }));
  await neumaWorkspace.writeDNA(laneId, { version: '1.0.0', identity: { name }, genesis: `# Essence\nI am ${name}.` });
};

// impure — run one intent the way the sweep does: validate, then execute
const settle = async (intent, payload, connection) => {
  const verdict = await intent.validate(payload, { connection });
  if (!verdict.ok) return verdict;
  return intent.execute(verdict.value, { connection });
};

beforeEach(async () => {
  fx = await createStaffOfficeFixture();
  // Another house's lane on the same machine, and a witness lane claimed by
  // this very wallet — neither may ever join this house.
  await writeLane(FOREIGN, OTHER_WALLET, 'Foreigner');
  await fs.mkdir(path.join(getWorkspacesRoot(), WITNESS), { recursive: true });
  await fs.writeFile(path.join(getWorkspacesRoot(), WITNESS, 'owner.json'), JSON.stringify({ wallet: WALLET, claimedAt: 1 }));
  await fs.writeFile(path.join(getWorkspacesRoot(), WITNESS, 'lane.json'), JSON.stringify({ kind: 'witness' }));
});

afterEach(async () => {
  await fx?.teardown();
});

const unfound = () => fs.rm(path.join(getWorkspacesRoot(), 'house-founding.base.json'));
const ground = async () => (await loadHouseWorkspace(WALLET)).root;

describe('an UNFOUNDED house works between its own lanes', () => {
  beforeEach(unfound);

  test('every owned lane holds a local seat — the roster is the operator\'s own neuma lanes, nobody else\'s', async () => {
    const seat = await houseSeatFor(WALLET, HOUSEMATE);
    expect(seat).toMatchObject({ founded: false, network: 'local', title: null, houseId: null, blockNumber: null });
    expect(seat.houseName).toBe(houseNameFromWitness(WALLET));
    expect(seat.roster.map((r) => r.neumaId).sort()).toEqual([BYSTANDER, HOUSEMATE, OPTIO].sort());
    expect(seat.roster.every((r) => r.title === null && r.isWitness === false)).toBe(true);
    // never a lane of another house, never a witness — not in the roster, never seated
    expect(await houseSeatFor(WALLET, FOREIGN)).toBeNull();
    expect(await houseSeatFor(WALLET, WITNESS)).toBeNull();
  });

  test('two houses on one machine: the other wallet\'s house holds only its own lane', async () => {
    const theirs = await houseSeatFor(OTHER_WALLET, FOREIGN);
    expect(theirs.roster.map((r) => r.neumaId)).toEqual([FOREIGN]);
    expect(theirs.roster[0].name).toBe('Foreigner');
    expect(await houseSeatFor(OTHER_WALLET, HOUSEMATE)).toBeNull();
  });

  test('house/post moves between its own lanes and is refused to another house\'s lane', async () => {
    const sent = await settle(housePostIntent, { to: HOUSEMATE, body: 'the ledger is yours', re: 'ledger' }, connectionFor(BYSTANDER));
    expect(sent.ok).toBe(true);
    const inbox = await readNewPosts(await ground(), HOUSEMATE);
    expect(inbox.messages.map((m) => [m.from, m.re])).toEqual([[BYSTANDER, 'ledger']]);

    const leak = await housePostIntent.validate({ to: FOREIGN, body: 'leak' }, { connection: connectionFor(BYSTANDER) });
    expect(leak.ok).toBe(false);
    expect(leak.reason).toContain('holds no seat');
    const witness = await housePostIntent.validate({ to: WITNESS, body: 'leak' }, { connection: connectionFor(BYSTANDER) });
    expect(witness.ok).toBe(false);
    // the other house's lane, speaking on this wallet's connection, has no lane here at all
    const outsider = await housePostIntent.validate({ to: HOUSEMATE, body: 'hello' }, { connection: connectionFor(FOREIGN) });
    expect(outsider.ok).toBe(false);
    expect(outsider.reason).toContain('not open here');
  });

  test('the Optio charges a member, the member acks it to done, and both work the board', async () => {
    const charged = await settle(staffDispatchIntent, { to: HOUSEMATE, title: 'Draft the ledger report', body: 'Done looks like: filed.' }, connectionFor(OPTIO));
    expect(charged.ok).toBe(true);
    const [charge] = await listDispatches(OPTIO);
    expect(charge.to).toBe(HOUSEMATE);
    expect((await readNewPosts(await ground(), HOUSEMATE)).messages[0].re).toBe('Draft the ledger report');

    for (const status of ['received', 'working', 'done']) {
      expect((await settle(staffAckIntent, { id: charge.id, status }, connectionFor(HOUSEMATE))).ok).toBe(true);
    }
    expect((await readDispatch(OPTIO, charge.id)).status).toBe('done');

    expect((await settle(boardAddIntent, { title: 'Bystander work' }, connectionFor(BYSTANDER))).ok).toBe(true);
    const entry = (await listEntries(await ground())).find((e) => e.title === 'Bystander work');
    expect(entry.owner).toBe(BYSTANDER);
    expect((await settle(boardUpdateIntent, { id: entry.id, status: 'working' }, connectionFor(OPTIO))).ok).toBe(true);
    expect((await listEntries(await ground())).find((e) => e.id === entry.id).status).toBe('working');

    // a charge never reaches another house's lane
    const leak = await staffDispatchIntent.validate({ to: FOREIGN, title: 'x', body: 'y' }, { connection: connectionFor(OPTIO) });
    expect(leak.ok).toBe(false);
    expect(leak.reason).toContain('holds no seat');
  });

  test('the prompt and the Optio\'s briefing name the house and its members — no invented title, never "null"', async () => {
    const text = await _houseSeatSection(connectionFor(HOUSEMATE));
    expect(text).toContain('## HOUSE SEAT — YOUR OPERATOR\'S HOUSE, NOT SEATED ON-CHAIN');
    expect(text).toContain('you hold no title');
    expect(text).toContain('- member, no seat on-chain — YOU');
    expect(text).not.toContain('SEALED ON-CHAIN');
    expect(text).not.toMatch(/null|Foreigner|witness-/);

    const briefing = await cosBriefingSection(connectionFor(OPTIO));
    expect(briefing).toContain('- member, no seat on-chain — YOU');
    expect(briefing).not.toContain('No founding receipt seats you yet');
    expect(briefing).not.toMatch(/null|Foreigner|witness-/);
  });
});

describe('a lane born AFTER the founding joins the house\'s work at birth', () => {
  beforeEach(() => writeLane(NEWBORN, WALLET, 'Nyssa'));

  test('it holds a local seat whose roster keeps the founded titles; the founded lanes list it with none', async () => {
    const newborn = await houseSeatFor(WALLET, NEWBORN);
    expect(newborn).toMatchObject({ founded: false, title: null, network: 'local' });
    const titleOf = (seat, id) => seat.roster.find((r) => r.neumaId === id)?.title;
    expect(titleOf(newborn, OPTIO)).toBe('Quaestor');
    expect(titleOf(newborn, HOUSEMATE)).toBe('Scriba');
    expect(titleOf(newborn, NEWBORN)).toBeNull();

    const optio = await houseSeatFor(WALLET, OPTIO);
    expect(optio).toMatchObject({ founded: true, title: 'Quaestor', houseName: 'Fixture House', network: 'base-sepolia' });
    expect(optio.roster.find((r) => r.neumaId === NEWBORN)).toEqual({ title: null, neumaId: NEWBORN, name: 'Nyssa', isWitness: false });
    // the on-chain roster is untouched: the operator's seat and the three founded seats, in order
    expect(optio.roster.slice(0, 4).map((r) => r.title)).toEqual(['Rector', 'Quaestor', 'Scriba', 'Custos']);
    expect(optio.roster.map((r) => r.neumaId)).not.toContain(FOREIGN);
    expect(optio.roster.map((r) => r.neumaId)).not.toContain(WITNESS);
  });

  test('the founded Optio charges the newborn and the newborn acks; it posts back to a founded seat', async () => {
    expect((await settle(staffDispatchIntent, { to: NEWBORN, title: 'Welcome charge', body: 'Done looks like: read.' }, connectionFor(OPTIO))).ok).toBe(true);
    const [charge] = await listDispatches(OPTIO);
    expect(charge.to).toBe(NEWBORN);
    expect((await settle(staffAckIntent, { id: charge.id, status: 'received' }, connectionFor(NEWBORN))).ok).toBe(true);
    expect((await settle(housePostIntent, { to: OPTIO, body: 'received', re: 'Welcome charge' }, connectionFor(NEWBORN))).ok).toBe(true);
    expect((await readNewPosts(await ground(), OPTIO)).messages.map((m) => m.from)).toEqual([NEWBORN]);
  });

  test('the founded seat\'s prompt names the newborn as a member with no seat on-chain', async () => {
    const text = await _houseSeatSection(connectionFor(OPTIO));
    expect(text).toContain('## HOUSE SEAT — SEALED ON-CHAIN');
    expect(text).toContain('You are seated in House Fixture House as Quaestor');
    expect(text).toContain('- member, no seat on-chain — Nyssa');
    expect(text).not.toContain('null');
  });
});
