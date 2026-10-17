/**
 * Components held back from the early release (frontend/app/coming-later.js):
 * the dock, the slash palette and the VOX preference all close the same doors,
 * and a desk can still preview one. Pure law over real inputs; localStorage is
 * the real Web Storage shape node provides when given one. No mocks (RULE 0).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { COMING_LATER, isComingLater, withoutComingLater } from '../../frontend/app/coming-later.js';
import { PLATFORM_COMMANDS } from '../../frontend/app/RelinkShell/commands.js';

const storage = (entries) => {
  const map = new Map(Object.entries(entries));
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) };
};

describe('coming later — voice and the 3D body wait for early access', () => {
  afterEach(() => { delete globalThis.localStorage; });

  it('holds back voice and avatar, nothing else', () => {
    expect(COMING_LATER).toEqual(['voice', 'avatar']);
    expect(isComingLater('voice')).toBe(true);
    expect(isComingLater('avatar')).toBe(true);
    expect(isComingLater('chat')).toBe(false);
  });

  it('the dock registry loses exactly those apps', () => {
    const reg = withoutComingLater({ chat: 1, voice: 2, avatar: 3, files: 4 });
    expect(Object.keys(reg)).toEqual(['chat', 'files']);
  });

  it('the slash palette offers no door into them', () => {
    const opens = PLATFORM_COMMANDS.filter((c) => c.run.type === 'open').map((c) => c.run.app);
    expect(opens).not.toContain('voice');
    expect(opens).not.toContain('avatar');
    expect(opens.length).toBeGreaterThan(0);
  });

  it('a desk can preview one by id', () => {
    globalThis.localStorage = storage({ 'neuma.preview': 'voice' });
    expect(isComingLater('voice')).toBe(false);
    expect(isComingLater('avatar')).toBe(true);
  });
});
