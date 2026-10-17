/**
 * THE MARKETING TOOL ROWS (posting-pipeline-v2, live-desk finding 2026-09-03):
 * pipeline_state is the one call every CMO session starts with — it must be
 * ALLOWED, in every mode, forever. It carded once because its row was absent
 * and the policy default is fail-closed (absent = approval_required) — the
 * SAME fall-through campaign_list hit before (the comment on the row warns
 * about it in so many words). This file is the pin that makes the third time
 * impossible.
 */
import { describe, test, expect } from 'vitest';
import { GLOBAL_DEFAULTS, resolvePolicy, checkToolAccess, applyToolMode } from '../../backend/services/tool-policy.js';

describe('marketing tool policy rows — reads never cost a card', () => {
  const policy = resolvePolicy(GLOBAL_DEFAULTS, null, null);

  test('pipeline_state and campaign_list are allowed, cold', () => {
    expect(checkToolAccess(policy, 'marketing', 'pipeline_state')).toBe('allowed');
    expect(checkToolAccess(policy, 'marketing', 'campaign_list')).toBe('allowed');
  });

  test('allowed in ask and auto — and observe HOLDS it, like every shared-state read', () => {
    // ask/auto: the friction being fixed — the posture read never costs a card.
    expect(applyToolMode(checkToolAccess(policy, 'marketing', 'pipeline_state'), 'ask', 'pipeline_state')).toBe('allowed');
    expect(applyToolMode(checkToolAccess(policy, 'marketing', 'pipeline_state'), 'auto', 'pipeline_state')).toBe('allowed');
    // observe: pipeline_state reads SHARED house state (queue, plan, feed) —
    // it sits in OBSERVATION_TOOLS, whose law is […]. Same stance as queue_list.
    expect(applyToolMode(checkToolAccess(policy, 'marketing', 'pipeline_state'), 'observe', 'pipeline_state')).toBe('denied');
  });

  test('a lane-specific deny row still wins — the operator can silence it', () => {
    const silenced = resolvePolicy(GLOBAL_DEFAULTS, { marketing: { denied: ['pipeline_state'] } }, null);
    expect(checkToolAccess(silenced, 'marketing', 'pipeline_state')).toBe('denied');
  });
});
