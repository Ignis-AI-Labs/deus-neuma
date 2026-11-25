// FIND IN THIS CHAT (frontend/app/RelinkShell/chat-find.js): which messages hold the words, and where find stands
// after a step. RULE 0: the real functions on real message shapes; nothing mocked.
import { describe, expect, it } from 'vitest';
import { findableText, findMatches, stepMatch, findWords } from '../../frontend/app/RelinkShell/chat-find.js';

const said = (id, role, text, more = []) => ({ id, role, segments: [{ kind: 'speech', text }, ...more] });
const chat = [
  said('h0', 'user', 'Where do we stand on the Base campaign?'),
  said('h1', 'neuma', 'The base list gave 19 fits. Base is the best source.', [{ kind: 'tool', summary: 'read the base file' }]),
  { id: 'h2', role: 'watch', segments: [{ kind: 'speech', text: 'a watch on base ended' }] },
  said('h3', 'user', 'Good. And Robinhood?'),
  said('m4', 'neuma', 'Nothing yet for Robinhood.'),
];

describe('find in this chat', () => {
  it('reads what was said, never a chip or a platform line', () => {
    expect(findableText(chat[1])).toBe('The base list gave 19 fits. Base is the best source.');
    expect(findableText(chat[2])).toBe('');
    expect(findableText(null)).toBe('');
  });

  it('finds every message holding the words, oldest first, whatever the capitals, and counts each message\'s hits', () => {
    expect(findMatches(chat, 'base')).toEqual([{ index: 0, id: 'h0', hits: 1 }, { index: 1, id: 'h1', hits: 2 }]);
    expect(findMatches(chat, '  ROBINHOOD ')).toEqual([{ index: 3, id: 'h3', hits: 1 }, { index: 4, id: 'm4', hits: 1 }]);
    expect(findMatches(chat, 'best source')).toEqual([{ index: 1, id: 'h1', hits: 1 }]);
    expect(findMatches(chat, 'solana')).toEqual([]);
    expect(findMatches(chat, '   ')).toEqual([]);
    expect(findMatches(null, 'base')).toEqual([]);
  });

  it('starts at the newest match, goes to the one before with "older", and wraps at both ends', () => {
    expect(stepMatch(0, null, 'older')).toBeNull();
    expect(stepMatch(3, null, 'older')).toBe(2);   // the first step lands on the newest
    expect(stepMatch(3, 2, 'older')).toBe(1);
    expect(stepMatch(3, 0, 'older')).toBe(2);      // past the oldest: back to the newest
    expect(stepMatch(3, 2, 'newer')).toBe(0);      // past the newest: back to the oldest
    expect(stepMatch(2, 5, 'older')).toBe(1);      // the matches shrank under it
  });

  it('says where it stands, counting from the newest', () => {
    expect(findWords('', 0, null)).toBe('');
    expect(findWords('zzz', 0, null)).toBe('NO MATCH');
    expect(findWords('base', 12, null)).toBe('1 OF 12');
    expect(findWords('base', 12, 11)).toBe('1 OF 12');
    expect(findWords('base', 12, 9)).toBe('3 OF 12');
  });
});
