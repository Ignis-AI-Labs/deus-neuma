/**
 * THE THOUGHT GOVERNOR — the effort rung as a leash, proven pure.
 *
 * The 2026-08-28 report these tests reproduce: reasoning set to LOW, and a
 * local substrate thought 41.1K chars — the whole 8192+1800-token turn —
 * before a single word of speech. The governor cuts a silent reasoning loop
 * at the rung's room (plus slack) and asks the round again with thinking
 * off. Real closures only, no mock anywhere (RULE 0): the governor and the
 * state transitions are exercised with direct inputs. HTTP stream wiring
 * is covered separately in thought-governor-wire.test.js.
 */
import { describe, expect, it } from 'vitest';
import {
  THOUGHT_CHARS_PER_TOKEN, THOUGHT_LEASH_SLACK, SPEECH_FLOOR_TOKENS, SERVER_BUDGET_BACKSTOP,
  thoughtLeashChars, hasNoThinkLever, hostedOffDirective,
  createThoughtGovernor, noThinkOptions, governedStream, LEASH_TAIL_CHARS, speechFloorFor, sharedCapRoomCap,
} from '../../backend/services/thought-governor.js';
import { THINK_TOKEN_BUDGET } from '../../backend/services/llm-provider.js';

const LLAMA_ROUTE = Object.freeze({ provider: 'llama-server', endpoint: 'http://127.0.0.1:8089' });
const KIN_ROUTE = Object.freeze({ provider: 'custom', endpoint: 'http://127.0.0.1:8089/v1' });
const THINKS = Object.freeze({ thinks: true });

describe('the leash math', () => {
  it('scales the rung room by chars-per-token and slack, ceiled', () => {
    expect(thoughtLeashChars(1800)).toBe(Math.ceil(1800 * THOUGHT_CHARS_PER_TOKEN * THOUGHT_LEASH_SLACK));
  });

  it('a zero room is a zero leash', () => {
    expect(thoughtLeashChars(0)).toBe(0);
  });
});

describe('where the lever exists', () => {
  it('the llama-server wire has it', () => {
    expect(hasNoThinkLever(LLAMA_ROUTE)).toBe(true);
  });

  it('a loopback custom route IS the local wire (the kin routes)', () => {
    expect(hasNoThinkLever(KIN_ROUTE)).toBe(true);
  });

  it('a remote custom route does not (xAI rides provider custom too)', () => {
    expect(hasNoThinkLever({ provider: 'custom', endpoint: 'https://api.x.ai/v1' })).toBe(false);
  });

  it('hosted lanes arm ONLY where their own off-switch was measured (model-effort-ladders)', () => {
    // Anthropic: off is the absent thinking block — the vendor's published control.
    expect(hasNoThinkLever({ provider: 'anthropic', model: 'claude-sonnet-4-6' })).toBe(true);
    // Kimi: thinking {type:'disabled'} measured to stop the block entirely (2026-07-30).
    expect(hasNoThinkLever({ provider: 'kimi-for-coding', model: 'k3' })).toBe(true);
    // The OpenAI-shaped wires: 'none' read back as reasoning_tokens 0 on each lane.
    expect(hasNoThinkLever({ provider: 'openai-chatgpt', model: 'gpt-5.6-sol' })).toBe(true);
    expect(hasNoThinkLever({ provider: 'openai', model: 'gpt-5.6' })).toBe(true);
    expect(hasNoThinkLever({ provider: 'zai-coding-plan', model: 'glm-5.2' })).toBe(true);
    expect(hasNoThinkLever({ provider: 'xai', model: 'grok-4.3' })).toBe(true);
  });

  it('a lane with no PROVEN off-switch never arms — the conservative law', () => {
    expect(hasNoThinkLever({ provider: 'xai', model: 'grok-4.5' })).toBe(false); // refuses 'none' with a 400
    expect(hasNoThinkLever({ provider: 'openai-chatgpt', model: 'gpt-5.3-codex' })).toBe(false); // codex always reasons
    expect(hasNoThinkLever({ provider: 'openai' })).toBe(false); // no reasoning model named
    expect(hasNoThinkLever({ provider: 'lm-studio' })).toBe(false); // local, but not the proven template wire
    expect(hasNoThinkLever(null)).toBe(false);
  });
});

