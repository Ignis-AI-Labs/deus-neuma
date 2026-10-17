import { describe, test, expect } from 'vitest';
import {
  deriveLookVars, isSameLook, isValidLook, STOCK_LOOK, LOOK_KNOBS, LOOK_VAR_NAMES,
} from '../../frontend/utils/look-derive.js';

// Pure functions — real inputs, real outputs, no mock anywhere.

describe('look-derive.js', () => {
  test('the stock look derives exactly the tokens.css values', () => {
    const vars = deriveLookVars(STOCK_LOOK);
    expect(vars['--color-void']).toBe('#000000');
    expect(vars['--color-surface']).toBe('rgba(0, 0, 0, 0.98)');
    expect(vars['--color-text-primary']).toBe('rgba(255, 255, 255, 0.95)');
    expect(vars['--color-text-secondary']).toBe('rgba(255, 255, 255, 0.7)');
    expect(vars['--line']).toBe('rgba(255, 255, 255, 0.18)');
    expect(vars['--line-hover']).toBe('rgba(255, 255, 255, 0.4)');
    expect(vars['--grid']).toBe('rgba(255, 255, 255, 0.02)');
    expect(vars['--color-input-fill']).toBe('rgba(255, 255, 255, 0.08)');
    expect(vars['--signal']).toBe('#5FE9FF');
    expect(vars['--signal-dim']).toBe('rgba(95, 233, 255, 0.5)');
    expect(vars['--signal-faint']).toBe('rgba(95, 233, 255, 0.18)');
  });

  test('a custom look re-derives the whole ramp from its own channels', () => {
    const vars = deriveLookVars({ ground: '#04101C', panel: '#081C30', ink: '#E6F2FF', trim: '#4DA3FF' });
    expect(vars['--color-void']).toBe('#04101C');
    expect(vars['--color-surface']).toBe('rgba(8, 28, 48, 0.98)');
    expect(vars['--color-text-tertiary']).toBe('rgba(230, 242, 255, 0.5)');
    expect(vars['--signal-dim']).toBe('rgba(77, 163, 255, 0.5)');
    expect(vars['--glow-cyan']).toBe('0 0 20px rgba(77, 163, 255, 0.3)');
  });

  test('every derived name is a cosmetic token — status colors stay untouched', () => {
    const names = Object.keys(deriveLookVars(STOCK_LOOK));
    for (const semantic of ['--alert', '--warn', '--color-green', '--voice-1', '--git-modified', '--hand-rest']) {
      expect(names).not.toContain(semantic);
    }
  });

  test('HEAD derives the heading register: explicit hex verbatim, absent falls to ink at the stock relationship', () => {
    const withHead = deriveLookVars({ ground: '#0A0403', panel: '#160906', ink: '#FFF3E9', trim: '#FF7A45', head: '#FFC9A3' });
    expect(withHead['--color-heading']).toBe('#FFC9A3');
    const legacy = deriveLookVars(STOCK_LOOK);
    expect(legacy['--color-heading']).toBe('rgba(255, 255, 255, 0.7)');
  });

  test('BODY, ITAL, EMPH, LINE claim their families; unclaimed they ride the ink', () => {
    const claimed = deriveLookVars({
      ...STOCK_LOOK, body: '#E8D5C4', ital: '#C9A27A', emph: '#FFF4E8', line: '#8A7A6A',
    });
    expect(claimed['--color-text-primary']).toBe('rgba(232, 213, 196, 0.95)');
    expect(claimed['--color-text-secondary']).toBe('rgba(232, 213, 196, 0.7)');
    expect(claimed['--color-italic']).toBe('#C9A27A');
    expect(claimed['--color-emphasis']).toBe('#FFF4E8');
    expect(claimed['--line']).toBe('rgba(138, 122, 106, 0.18)');
    expect(claimed['--color-border-primary']).toBe('rgba(138, 122, 106, 0.2)');
    const legacy = deriveLookVars(STOCK_LOOK);
    expect(legacy['--color-text-primary']).toBe('rgba(255, 255, 255, 0.95)');
    expect(legacy['--line']).toBe('rgba(255, 255, 255, 0.18)');
    expect(legacy['--color-italic']).toBeUndefined();
    expect(legacy['--color-emphasis']).toBeUndefined();
  });


  test('a claimed register derives its whole family; an unclaimed one emits nothing', () => {
    const claimed = deriveLookVars({ ...STOCK_LOOK, alert: '#D42A5B', warn: '#E0A34D', okay: '#3ECF8E' });
    expect(claimed['--alert']).toBe('#D42A5B');
    expect(claimed['--alert-dim']).toBe('rgba(212, 42, 91, 0.55)');
    expect(claimed['--hand-rest']).toBe('rgba(212, 42, 91, 0.55)');
    expect(claimed['--color-error']).toBe('#D42A5B');
    expect(claimed['--warn']).toBe('#E0A34D');
    expect(claimed['--color-green']).toBe('#3ECF8E');
    expect(claimed['--color-success-bg']).toBe('rgba(62, 207, 142, 0.1)');
    const unclaimed = deriveLookVars(STOCK_LOOK);
    for (const name of ['--alert', '--warn', '--color-green', '--hand-rest']) {
      expect(unclaimed[name], `${name} must stay the stylesheet's`).toBeUndefined();
    }
  });

  test('LOOK_VAR_NAMES is the removal superset — every derivable var, claimed or not', () => {
    expect(LOOK_VAR_NAMES).toContain('--alert');
    expect(LOOK_VAR_NAMES).toContain('--color-heading');
    expect(LOOK_VAR_NAMES).toContain('--color-italic');
    expect(LOOK_VAR_NAMES).toContain('--color-emphasis');
    expect(LOOK_VAR_NAMES).toContain('--color-green');
    const claimed = deriveLookVars({
      ...STOCK_LOOK, head: '#FFFFFF', body: '#FFFFFF', ital: '#FFFFFF', emph: '#FFFFFF',
      line: '#FFFFFF', alert: '#D42A5B', warn: '#E0A34D', okay: '#3ECF8E',
    });
    for (const name of Object.keys(claimed)) expect(LOOK_VAR_NAMES).toContain(name);
  });


  test('isValidLook and isSameLook honor all optional voices', () => {
    expect(isValidLook({ ...STOCK_LOOK, alert: '#D42A5B' })).toBe(true);
    expect(isValidLook({ ...STOCK_LOOK, okay: 'green' })).toBe(false);
    expect(isSameLook({ ...STOCK_LOOK, alert: '#D42A5B' }, STOCK_LOOK)).toBe(false);
    expect(isSameLook({ ...STOCK_LOOK, alert: '#d42a5b' }, { ...STOCK_LOOK, alert: '#D42A5B' })).toBe(true);
  });

  test('isSameLook is head-aware: absent equals absent, never an explicit head', () => {
    expect(isSameLook(STOCK_LOOK, { ...STOCK_LOOK })).toBe(true);
    expect(isSameLook({ ...STOCK_LOOK, head: '#FFFFFF' }, STOCK_LOOK)).toBe(false);
    expect(isSameLook({ ...STOCK_LOOK, head: '#ffc9a3' }, { ...STOCK_LOOK, head: '#FFC9A3' })).toBe(true);
  });

  test('isValidLook: head is optional but strict when present', () => {
    expect(isValidLook({ ...STOCK_LOOK, head: '#FFC9A3' })).toBe(true);
    expect(isValidLook({ ...STOCK_LOOK, head: 'gold' })).toBe(false);
  });

  test('isSameLook compares case-insensitively and refuses malformed shapes', () => {
    expect(isSameLook(STOCK_LOOK, { ground: '#000000', panel: '#000000', ink: '#ffffff', trim: '#5fe9ff' })).toBe(true);
    expect(isSameLook(STOCK_LOOK, { ...STOCK_LOOK, trim: '#FF7A45' })).toBe(false);
    expect(isSameLook(STOCK_LOOK, null)).toBe(false);
    expect(isSameLook(STOCK_LOOK, {})).toBe(false);
  });

  test('isValidLook demands all four knobs as #RRGGBB', () => {
    expect(isValidLook(STOCK_LOOK)).toBe(true);
    expect(LOOK_KNOBS).toEqual(['ground', 'panel', 'ink', 'trim']);
    expect(isValidLook({ ...STOCK_LOOK, trim: 'cyan' })).toBe(false);
    expect(isValidLook({ ...STOCK_LOOK, trim: undefined })).toBe(false);
    expect(isValidLook({ ...STOCK_LOOK, trim: '#5FE9FF00' })).toBe(false);
    expect(isValidLook(null)).toBe(false);
    expect(isValidLook('#000000')).toBe(false);
  });
});
