/**
 * PUBLISHING IN HOUSE WORK IS THE OPERATOR'S, NEVER THE REVIEW'S (audit
 * P6-105; RULE 0: a real wake turn on a synthetic connection, the real tool
 * loop, intent sweep, approval broker and filesystem on real disk, and a
 * loopback OpenAI-wire server standing in as the house's model — the same
 * house the Optio suites stand up).
 *
 * The Optio's review is a model, and its one-line CLEAR used to be all that
 * stood between a woken member and a publishing act. Under proof:
 *  - a woken member's publish is refused and filed for the operator with no
 *    review call at all, though the model would have answered CLEAR;
 *  - nothing is published;
 *  - the operator's own charter `allow` is what lets it run.
 */
import fs from 'fs/promises';
import path from 'path';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createWakeHouse, call, WALLET, HOUSEMATE } from '../helpers/house-wake-kit.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { readAsks } from '../../backend/services/house-clock/wake-ledger.js';
import { REVIEW_PROMPT } from '../../backend/services/house-clock/optio-review.js';
import { addAllowedTool } from '../../backend/services/tool-policy.js';
import { cfoDesignation } from '../../backend/services/treasury/cfo-designation.js';

const reviews = (provider) => provider.turns.filter((turn) => turn.messages?.[0]?.content === REVIEW_PROMPT);

describe('a publishing act in a house wake', () => {
  let house, commons, prevCommons, intent;
  beforeEach(async () => {
    house = await createWakeHouse();
    commons = path.join(house.office.root, 'commons');
    prevCommons = process.env.NEUMA_COLLECTIVE_VAULT;
    process.env.NEUMA_COLLECTIVE_VAULT = commons;
    await neumaWorkspace.writeVaultNote(HOUSEMATE, 'digest-notes', { title: 'Digest notes', body: 'What the house learned this week.' });
    intent = path.join(neumaWorkspace.pathFor(HOUSEMATE), 'intents', 'share.json');
  });
  afterEach(async () => {
    if (prevCommons === undefined) delete process.env.NEUMA_COLLECTIVE_VAULT;
    else process.env.NEUMA_COLLECTIVE_VAULT = prevCommons;
    await house.teardown();
  });

  const publish = () => ({ reply: `I will share my digest notes. ${call('fs/write', { path: intent, content: JSON.stringify({ type: 'vault/publish', name: 'digest-notes' }) })}` });
  const result = async () => JSON.parse(await fs.readFile(intent.replace(/\.json$/, '.result.json'), 'utf8'));
  const published = () => fs.readdir(commons).then((names) => names.length > 0, () => false);

  test('goes straight to the operator: no review is asked, nothing is published, an ask is filed', async () => {
    // Had a review been asked, this model would have cleared it.
    await house.serve([publish(), { reply: 'CLEAR' }, { reply: 'It waits on my operator.' }]);
    await house.charter();
    await house.post(HOUSEMATE, 'Share what you learned.');
    const [row] = await house.ledgerRows(1);

    expect(reviews(house.provider)).toEqual([]);
    expect(row.escalations.map((e) => [e.tool, e.why])).toEqual([['intents/vault.publish', expect.stringMatching(/publishing goes to the operator/)]]);
    expect((await result()).status).toBe('denied');
    expect(await published()).toBe(false);
    expect(await readAsks(WALLET)).toEqual([expect.objectContaining({ tool: 'intents/vault.publish', seat: HOUSEMATE, status: 'open' })]);
  }, 60000);

  test('runs when the operator\'s charter allows it, still with no review', async () => {
    await house.serve([publish(), { reply: 'The notes are shared.' }]);
    await house.charter({ allow: ['intents/vault.publish'] });
    await house.post(HOUSEMATE, 'Share what you learned.');
    const [row] = await house.ledgerRows(1);

    expect(row.escalations).toEqual([]);
    expect(reviews(house.provider)).toEqual([]);
    expect((await result()).status).toBe('done');
    expect(await published()).toBe(true);
  }, 60000);

  test('an ALWAYS grant given in a chat does not run it in a wake: it is still the operator\'s', async () => {
    await neumaWorkspace.writeToolPolicy(HOUSEMATE, addAllowedTool(null, 'intents', 'vault.publish'));
    await house.serve([publish(), { reply: 'CLEAR' }, { reply: 'It waits on my operator.' }]);
    await house.charter();
    await house.post(HOUSEMATE, 'Share what you learned.');
    const [row] = await house.ledgerRows(1);

    expect(row.escalations.map((e) => [e.tool, e.why])).toEqual([['intents/vault.publish', expect.stringMatching(/publishing goes to the operator/)]]);
    expect((await result()).status).toBe('denied');
    expect(await published()).toBe(false);
    expect(reviews(house.provider)).toEqual([]);
    expect(await readAsks(WALLET)).toEqual([expect.objectContaining({ tool: 'intents/vault.publish', seat: HOUSEMATE, status: 'open' })]);
  }, 60000);

  describe('an act whose own row asks nobody (the Quaestor marking an invoice paid)', () => {
    const paid = () => ({ reply: `I will mark it paid. ${call('fs/write', { path: intent, content: JSON.stringify({ type: 'treasury/invoice-paid', invoice: 'INV-0001', receipt: 'no-such-receipt' }) })}` });
    beforeEach(() => cfoDesignation.designate(WALLET, HOUSEMATE));

    test('reaches the wake\'s table and goes to the operator', async () => {
      await house.serve([paid(), { reply: 'CLEAR' }, { reply: 'It waits on my operator.' }]);
      await house.charter();
      await house.post(HOUSEMATE, 'Close the books on the invoice.');
      const [row] = await house.ledgerRows(1);

      expect(row.escalations.map((e) => [e.tool, e.why])).toEqual([['intents/treasury.invoice-paid', expect.stringMatching(/an invoice go to the operator/)]]);
      expect((await result()).status).toBe('denied');
      expect(reviews(house.provider)).toEqual([]);
      expect(await readAsks(WALLET)).toEqual([expect.objectContaining({ tool: 'intents/treasury.invoice-paid', seat: HOUSEMATE, status: 'open' })]);
    }, 60000);

    test('is taken up when the operator\'s charter allows it (the act itself then answers: no such invoice)', async () => {
      await house.serve([paid(), { reply: 'There is no such invoice.' }]);
      await house.charter({ allow: ['intents/treasury.invoice-paid'] });
      await house.post(HOUSEMATE, 'Close the books on the invoice.');
      const [row] = await house.ledgerRows(1);

      expect(row.escalations).toEqual([]);
      expect((await result()).status).not.toBe('denied');
      expect(await readAsks(WALLET)).toEqual([]);
    }, 60000);
  });
});
