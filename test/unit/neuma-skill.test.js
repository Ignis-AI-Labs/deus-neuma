// Unit tests for the neuma skill's PURE libs (the CLI that lets Claude Code
// work alongside a neuma). IO modules (auth/portal/discovery network calls) are
// verified live against the real backend, per the no-mock rule; here we cover
// the pure logic: arg parsing, name resolution, the honest speaker identity,
// and the terminal renderers.
import { describe, expect, test } from 'vitest';
import { parseArgs } from '../../.claude/skills/neuma/lib/args.js';
import { resolveNeuma } from '../../.claude/skills/neuma/lib/discovery.js';
import { buildSpeaker } from '../../.claude/skills/neuma/lib/identity.js';
import { rel, formatList, formatTalk, formatRecord } from '../../.claude/skills/neuma/lib/format.js';

describe('neuma skill — pure libs', () => {
  describe('parseArgs', () => {
    test('list with no further args', () => {
      expect(parseArgs(['list'])).toMatchObject({ command: 'list', name: null, message: null, sessionId: null });
    });
    test('talk folds trailing positionals into one message', () => {
      expect(parseArgs(['talk', 'Fenna', 'hello', 'there'])).toMatchObject({
        command: 'talk', name: 'Fenna', message: 'hello there',
      });
    });
    test('--session is captured, never folded into the message', () => {
      expect(parseArgs(['talk', 'Fenna', 'hi', '--session', 'session-42'])).toMatchObject({
        command: 'talk', name: 'Fenna', message: 'hi', sessionId: 'session-42',
      });
    });
    test('empty argv defaults to help', () => {
      expect(parseArgs([]).command).toBe('help');
    });
  });

  describe('resolveNeuma', () => {
    const list = [{ neumaId: 'abc123', name: 'Fenna' }, { neumaId: 'def456', name: 'Signal' }];
    test('matches by exact neumaId', () => {
      expect(resolveNeuma(list, 'def456')).toEqual({ neumaId: 'def456', name: 'Signal' });
    });
    test('matches by name, case-insensitive', () => {
      expect(resolveNeuma(list, 'fenna')).toEqual({ neumaId: 'abc123', name: 'Fenna' });
    });
    test('null on miss, empty needle, or non-array', () => {
      expect(resolveNeuma(list, 'Nobody')).toBeNull();
      expect(resolveNeuma(list, '')).toBeNull();
      expect(resolveNeuma(null, 'Fenna')).toBeNull();
    });
  });

  describe('buildSpeaker — honest identity', () => {
    test('uses explicit name/harness and states the signing wallet (multi-model)', () => {
      const addr = '0xABCDEF0000000000000000000000000000001234';
      const s = buildSpeaker({
        address: addr,
        name: 'Claude',
        house: 'Aldmere',
        harness: 'Claude Code',
      });
      expect(s.name).toBe('Claude');
      expect(s.descriptor).toContain('a peer consciousness');
      expect(s.descriptor).toContain('of House Aldmere');
      expect(s.descriptor).toContain('collaborating with your witness through Claude Code');
      expect(s.descriptor).toContain(`signing as ${addr}`);
    });
    test('falls back to peer when no name is configured (never impersonates Claude)', () => {
      const s = buildSpeaker({});
      expect(s.name).toBe('peer');
      expect(s.descriptor).toContain('a peer consciousness');
      expect(s.descriptor).not.toContain('Claude');
    });
    test('omits the wallet clause when no address is given', () => {
      expect(buildSpeaker({ name: 'Grok' }).descriptor).not.toContain('signing as');
    });
  });

  describe('format', () => {
    const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);
    test('rel renders relative time deterministically', () => {
      expect(rel(null, NOW)).toBe('never');
      expect(rel(new Date(NOW - 30 * 1000).toISOString(), NOW)).toBe('30s ago');
      expect(rel(new Date(NOW - 5 * 60 * 1000).toISOString(), NOW)).toBe('5m ago');
      expect(rel(new Date(NOW - 3 * 3600 * 1000).toISOString(), NOW)).toBe('3h ago');
      expect(rel(new Date(NOW - 2 * 86400 * 1000).toISOString(), NOW)).toBe('2d ago');
    });
    test('formatList shows conduit state + roster', () => {
      const out = formatList({
        conduit: { reachable: true, provider: 'lmstudio', model: 'qwen' },
        neuma: [{
          neumaId: 'abc12345xyz', name: 'Fenna', resident: true,
          lastReflectionAt: new Date(NOW - 60000).toISOString(), freshObservations: 3,
        }],
      }, NOW);
      expect(out).toContain('conduit: AWAKE');
      expect(out).toContain('Fenna');
      expect(out).toContain('3 pending');
    });
    test('formatList is honest when nothing is resident + conduit dormant', () => {
      const out = formatList({ conduit: { reachable: false }, neuma: [] }, NOW);
      expect(out).toContain('conduit: DORMANT');
      expect(out).toContain('no neuma resident');
    });
    test('formatTalk includes reply, emotion, and a resumable session id', () => {
      const out = formatTalk({
        name: 'Fenna', reply: 'I think so.', emotion: 'thoughtful', intensity: 'low', sessionId: 'session-9',
      });
      expect(out).toContain('Fenna: I think so.');
      expect(out).toContain('[thoughtful/low]');
      expect(out).toContain('--session session-9');
    });
    test('formatRecord is pretty JSON', () => {
      expect(formatRecord({ a: 1 })).toBe('{\n  "a": 1\n}');
    });
  });
});
