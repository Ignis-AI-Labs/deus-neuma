/** Actual production retrieval, including lossless cursor reconstruction. */
import { expect, test } from 'vitest';
import { retrieveFromRecord } from '../../core/runtime/tool-result-retrieval.js';

const record = (content) => ({ ref: 'tr_12345678_0_12345678', content });
const body = (page) => page.response.slice(page.response.indexOf('\n') + 1);

test.each([2, 3, 17, 3000])('pages of %s reconstruct mixed Unicode and multiline text exactly', (pageChars) => {
  const content = 'line α\n😀中文é\r\n'.repeat(310);
  let offset = 0;
  let recovered = '';
  do {
    const page = retrieveFromRecord(record(content), { offset, pageChars });
    expect(page.mode).toBe('page');
    expect(page.response.length).toBeLessThanOrEqual(4000);
    expect(body(page).isWellFormed()).toBe(true);
    expect(page.end).toBeGreaterThan(offset);
    recovered += body(page);
    offset = page.nextOffset;
  } while (offset !== null);
  expect(recovered).toBe(content);
});

test('empty and exact-end pages terminate explicitly', () => {
  expect(retrieveFromRecord(record(''), { offset: 0 })).toMatchObject({ nextOffset: null, start: 0, end: 0 });
  expect(body(retrieveFromRecord(record('done'), { offset: 4 }))).toBe('');
});

test.each([-1, 1.2, '0', null, 100, Number.NaN])('invalid offset %s is refused', (offset) => {
  expect(() => retrieveFromRecord(record('abc'), { offset })).toThrow('offset');
});

test.each([0, 1, 3001, 2.5, '10', null])('invalid pageChars %s is refused', (pageChars) => {
  expect(() => retrieveFromRecord(record('abc'), { pageChars })).toThrow('pageChars');
});

test('ambiguous search/paging and a cursor inside a surrogate pair are refused', () => {
  expect(() => retrieveFromRecord(record('😀text'), { offset: 1 })).toThrow('Unicode pair');
  expect(() => retrieveFromRecord(record('text'), { offset: 0, query: 'text' })).toThrow('either query search or offset paging');
});

test('page size shrinks to the actual response budget without losing its cursor', () => {
  const page = retrieveFromRecord(record('x'.repeat(1000)), { offset: 0, cap: 512 });
  expect(page.response.length).toBeLessThanOrEqual(512);
  expect(page.nextOffset).toBe(page.end);
  expect(page.end).toBeGreaterThan(0);
});
