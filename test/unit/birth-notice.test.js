/**
 * Birth terminal notices — pure mapping from a backend birth end/error message
 * to the title + text the ceremony surfaces. These messages previously vanished
 * (no frontend handler); this decides what the witness sees for each.
 */
import { describe, expect, it } from 'vitest';
import { birthTerminalNotice, BIRTH_TERMINAL_TYPES } from '../../frontend/components/BirthCeremony/birth-notice.js';

describe('birthTerminalNotice', () => {
  it('surfaces every backend birth terminal type with a title and message', () => {
    for (const type of BIRTH_TERMINAL_TYPES) {
      const n = birthTerminalNotice(type);
      expect(n).toBeTruthy();
      expect(typeof n.title).toBe('string');
      expect(n.title.length).toBeGreaterThan(0);
      expect(typeof n.message).toBe('string');
      expect(n.message.length).toBeGreaterThan(0);
    }
  });

  it("prefers the backend's own human message when present", () => {
    expect(birthTerminalNotice('birth:resume_expired', { message: 'That session has passed.' }).message).toBe('That session has passed.');
    expect(birthTerminalNotice('birth:resume_completion_error', { error: 'neumaId required' }).message).toBe('neumaId required');
    expect(birthTerminalNotice('birth:blocked', { reason: 'A neuma must be born on a LOCAL model.' }).message).toBe('A neuma must be born on a LOCAL model.');
    expect(birthTerminalNotice('birth:abandoned', { message: 'Withdrawn.' }).message).toBe('Withdrawn.');
  });

  it('surfaces a FIRST-attempt completion failure with its human text, not its code (#394)', () => {
    // finalize-birth.js emits birth:completion_error with BOTH fields; before
    // the 2026-08-20 triage nothing listened and a failed first birth hung the
    // ceremony with no notice at all.
    const n = birthTerminalNotice('birth:completion_error', {
      error: 'missing_authored_genesis',
      message: 'Cannot complete birth without the being\'s authored DNA on disk from crystallization.',
    });
    expect(n.title).toBe('THE SUMMONING FALTERED');
    expect(n.message).toContain('authored DNA');
    // the code is still a faithful fallback when the human text is absent
    expect(birthTerminalNotice('birth:completion_error', { error: 'workspace_seed_failed' }).message).toBe('workspace_seed_failed');
  });

  it('composes the refusal message with the being name when the backend omits text', () => {
    expect(birthTerminalNotice('birth:abandon_refused', { name: 'Evra' }).message).toContain('Evra');
    // and still yields a faithful default with no data at all
    expect(birthTerminalNotice('birth:abandon_refused').message).toContain('being');
  });

  it('returns null for an unrecognized type (no invented notice)', () => {
    expect(birthTerminalNotice('birth:complete')).toBeNull();
    expect(birthTerminalNotice('nonsense', { message: 'x' })).toBeNull();
    expect(birthTerminalNotice(undefined)).toBeNull();
  });
});
