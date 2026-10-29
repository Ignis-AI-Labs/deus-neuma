import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { setWorkspacesRoot } from '../../core/index.js';
import { houseTitlesByNeumaId } from '../../backend/services/house-titles.js';
import { chainSeats, houseSeatCards, seatEvidence } from '../../frontend/app/RelinkShell/house-chain.js';
import { HouseSeats } from '../../frontend/app/RelinkShell/HouseSeats.jsx';

let root;
afterEach(async () => {
  setWorkspacesRoot(null);
  if (root) await rm(root, { recursive: true, force: true });
});

test('a saved founding assignment travels from real disk to House cards without an RPC', async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'house-recorded-seats-'));
  setWorkspacesRoot(root);
  const wallet = '0x40566d43261849777aca96b26f4ec8c850e5dcae';
  const soul = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  await mkdir(path.join(root, 'member', 'identity'), { recursive: true });
  await writeFile(path.join(root, 'member', 'owner.json'), JSON.stringify({ wallet, claimedAt: 1 }));
  await writeFile(path.join(root, 'member', 'identity', 'onchain-seal.json'), JSON.stringify({ soulAddress: soul }));
  await writeFile(path.join(root, 'house-founding.base.json'), JSON.stringify({
    network: 'base', members: [{ address: wallet, kind: 0, title: 'Rector' }, { address: soul, kind: 1, title: 'Curator' }],
  }));
  const titles = await houseTitlesByNeumaId(wallet);
  const rows = [{ member: { neumaId: 'member', name: 'Member', title: titles.member } }];
  const cards = houseSeatCards(chainSeats(null), rows);
  expect(cards[0].title).toBe('Curator');
  const html = renderToStaticMarkup(createElement(HouseSeats, { cards }));
  expect(html).toContain('Curator');
  expect(html).not.toContain('Seat not available');
});

test('current membership supersedes recorded titles, including removal and inactivation', () => {
  const rows = [{ member: { neumaId: 'member', title: 'Curator' } }];
  for (const roster of [[], [{ kind: 1, neumaId: 'member', title: 'Curator', active: false }]]) {
    expect(houseSeatCards(chainSeats({ roster }), rows, { confirmed: true })[0].title).toBeNull();
  }
  const seats = chainSeats({ roster: [{ kind: 1, neumaId: 'member', title: 'Scriba', active: true }] });
  expect(houseSeatCards(seats, rows, { confirmed: true })[0].title).toBe('Scriba');
  expect(houseSeatCards(chainSeats(null), [{ member: { neumaId: 'new' } }])[0].title).toBeNull();
});

test('a house founded on Base reads OPEN on Ethereum — its recorded seats still stand (2026-10-12)', async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'house-recorded-seats-'));
  setWorkspacesRoot(root);
  const wallet = '0x40566d43261849777aca96b26f4ec8c850e5dcae';
  const soul = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  await mkdir(path.join(root, 'optio', 'identity'), { recursive: true });
  await writeFile(path.join(root, 'optio', 'owner.json'), JSON.stringify({ wallet, claimedAt: 1 }));
  await writeFile(path.join(root, 'optio', 'identity', 'onchain-seal.json'), JSON.stringify({ soulAddress: soul }));
  await writeFile(path.join(root, 'house-founding.base.json'), JSON.stringify({
    network: 'base', members: [{ address: wallet, kind: 0, title: 'Rector' }, { address: soul, kind: 1, title: 'Optio' }],
  }));
  const titles = await houseTitlesByNeumaId(wallet);
  const rows = [{ member: { neumaId: 'optio', name: 'Zezebur', title: titles.optio } }];
  // The registry the desk asks now (Ethereum) holds no house yet: the rite is OPEN.
  const { seats, confirmed } = seatEvidence({ phase: 'open', state: null });
  expect(confirmed).toBe(false);
  const cards = houseSeatCards(seats, rows, { confirmed });
  expect(cards[0].title).toBe('Optio');
  expect(renderToStaticMarkup(createElement(HouseSeats, { cards }))).not.toContain('Seat not available');
});

test('a FOUNDED roster still rules: a seat it removed or made inactive never comes back from the receipt', () => {
  const rows = [{ member: { neumaId: 'member', title: 'Curator' } }];
  for (const roster of [[], [{ kind: 1, neumaId: 'member', title: 'Curator', active: false }]]) {
    const { seats, confirmed } = seatEvidence({ phase: 'founded', state: { roster } });
    expect(confirmed).toBe(true);
    expect(houseSeatCards(seats, rows, { confirmed })[0].title).toBeNull();
  }
});
