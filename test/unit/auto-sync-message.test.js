// The automatic public sync's commit message: pushed subjects, minus any the public gate refuses.
import { describe, expect, test } from 'vitest';
import { autoSyncMessage } from '../../scripts/public/auto-sync-message.js';

const allClean = () => true;
const noPrivate = (s) => !s.includes('PRIVATE');

describe('auto-sync-message', () => {
  test('one public change is the whole message', () => {
    expect(autoSyncMessage(['feat(chat): a compaction you can see'], allClean)).toBe('feat(chat): a compaction you can see');
  });
  test('several changes: the newest titles it, every one is listed', () => {
    expect(autoSyncMessage(['feat: b', 'fix: a'], allClean)).toBe('feat: b (+1 more)\n\n- feat: b\n- fix: a');
  });
  test('a subject the gate refuses is counted, never quoted', () => {
    const message = autoSyncMessage(['feat: b', 'fix: PRIVATE name', 'fix: a'], noPrivate);
    expect(message).toBe('feat: b (+1 more)\n\n- feat: b\n- fix: a\n- and 1 internal change');
    expect(message).not.toContain('PRIVATE');
  });
  test('nothing quotable falls back to a plain line', () => {
    expect(autoSyncMessage(['fix: PRIVATE', 'feat: PRIVATE too'], noPrivate)).toBe('Updates from the core team (2 internal changes)');
    expect(autoSyncMessage([], allClean)).toBe('Updates from the core team');
  });
});