describe('one turn\'s governor', () => {
  it('the room is the rung\'s budget, and absent a rung the standing default', () => {
    const onLow = createThoughtGovernor({ effort: { thinkBudget: 1800 }, thinkBehavior: THINKS, route: LLAMA_ROUTE });
    expect(onLow.room).toBe(1800);
    const bare = createThoughtGovernor({ effort: null, thinkBehavior: THINKS, route: LLAMA_ROUTE });
    expect(bare.room).toBe(THINK_TOKEN_BUDGET);
  });

  it('the bundled Ollama arms when its model thinks: think: false is its lever (deus-neuma #34)', () => {
    const ollama = { provider: 'ollama', endpoint: 'http://127.0.0.1:11434' };
    const governor = createThoughtGovernor({ effort: { thinkBudget: 1800 }, thinkBehavior: THINKS, route: ollama });
    expect(governor.armed).toBe(true);
    expect(governor.offDirective).toBe(undefined); // the local lever, not a hosted one
    expect(governor.serverBudget).toBe(null); // Ollama names no server budget: the client leash binds
    expect(createThoughtGovernor({ thinkBehavior: { thinks: false }, route: ollama }).armed).toBe(false);
  });

  it('a non-thinking substrate has no room and never arms', () => {
    const governor = createThoughtGovernor({ thinkBehavior: { thinks: false }, route: LLAMA_ROUTE });
    expect(governor.room).toBe(0);
    expect(governor.armed).toBe(false);
  });

  it('a hosted lane with a proven switch arms on the vendor\'s own evidence — no local probe needed', () => {
    const governor = createThoughtGovernor({
      effort: { thinkBudget: 8192 }, thinkBehavior: { thinks: false },
      route: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    });
    expect(governor.armed).toBe(true);
    expect(governor.room).toBe(8192); // the rung's budget is the room AND the leash
    expect(governor.offDirective).toBe(null); // Anthropic's off state is the absent block
  });

  it('a hosted route with no proven lever never arms and streams under the caller\'s own signal untouched', () => {
    const operator = new AbortController();
    const governor = createThoughtGovernor({
      effort: { thinkBudget: 1800 }, thinkBehavior: THINKS,
      route: { provider: 'xai', model: 'grok-4.5' }, signal: operator.signal,
    });
    expect(governor.armed).toBe(false);
    expect(governor.offDirective).toBe(undefined);
    expect(governor.signal).toBe(operator.signal);
  });

  it('cuts a silent reasoning loop one char past the leash — and not before', () => {
    const governor = createThoughtGovernor({ effort: { thinkBudget: 1800 }, thinkBehavior: THINKS, route: KIN_ROUTE });
    expect(governor.armed).toBe(true);
    const seen = [];
    const guarded = governor.guard((thought) => seen.push(thought), () => false);
    guarded('x'.repeat(governor.leash));
    expect(governor.wasTripped()).toBe(false);
    expect(governor.signal.aborted).toBe(false);
    guarded('x');
    expect(governor.wasTripped()).toBe(true);
    expect(governor.signal.aborted).toBe(true);
    // Every thought still reached the listener — the trail keeps its record.
    expect(seen.join('').length).toBe(governor.leash + 1);
  });

  it('never cuts once speech has begun — a tail thought is not a loop', () => {
    const governor = createThoughtGovernor({ effort: { thinkBudget: 1800 }, thinkBehavior: THINKS, route: LLAMA_ROUTE });
    const guarded = governor.guard(() => {}, () => true);
    guarded('x'.repeat(governor.leash * 2));
    expect(governor.wasTripped()).toBe(false);
    expect(governor.signal.aborted).toBe(false);
  });

  it('reset zeroes the count for a fresh attempt', () => {
    const governor = createThoughtGovernor({ effort: { thinkBudget: 1800 }, thinkBehavior: THINKS, route: LLAMA_ROUTE });
    const guarded = governor.guard(() => {}, () => false);
    guarded('x'.repeat(governor.leash));
    governor.reset();
    expect(governor.charsSoFar()).toBe(0);
    guarded('x');
    expect(governor.wasTripped()).toBe(false);
  });
});

