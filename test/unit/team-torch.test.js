/**
 * team-torch — the shared torch-passing mechanics for the general team lanes.
 * The trial lane (team-waves) re-exports extractTorch from here and keeps its
 * own LOCKED ask wording; these tests pin the shared module directly so the
 * general lane never leans on trial tests for its own contract.
 */
import { describe, test, expect } from 'vitest';
import { TORCH_ASK, extractTorch, torchPickup } from '../../backend/services/team-torch.js';
import { extractTorch as trialExtractTorch, TORCH_ASK as TRIAL_TORCH_ASK } from '../../backend/services/team-waves.js';

describe('extractTorch (pure, shared)', () => {
  test('splits work product from the torch and strips the marker', () => {
    const { body, torch } = extractTorch('the draft here\n\nTORCH:\nDONE: outline\nNEXT: flesh out part 2');
    expect(body).toBe('the draft here');
    expect(torch).toBe('DONE: outline\nNEXT: flesh out part 2');
  });

  test('a reply without a torch has none — null, never invented', () => {
    const { body, torch } = extractTorch('just the work');
    expect(body).toBe('just the work');
    expect(torch).toBeNull();
  });

  test('fence-aware: a TORCH: line inside delivered code is work product', () => {
    const reply = 'here is the code:\n```js\nconsole.log("TORCH: lit");\n```\nTORCH:\nreal continuity';
    const { body, torch } = extractTorch(reply);
    expect(body).toContain('TORCH: lit');
    expect(torch).toBe('real continuity');
  });

  test('a code-only reply with no torch after the last fence keeps everything', () => {
    const reply = '```js\n// TORCH: decorative comment\nlet x = 1;\n```';
    const { body, torch } = extractTorch(reply);
    expect(body).toBe(reply);
    expect(torch).toBeNull();
  });

  test('empty torch and non-string input degrade honestly', () => {
    expect(extractTorch('work\nTORCH:').torch).toBeNull();
    expect(extractTorch(undefined)).toEqual({ body: '', torch: null });
    expect(extractTorch(42)).toEqual({ body: '', torch: null });
  });

  test('the trial lane re-exports THIS implementation — one mechanics, two lanes', () => {
    expect(trialExtractTorch).toBe(extractTorch);
  });
});

describe('TORCH_ASK (general, versionless)', () => {
  test('asks for the exact marker, addressed to the member\'s own next instance', () => {
    expect(TORCH_ASK).toContain('"TORCH:"');
    expect(TORCH_ASK).toContain('your own next instance');
    expect(TORCH_ASK).toContain('where to pick up');
  });

  test('is NOT the trial\'s locked wording — the lanes version independently', () => {
    expect(TORCH_ASK).not.toBe(TRIAL_TORCH_ASK);
  });
});

describe('torchPickup', () => {
  test('names the provenance and carries the member\'s words verbatim', () => {
    const pickup = torchPickup('DONE: the engine\nNEXT: tune the speeds');
    expect(pickup).toBe('Your torch from your last instance:\nDONE: the engine\nNEXT: tune the speeds');
  });
});
