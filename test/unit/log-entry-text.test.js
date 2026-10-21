// A log entry's message is TEXT — the failures feed (logger.js ring) is what
// the SUBSTRATE window prints, and an object there crashed it (React #31,
// 2026-10-18, […]). The logger reads object-first
// calls in their own order and says any other non-text message as text; the
// desk's asText says any printed server value as text. Real logger, real
// ring; no mocks.
import { describe, it, expect } from 'vitest';
import { createLogger, entryOf, getRecentIssues } from '../../backend/services/logger.js';
import { asText } from '../../frontend/utils/as-text.js';

describe('the logger records every message as text', () => {
  it('a string stays itself; data rides along', () => {
    expect(entryOf('chain call failed', { label: 'x' })).toEqual(['chain call failed', { label: 'x' }]);
  });
  it('an object-first call is read in its own order', () => {
    expect(entryOf({ label: 'natalis', error: 'timeout' }, 'chain call failed')).toEqual(['chain call failed', { label: 'natalis', error: 'timeout' }]);
  });
  it('an {error} message, an Error, or any object becomes words', () => {
    expect(entryOf({ error: 'boom' })[0]).toBe('boom');
    expect(entryOf(new Error('broke'))[0]).toBe('broke');
    expect(entryOf({ error: { code: 7 } })[0]).toBe('{"error":{"code":7}}');
    expect(entryOf(undefined)[0]).toBe('undefined');
  });
  it('the failures ring never holds a non-text message', () => {
    const log = createLogger('LogEntryTextTest');
    log.warn({ error: 'an object as the message' });
    log.error({ label: 'x', error: 'y' }, 'object first, words second');
    const mine = getRecentIssues(100).filter((i) => i.context === 'LogEntryTextTest');
    expect(mine.map((i) => i.msg)).toEqual(['object first, words second', 'an object as the message']);
    mine.forEach((i) => expect(typeof i.msg).toBe('string'));
  });
});

describe('the desk prints a server value as text', () => {
  it('strings, errors, {message}, {error}, objects, nothing', () => {
    expect(asText('ok')).toBe('ok');
    expect(asText(new Error('e'))).toBe('e');
    expect(asText({ message: 'm' })).toBe('m');
    expect(asText({ error: 'boom' })).toBe('boom');
    expect(asText({ error: { code: 7 } })).toBe('{"error":{"code":7}}');
    expect(asText(null)).toBe('');
  });
});
