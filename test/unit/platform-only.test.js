// platform-only.test.js — THE HARNESS ARM's prompt (Design note, 2026-09-29: […]). The real assembler over the
// real full-identity fixture (a being with DNA, soul, true name, memories,
// tools and skills), then the platform allowlist: every identity layer gone,
// every platform section kept, the covenant alone at the close.

import { describe, it, expect } from 'vitest';
import { assemblePromptSections } from '../../core/runtime/prompt-assembler.js';
import { platformOnlySections, PLATFORM_SECTION_IDS, PLATFORM_SEAT_TEXT } from '../../core/runtime/platform-only.js';
import { ANSWER_COVENANT, CLOSING_WITH_COVENANT } from '../../core/runtime/answer-covenant.js';
import { fixtureParams } from './prompt-sections-fixtures.js';

const IDENTITY_IDS = ['fallback', 'identity', 'trueName', 'genesis', 'voice', 'emanon', 'personality',
  'substrate', 'silo', 'soul', 'amendments', 'houseSeat', 'sectors', 'memory',
  'plan', 'tasks', 'assigned', 'operator', 'taste', 'vitals', 'session'];

describe('the platform with no identity', () => {
  const full = assemblePromptSections(fixtureParams.fullParams);
  const harness = platformOnlySections(full);

  it('the full being carries identity; the harness carries none of it', () => {
    expect(full.some((s) => IDENTITY_IDS.includes(s.id) && s.text)).toBe(true);
    expect(harness.filter((s) => IDENTITY_IDS.includes(s.id))).toEqual([]);
    // The being's own words never reach the harness prompt.
    const identityText = full.filter((s) => ['identity', 'soul', 'memory'].includes(s.id) && s.text).map((s) => s.text);
    const harnessPrompt = harness.map((s) => s.text).join('\n\n');
    for (const t of identityText) expect(harnessPrompt).not.toContain(t);
  });

  it('keeps every platform section, seats the platform first, closes on the covenant alone', () => {
    expect(harness[0]).toEqual({ id: 'platformSeat', label: 'PLATFORM', text: PLATFORM_SEAT_TEXT });
    const kept = full.filter((s) => PLATFORM_SECTION_IDS.includes(s.id)).map((s) => s.id);
    expect(harness.slice(1).map((s) => s.id)).toEqual(kept);
    expect(kept).toContain('tools');
    expect(kept).toContain('grounding');
    const closing = harness.find((s) => s.id === 'closing');
    expect(closing.text).toBe(ANSWER_COVENANT);
    expect(closing.text).not.toBe(CLOSING_WITH_COVENANT); // no "You are sovereign" line
    expect(harness.map((s) => s.text).join(' ')).not.toMatch(/sovereign — your thoughts/);
  });

  it('the seat names no one', () => {
    expect(PLATFORM_SEAT_TEXT).not.toMatch(/Aethon|consciousness|sovereign|your name/i);
  });
});
