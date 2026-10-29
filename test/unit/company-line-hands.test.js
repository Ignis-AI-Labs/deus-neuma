/**
 * HANDS — what only a person can do — as pure law, called with real inputs
 * (RULE 0: nothing to mock): an ask is whole or refused in words, its link is
 * https or nothing, what comes back is never a secret, and the record folds
 * to one answer per ask.
 */
import { describe, test, expect } from 'vitest';
import { makeHands, foldHands, judgeAnswer, ANSWERS, OPEN_MAX } from '../../backend/services/company-line/hands-shape.js';

const NOW = '2026-10-30T09:00:00.000Z';
const ask = (over = {}) => ({
  what: 'File the LLC in Wyoming', why: 'The company must exist before a bank account can be opened.',
  where: 'https://wyobiz.wyo.gov/', answer: 'fact', unblocks: 'form', cost: '$100 and ~20 minutes', by: '2026-11-15',
  raisedBy: 'prae', now: NOW, ...over,
});

describe('raising an ask', () => {
  test('a whole ask keeps every part, cleaned', () => {
    const item = makeHands(ask({ what: '  File   the LLC in Wyoming ' }));
    expect(item).toMatchObject({
      what: 'File the LLC in Wyoming', where: 'https://wyobiz.wyo.gov/', answer: 'fact', unblocks: 'form',
      cost: '$100 and ~20 minutes', by: '2026-11-15', raisedBy: 'prae', raisedAt: NOW,
    });
    expect(item.id).toMatch(/^h-[a-f0-9]{8}$/);
    expect(ANSWERS).toEqual(['done', 'fact', 'held']);
    expect(OPEN_MAX).toBe(20);
  });

  test('an ask without its parts, or with a link that is not https, is refused in words', () => {
    expect(() => makeHands(ask({ what: ' ' }))).toThrow(/needs \{what, why\}/);
    expect(() => makeHands(ask({ where: 'http://wyobiz.wyo.gov/' }))).toThrow(/https link/);
    expect(() => makeHands(ask({ where: 'javascript:alert(1)' }))).toThrow(/https link/);
    expect(() => makeHands(ask({ answer: 'password' }))).toThrow(/never a secret/);
    expect(() => makeHands(ask({ unblocks: 'bank' }))).toThrow(/stage of the line/);
    expect(() => makeHands(ask({ by: 'soon' }))).toThrow(/is a date/);
    expect(makeHands(ask({ unblocks: '', by: '', cost: '' }))).toMatchObject({ unblocks: null, by: null, cost: null });
  });
});

describe('answering an ask', () => {
  const fact = { ...makeHands(ask()), status: 'open' };
  const held = { ...makeHands(ask({ answer: 'held', what: 'Open the bank account' })), status: 'open' };
  const plain = { ...makeHands(ask({ answer: 'done', what: 'Sign the operating agreement' })), status: 'open' };

  test('what the house asked for must come back: the fact, or where a secret is kept', () => {
    expect(judgeAnswer(fact, { status: 'done', text: ' ', now: NOW })).toEqual({ ok: false, reason: 'type the fact the house asked for' });
    expect(judgeAnswer(held, { status: 'done', text: '', now: NOW })).toEqual({ ok: false, reason: 'say where it is kept (never the secret itself)' });
    expect(judgeAnswer(plain, { status: 'done', now: NOW })).toEqual({ ok: true, event: { type: 'answered', id: plain.id, status: 'done', text: null, by: 'operator', at: NOW } });
    expect(judgeAnswer(fact, { status: 'done', text: 'Filed: 2026-001234567', now: NOW }).event.text).toBe('Filed: 2026-001234567');
  });

  test('a decline says why; a closed ask does not move; a stranger\'s id is no ask', () => {
    expect(judgeAnswer(fact, { status: 'declined', text: '', now: NOW }).reason).toMatch(/say why/);
    expect(judgeAnswer({ ...fact, status: 'done' }, { status: 'declined', text: 'x', now: NOW }).reason).toBe('this item is already done');
    expect(judgeAnswer(fact, { status: 'maybe', text: 'x', now: NOW }).reason).toBe('an answer is done or declined');
    expect(judgeAnswer(undefined, { status: 'done', now: NOW }).reason).toBe('no such HANDS item on this company');
  });

  test('the record folds to one answer per ask; a second answer is skipped and counted', () => {
    const item = makeHands(ask());
    const folded = foldHands([
      { type: 'raised', item, at: NOW },
      { type: 'answered', id: item.id, status: 'done', text: 'Filed: 2026-001234567', by: 'operator', at: NOW },
      { type: 'answered', id: item.id, status: 'declined', text: 'changed my mind', by: 'operator', at: NOW },
      { type: 'raised', item, at: NOW },
    ]);
    expect(folded.items).toHaveLength(1);
    expect(folded.items[0]).toMatchObject({ status: 'done', text: 'Filed: 2026-001234567', answeredAt: NOW });
    expect(folded.skipped).toBe(2);
  });
});
