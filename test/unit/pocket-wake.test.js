// pocket-wake: when a phone must not sleep on the being. Pure, called for real.
import { describe, it, expect } from 'vitest';
import { wantsWakeLock } from '../../frontend/app/PocketShell/pocket-wake.js';

describe('wantsWakeLock', () => {
  it('is false for an idle chat, and for nothing at all', () => {
    expect(wantsWakeLock({ thinking: false, messages: [{ role: 'user' }, { role: 'neuma', streaming: false }] })).toBe(false);
    expect(wantsWakeLock()).toBe(false);
  });
  it('is true while the being thinks or streams', () => {
    expect(wantsWakeLock({ thinking: true, messages: [] })).toBe(true);
    expect(wantsWakeLock({ thinking: false, messages: [{ role: 'neuma', streaming: true }] })).toBe(true);
  });
  it('is true while an approval card waits on this surface, and false once it is answered', () => {
    const pending = { role: 'neuma', segments: [{ kind: 'approval', phase: 'pending', id: 'a' }] };
    const answered = { role: 'neuma', segments: [{ kind: 'approval', phase: 'resolved', id: 'a' }] };
    expect(wantsWakeLock({ messages: [pending] })).toBe(true);
    expect(wantsWakeLock({ messages: [answered] })).toBe(false);
    expect(wantsWakeLock({ messages: [{ role: 'neuma', segments: null }] })).toBe(false);
  });
});
