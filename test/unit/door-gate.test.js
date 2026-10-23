// The door holds a summoning until its model answers, and says so in one line at the model bar.
import { describe, expect, test } from 'vitest';
import { gateWords, needsMind } from '../../frontend/app/FirstRunChoice/door-gate.js';

describe('door-gate', () => {
  test('only the summoning and its rehearsal need a running model', () => {
    expect(needsMind('neuma')).toBe(true);
    expect(needsMind('rehearsal')).toBe(true);
    expect(needsMind('harness')).toBe(false);
    expect(needsMind('witness')).toBe(false);
  });
  test('a held summoning is told, in one line, that it starts by itself', () => {
    expect(gateWords({ state: 'not' }, 'neuma')).toBe('The summoning starts by itself once the model runs.');
    expect(gateWords({ state: 'checking' }, 'rehearsal')).toBe('The rehearsal starts by itself once the model runs.');
  });
  test('nothing pressed, or the model ready: no gate line', () => {
    expect(gateWords({ state: 'not' }, null)).toBeNull();
    expect(gateWords({ state: 'ready' }, 'neuma')).toBeNull();
    expect(gateWords({ state: 'not' }, 'witness')).toBeNull();
  });
});