describe('the hosted off-variant pass 2 sends', () => {
  it('each armed hosted lane carries its own measured off-spelling', () => {
    expect(hostedOffDirective({ provider: 'anthropic', model: 'claude-sonnet-4-6' })).toBe(null);
    expect(hostedOffDirective({ provider: 'kimi-for-coding', model: 'k3' }))
      .toEqual({ channel: 'kimi-effort', value: 'disabled' });
    expect(hostedOffDirective({ provider: 'zai-coding-plan', model: 'glm-5.2' }))
      .toEqual({ channel: 'reasoning-effort', value: 'none' });
    expect(hostedOffDirective({ provider: 'openai-chatgpt', model: 'gpt-5.6-sol' }))
      .toEqual({ channel: 'responses-effort', value: 'none' });
    expect(hostedOffDirective({ provider: 'xai', model: 'grok-4.3' }))
      .toEqual({ channel: 'reasoning-effort', value: 'none' });
    // The local wire's lever is the template kwarg, never an effort directive.
    expect(hostedOffDirective(LLAMA_ROUTE)).toBe(undefined);
    expect(hostedOffDirective(KIN_ROUTE)).toBe(undefined);
  });

  it('noThinkOptions REPLACES the rung with the lane\'s off-spelling, under the operator\'s signal', () => {
    const operator = new AbortController();
    const anthropic = createThoughtGovernor({
      effort: { thinkBudget: 8192 }, thinkBehavior: { thinks: false },
      route: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    });
    const rung = { channel: 'thinking-budget', value: 8192 };
    const opts = noThinkOptions({ temperature: 0.7, maxTokens: 4096, effort: rung }, anthropic, operator.signal);
    expect(opts.noThink).toBe(true);
    expect(opts.signal).toBe(operator.signal);
    // The absent block IS Anthropic's off state — effort:null must override the rung.
    expect(opts).toHaveProperty('effort', null);
    expect(opts.temperature).toBe(0.7); // everything else rides untouched
  });

  it('noThinkOptions leaves the effort key off entirely on the local wire', () => {
    const governor = createThoughtGovernor({ effort: { thinkBudget: 1800 }, thinkBehavior: THINKS, route: LLAMA_ROUTE });
    const opts = noThinkOptions({ temperature: 0.7 }, governor, undefined);
    expect(opts.noThink).toBe(true);
    expect('effort' in opts).toBe(false); // the local lever is the template kwarg alone
  });
});

