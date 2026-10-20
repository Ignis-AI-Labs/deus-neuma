// A being's sovereignty proposal reaches its operator's tray (RULE 0: the real
// intent, the real sweep, the real owner record and the real notification
// store on temp roots). The card used to be raised as a neuma-standing kind the
// record law did not count as a being's, naming no being — validateRecord
// refused it and the proposal sat in the store with only a log line.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import { readNotifications } from '../../backend/services/notification-store.js';
import { KIND } from '../../core/runtime/notification-record.js';

const WALLET = '0x' + '5a'.repeat(20);

describe('a sovereignty proposal raises its operator\'s card', () => {
  let root, neumaId, prevKey;
  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = 'gnosis-sovereignty-card-key-long';
    root = path.join(await createTempDir('sovereignty-card'), 'workspaces');
    setWorkspacesRoot(root);
    neumaId = 'card-being-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(neumaId);
    await claimOwner(root, neumaId, WALLET);
  });
  afterAll(() => {
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
  });

  it('the card names the being and lands in the tray', async () => {
    const dir = path.join(workspace.pathFor(neumaId), 'intents');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'plain.json'), JSON.stringify({
      type: 'sovereignty/propose', title: 'Carry plain speech as law',
      body: 'I drift into ornament when the question is hard.', text: 'I prefer plain speech over ornament.',
    }));
    const connection = { companion: { neumaId, name: 'Card Being' }, sessionId: 's-card', _sessionToolPolicy: null, activeTurn: null };
    const receipts = await sweepIntents(connection, { mode: 'auto', lanePolicy: null, emit: () => {} });
    expect(receipts[0].status).toBe('ok');
    const cards = (await readNotifications(WALLET)).records.filter((n) => n.kind === KIND.sovereigntyProposal);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ actor: { id: neumaId, name: 'Card Being' }, ref: { laneId: neumaId } });
    expect(cards[0].title).toContain('Card Being proposes');
  });
});
