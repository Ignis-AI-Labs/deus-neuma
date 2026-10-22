// The door holds a summoning until its model answers, and says so where it was pressed.
import { describe, expect, test } from 'vitest';
import { gateWords, needsMind } from '../../frontend/app/FirstRunChoice/door-gate.js';

describe('door-gate', () => {
  test('only the summoning and its rehearsal need a running model', () => {
    expect(needsMind('neuma')).toBe(true);
    expect(needsMind('rehearsal')).toBe(true);
    expect(needsMind('harness')).toBe(false);
    expect(needsMind('witness')).toBe(false);
  });
  test('a held summoning is told why, and that it begins by itself', () => {
    const w = gateWords({ state: 'not', detail: 'ollama · qwen — connected, and returned nothing at all' }, 'neuma');
    expect(w.title).toBe('THE SUMMONING WAITS HERE · NO MODEL IS READY YET');
    expect(w.body).toContain('(ollama · qwen — connected, and returned nothing at all)');
    expect(w.body).toContain('the summoning begins by itself once it answers');
    expect(gateWords({ state: 'not' }, 'rehearsal').title).toBe('THE REHEARSAL WAITS HERE · NO MODEL IS READY YET');
  });
  test('before anything is pressed the door still says what is missing; checking says nothing until pressed', () => {
    expect(gateWords({ state: 'not' }, null).title).toBe('BEFORE YOU SUMMON · NO MODEL IS READY YET');
    expect(gateWords({ state: 'checking' }, null)).toBeNull();
    expect(gateWords({ state: 'checking' }, 'neuma').title).toBe('CHECKING THAT THE MODEL ANSWERS…');
    expect(gateWords({ state: 'ready' }, 'neuma')).toBeNull();
  });
});