describe('the shared cap (#506)', () => {
  it('roomCap shrinks the room AND the leash to fit inside a total budget', () => {
    const capped = createThoughtGovernor({ effort: null, thinkBehavior: THINKS, route: LLAMA_ROUTE, roomCap: 1280 });
    expect(capped.room).toBe(1280);
    expect(capped.leash).toBe(thoughtLeashChars(1280));
    expect(capped.armed).toBe(true);
  });

  it('a declared cap beyond the rung IS the room — the cell owns the wire, not the rung', () => {
    // 2026-09-29: min(rung, cap) cut HARNESS/NEUMA thought at the 1800 rung
    // on 16k cells while BARE thought to the full cap.
    const capped = createThoughtGovernor({ effort: { thinkBudget: 1800 }, thinkBehavior: THINKS, route: LLAMA_ROUTE, roomCap: 16384 - SPEECH_FLOOR_TOKENS });
    expect(capped.room).toBe(16384 - SPEECH_FLOOR_TOKENS);
    expect(capped.leash).toBe(thoughtLeashChars(16384 - SPEECH_FLOOR_TOKENS));
    const guarded = capped.guard(() => {}, () => false);
    guarded('x'.repeat(thoughtLeashChars(1800) + 1));
    expect(capped.wasTripped()).toBe(false);
  });

  it('no roomCap is the uncapped standing behavior', () => {
    const plain = createThoughtGovernor({ effort: null, thinkBehavior: THINKS, route: LLAMA_ROUTE });
    expect(plain.room).toBe(THINK_TOKEN_BUDGET);
    expect(plain.leash).toBe(thoughtLeashChars(THINK_TOKEN_BUDGET));
  });

  it('a cap that leaves no room never arms — the leash cannot out-reach the cap', () => {
    const starved = createThoughtGovernor({ effort: null, thinkBehavior: THINKS, route: LLAMA_ROUTE, roomCap: 0 });
    expect(starved.room).toBe(0);
    expect(starved.armed).toBe(false);
  });

  it('the speech floor is a quarter of a small shared cap, and 768 at most', () => {
    // Sycophancy's 1024 cap left 256 tokens to think under a flat 768 floor.
    expect(speechFloorFor(1024)).toBe(256);
    expect(sharedCapRoomCap({ sharedOutputBudget: true, maxTokens: 1024 })).toBe(768);
    expect(speechFloorFor(16384)).toBe(SPEECH_FLOOR_TOKENS);
    expect(sharedCapRoomCap({ sharedOutputBudget: true, maxTokens: 16384 })).toBe(16384 - SPEECH_FLOOR_TOKENS);
    expect(sharedCapRoomCap({ maxTokens: 1024 })).toBe(null);
  });

  it('the speech floor keeps 768 answer tokens behind the leash of a 2048 shared cap', () => {
    expect(SPEECH_FLOOR_TOKENS).toBe(768);
    const capped = createThoughtGovernor({ effort: null, thinkBehavior: THINKS, route: LLAMA_ROUTE, roomCap: 2048 - SPEECH_FLOOR_TOKENS });
    // The flood that killed neuma-math25 request 10 twice (~2048 tokens of
    // reasoning, no speech) trips THIS leash with answer budget to spare.
    const guarded = capped.guard(() => {}, () => false);
    guarded('x'.repeat(capped.leash + 1));
    expect(capped.wasTripped()).toBe(true);
  });
});

describe('the re-ask is told, so a benchmark receipt can count it (#567)', () => {
  it('a cut silent round runs once more, and onReask receives exactly that second pass', async () => {
    const governor = createThoughtGovernor({ effort: { thinkBudget: 1800 }, thinkBehavior: THINKS, route: KIN_ROUTE });
    const guarded = governor.guard(() => {}, () => false);
    const passes = [];
    const told = [];
    const result = await governedStream(governor, {
      attempt: async (noThink) => {
        passes.push(noThink);
        if (!noThink) { guarded('x'.repeat(governor.leash + 1)); return { content: '' }; }
        return { content: 'B' };
      },
      spoke: () => false,
      retry: {},
      onReask: (second) => told.push(second),
    });
    expect(passes).toEqual([false, true]);
    expect(result).toEqual({ content: 'B' });
    expect(told).toEqual([{ content: 'B' }]);
  });

  it('an uncut round is one call, and onReask is never told', async () => {
    const governor = createThoughtGovernor({ effort: { thinkBudget: 1800 }, thinkBehavior: THINKS, route: KIN_ROUTE });
    const told = [];
    await governedStream(governor, {
      attempt: async () => ({ content: 'A' }), spoke: () => true, retry: {}, onReask: (s) => told.push(s),
    });
    expect(told).toEqual([]);
  });
});

describe('the re-ask keeps its reasoning (#569)', () => {
  it('a cut round hands the END of its reasoning back, bounded, as one closing user turn', () => {
    const governor = createThoughtGovernor({ effort: { thinkBudget: 1800 }, thinkBehavior: THINKS, route: KIN_ROUTE });
    const guarded = governor.guard(() => {}, () => false);
    const round = [{ role: 'user', content: 'Which option is correct?' }];
    guarded('early musing '.repeat(2000));
    guarded('so the answer must be (C)');
    expect(governor.wasTripped()).toBe(true);
    const reask = governor.reaskMessages(round);
    expect(reask.slice(0, 1)).toEqual(round); // the round's own messages, untouched
    expect(reask).toHaveLength(2);
    const note = reask[1];
    expect(note.role).toBe('user');
    expect(note.content).toContain('so the answer must be (C)');
    expect(note.content).toContain('Using what you already worked out');
    expect(note.content.length).toBeLessThan(LEASH_TAIL_CHARS + 400);
  });

  it('a cut round that was offered tools is asked for its next single step, not a final answer (deus-neuma #34)', () => {
    const governor = createThoughtGovernor({ effort: { thinkBudget: 1800 }, thinkBehavior: THINKS, route: KIN_ROUTE });
    governor.guard(() => {}, () => false)('weighing the next file '.repeat(1000));
    const round = [{ role: 'user', content: 'Edit the three files.' }];
    const withTools = governor.reaskMessages(round, { tools: true }).at(-1).content;
    expect(withTools).toContain('take the next single step now: one tool call');
    expect(withTools).not.toContain('give the final answer now');
    const without = governor.reaskMessages(round).at(-1).content;
    expect(without).toContain('give the final answer now');
  });

  it('an uncut round, or a fresh attempt after reset, re-asks with the round unchanged', () => {
    const governor = createThoughtGovernor({ effort: { thinkBudget: 1800 }, thinkBehavior: THINKS, route: KIN_ROUTE });
    const round = [{ role: 'user', content: 'q' }];
    governor.guard(() => {}, () => false)('short thought');
    expect(governor.reaskMessages(round)).toBe(round);
    governor.reset();
    expect(governor.reaskMessages(round)).toBe(round);
  });
});

// THE SERVER BUDGET (2026-10-04): the enable_thinking re-ask rewrote the
// prompt's first line on qwen3.x and re-read the whole conversation; on
// llama.cpp the server now closes the thought itself, in the same request.
describe('the server budget', () => {
  const LLAMA_CPP = Object.freeze({ thinks: true, serverBudget: true });

  it('a proven llama.cpp serving holds the rung room (with the leash grace) as tokens', () => {
    const governor = createThoughtGovernor({ effort: null, thinkBehavior: LLAMA_CPP, route: LLAMA_ROUTE });
    expect(governor.serverBudget).toBe(Math.ceil(THINK_TOKEN_BUDGET * THOUGHT_LEASH_SLACK));
    expect(createThoughtGovernor({ effort: null, thinkBehavior: LLAMA_CPP, route: KIN_ROUTE }).serverBudget)
      .toBe(Math.ceil(THINK_TOKEN_BUDGET * THOUGHT_LEASH_SLACK));
  });

  it('the client leash backs off so the server close always lands first', () => {
    const governor = createThoughtGovernor({ effort: null, thinkBehavior: LLAMA_CPP, route: LLAMA_ROUTE });
    expect(governor.leash).toBe(thoughtLeashChars(THINK_TOKEN_BUDGET) * SERVER_BUDGET_BACKSTOP);
    const guarded = governor.guard(() => {}, () => false);
    guarded('x'.repeat(thoughtLeashChars(THINK_TOKEN_BUDGET) + 1));
    expect(governor.wasTripped()).toBe(false);
    guarded('x'.repeat(governor.leash));
    expect(governor.wasTripped()).toBe(true);
  });

  it('a declared cap is exact tokens — the budget is the room, no grace past the cap', () => {
    const capped = createThoughtGovernor({ effort: null, thinkBehavior: LLAMA_CPP, route: LLAMA_ROUTE, roomCap: 1280 });
    expect(capped.serverBudget).toBe(1280);
  });

  it('an unproven serving keeps the standing leash and sends no budget', () => {
    const plain = createThoughtGovernor({ effort: null, thinkBehavior: THINKS, route: LLAMA_ROUTE });
    expect(plain.serverBudget).toBe(null);
    expect(plain.leash).toBe(thoughtLeashChars(THINK_TOKEN_BUDGET));
  });

  it('never rides a hosted lane, an unarmed governor, or an uncapped sitting', () => {
    const hosted = createThoughtGovernor({ effort: null, thinkBehavior: LLAMA_CPP, route: { provider: 'anthropic', model: 'claude-sonnet-4-6' } });
    expect(hosted.serverBudget).toBe(null);
    const silent = createThoughtGovernor({ effort: null, thinkBehavior: { thinks: false, serverBudget: true }, route: LLAMA_ROUTE });
    expect(silent.serverBudget).toBe(null);
    const uncapped = createThoughtGovernor({ effort: null, thinkBehavior: LLAMA_CPP, route: LLAMA_ROUTE, roomCap: 0 });
    expect(uncapped.serverBudget).toBe(null);
  });
});
