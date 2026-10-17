/**
 * The effort controls — a LADDER you pick one rung of, and a THINKING switch
 * beside it where the wire really has one: what the composer renders, and what a
 * turn puts on the wire. Pure functions called with real routes and real stored
 * choices; no mock is possible or needed (RULE 0).
 *
 * Two load-bearing properties:
 *   FAIL-CLOSED — a model with no grounded ladder reports none, and the switch
 *     appears only where turning reasoning off was PROVEN on that wire. A
 *     fabricated control would make the desk claim a capability the vendor may
 *     not have, and the operator would believe it.
 *   ONE CHOICE PER QUESTION — "how hard" is the ladder (the gears above HIGH are
 *     rungs, not chips); "whether at all" is the switch. Never mixed.
 */
import { describe, expect, test } from 'vitest';
import {
  EFFORT_LADDER, DEFAULT_EFFORT, effortCapability, normalizeChoice,
  effortDirective, effortThinkBudget, reasoningRoom, resolveEffort,
} from '../../backend/services/model-effort.js';

/** The rungs a capability offers, as plain strings. */
const rungs = (capability) => [...capability.tiers];
/** What the operator would read in the dropdown, top to bottom. */
const labels = (capability) => capability.tiers.map((rung) => capability.labels[rung]);

describe('model-effort', () => {
  describe('effortCapability', () => {
    test('a local thinking substrate has the reasoning-ROOM ladder and no switch', () => {
      const cap = effortCapability({ provider: 'llama-server', model: 'gemma-4-31b-it' }, true);
      expect(cap.channel).toBe('think-budget');
      expect(rungs(cap)).toEqual(['low', 'medium', 'high']);
      expect(labels(cap)).toEqual(['LOW', 'MEDIUM', 'HIGH']);
      // No switch: turning a local template's reasoning off is a knob this house
      // has not proven, and a control that changes nothing is worse than none.
      expect(cap.thinking).toBe(false);
    });

    test('gemma-4 keeps the room ladder even when the ready-probe did not think', () => {
      const cap = effortCapability({ provider: 'llama-server', model: 'gemma-4-31b-it' }, false);
      expect(cap.channel).toBe('think-budget');
      expect(rungs(cap)).toEqual(['low', 'medium', 'high']);
    });

    test('a local substrate the table does not name as a reasoner has no ladder when the probe is silent', () => {
      const cap = effortCapability({ provider: 'llama-server', model: 'llama3.1-8b' }, false);
      expect(cap.channel).toBe('none');
      expect(rungs(cap)).toEqual([]);
    });

    test("a 'custom' provider on loopback IS a local engine (the kin LoRA routes)", () => {
      expect(effortCapability({ provider: 'custom', model: 'gemma-4-31b-it', endpoint: 'http://127.0.0.1:8089' }, true).channel)
        .toBe('think-budget');
      // The same label pointed off-machine (xAI rides 'custom' internally) is NOT local.
      expect(effortCapability({ provider: 'custom', model: 'grok-4', endpoint: 'https://api.x.ai' }, true).channel)
        .toBe('none');
    });

    test('an OpenAI reasoning model carries its whole ladder in one list', () => {
      // gpt-5.0 and the o-series predate the gears above HIGH.
      expect(rungs(effortCapability({ provider: 'openai', model: 'gpt-5' })))
        .toEqual(['low', 'medium', 'high']);
      expect(rungs(effortCapability({ provider: 'openai', model: 'o3-mini' })))
        .toEqual(['low', 'medium', 'high']);
      // The 5.4+ line has both gears, so both are rungs — never separate chips.
      expect(rungs(effortCapability({ provider: 'openai', model: 'gpt-5.6-sol' })))
        .toEqual([...EFFORT_LADDER]);
    });

    test("the codex line always reasons — no switch, and it stops before PRO", () => {
      // Re-probed live 2026-07-29: gpt-5.3-codex-spark answers 400 to 'none' AND
      // to 'max', while honoring 'xhigh' (511 reasoning tokens). A version-only
      // gate would have handed it a top gear the vendor refuses.
      const codex = effortCapability({ provider: 'openai-chatgpt', model: 'gpt-5.3-codex-spark' });
      expect(codex.channel).toBe('responses-effort');
      expect(rungs(codex)).toEqual(['low', 'medium', 'high', 'ultra']);
      expect(codex.thinking).toBe(false);
    });

    test('a non-reasoning OpenAI model has no ladder', () => {
      expect(effortCapability({ provider: 'openai', model: 'gpt-4o' }).channel).toBe('none');
    });

    test("the ChatGPT lane reads in ChatGPT's own words", () => {
      // Read off the product 2026-07-30, Advanced ▸ Effort:
      //   Light · Medium · High · Extra High · Max · Ultra
      // Their "Ultra" names no value in the field's own enum, so it is not
      // offered — fail-closed. Everything else maps to a probed wire value.
      const cap = effortCapability({ provider: 'openai-chatgpt', model: 'gpt-5.6-sol' });
      expect(cap.channel).toBe('responses-effort');
      expect(labels(cap)).toEqual(['LIGHT', 'MEDIUM', 'HIGH', 'EXTRA HIGH', 'MAX']);
      // The switch is real here — MEASURED 2026-07-30: 'none' spends 0 reasoning
      // tokens where 'high' spends 31. ChatGPT's picker has no such toggle, but
      // the wire we channel does, and nothing that works is hidden.
      expect(cap.thinking).toBe(true);
      expect(cap.thinkingLabel).toBe('THINKING');
    });

    test('the OpenAI API lane keeps the API\'s own vocabulary', () => {
      // No picker exists there — the wire values ARE the vendor's words.
      const cap = effortCapability({ provider: 'openai', model: 'gpt-5.6-sol' });
      expect(labels(cap)).toEqual(['LOW', 'MEDIUM', 'HIGH', 'XHIGH', 'MAX']);
    });

    test("the 5.4+ ChatGPT line has the top rung — the one ChatGPT calls Max", () => {
      // Probed live 2026-07-29 by SENDING each rung and reading back
      // usage.output_tokens_details.reasoning_tokens on gpt-5.6-sol:
      //   none 0 · low 55 · medium 55 · high 68 · xhigh 83 · max 84
      for (const model of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini']) {
        expect(rungs(effortCapability({ provider: 'openai-chatgpt', model }))).toContain('pro');
      }
      // Fail-closed below 5.4: never probed on this account's route, never offered.
      expect(rungs(effortCapability({ provider: 'openai-chatgpt', model: 'gpt-5.1' }))).not.toContain('pro');
    });

    test('no other family claims a top gear it has not proven', () => {
      expect(rungs(effortCapability({ provider: 'anthropic', model: 'claude-opus-4-8' }))).not.toContain('pro');
      expect(rungs(effortCapability({ provider: 'xai', model: 'grok-3-mini' }))).not.toContain('pro');
      expect(rungs(effortCapability({ provider: 'llama-server', model: 'gemma-4-31b-it' }, true))).not.toContain('pro');
      expect(rungs(effortCapability({ provider: 'openai', model: 'gpt-4o' }))).not.toContain('pro');
    });

    test("Z.ai's GLM line has the whole ladder, under Z.AI's words", () => {
      // Probed live 2026-07-29 on zai-coding-plan/glm-5.2: every one of
      // none/low/medium/high/xhigh/max is ACCEPTED, and 'none' spends 0
      // reasoning tokens where the rungs above spend hundreds.
      for (const provider of ['z-ai', 'zai-coding-plan']) {
        const cap = effortCapability({ provider, model: 'glm-5.2' });
        expect(cap.channel).toBe('reasoning-effort');
        expect(rungs(cap)).toEqual([...EFFORT_LADDER]);
        // Z.AI's own picker is a rung menu (High · Max) with a DEEP THINK
        // toggle — the exact two controls modelled here. The endpoint honors
        // three more rungs than the picker names (measured 2026-07-30:
        // low 150 · medium 338 · high 261 · xhigh 355 · max 259 reasoning
        // tokens), so they are offered too; 'none' spends 0.
        expect(labels(cap)).toEqual(['LOW', 'MEDIUM', 'HIGH', 'XHIGH', 'MAX']);
        expect(cap.thinking).toBe(true);
        expect(cap.thinkingLabel).toBe('DEEP THINK');
      }
      // The family is what carries the ladder, across the plan's model spread.
      for (const model of ['glm-4.6', 'glm-5.1', 'glm-4.5-air', 'glm-5-turbo']) {
        expect(effortCapability({ provider: 'zai-coding-plan', model }).channel).toBe('reasoning-effort');
      }
      // A non-GLM model on the same door still gets no invented ladder.
      expect(effortCapability({ provider: 'z-ai', model: 'something-else' }).channel).toBe('none');
    });

    test('Anthropic expresses the ladder as a thinking budget, the switch as the block itself', () => {
      const cap = effortCapability({ provider: 'anthropic', model: 'claude-opus-4-8' });
      expect(cap.channel).toBe('thinking-budget');
      expect(rungs(cap)).toEqual(['low', 'medium', 'high', 'ultra']);
      // Extended thinking is Anthropic's own published control — the block is
      // present or absent — so the switch renders under their word for it.
      expect(cap.thinking).toBe(true);
      expect(cap.thinkingLabel).toBe('EXTENDED THINKING');
    });

    test('xAI is grounded PER MODEL, because its refusals fall per model', () => {
      // Probed value by value on this account 2026-07-30. This lane refuses what
      // it does not support, so its own 400s draw every line below.
      const sol = effortCapability({ provider: 'xai', model: 'grok-4.5' });
      expect(sol.channel).toBe('reasoning-effort');
      expect(rungs(sol)).toEqual(['low', 'medium', 'high', 'ultra']);
      expect(labels(sol)).toEqual(['LOW', 'MEDIUM', 'HIGH', 'XHIGH']);
      // grok-4.5: […]
      expect(sol.thinking).toBe(false);

      // grok-4.3 answers 'none' with 200 AND reasoning_tokens 0 — a real switch.
      const g43 = effortCapability({ provider: 'xai', model: 'grok-4.3' });
      expect(rungs(g43)).toEqual(['low', 'medium', 'high', 'ultra']);
      expect(g43.thinking).toBe(true);

      // 'max' is refused on both, so neither is offered a top gear.
      expect(rungs(sol)).not.toContain('pro');
      expect(rungs(g43)).not.toContain('pro');

      // The mini family keeps its earlier grounding: low|high, no switch.
      const mini = effortCapability({ provider: 'xai', model: 'grok-3-mini' });
      expect(rungs(mini)).toEqual(['low', 'high']);
      expect(mini.thinking).toBe(false);
    });

    test('every other Grok model gets NOTHING — the lane says so itself', () => {
      // […] (400), and for the
      // Heavy mode: […].
      for (const model of [
        'grok-4.20-0309-reasoning', 'grok-4.20-0309-non-reasoning',
        'grok-4.20-multi-agent-0309', 'grok-build-0.1', 'grok-4', 'grok-imagine-video',
      ]) {
        expect(effortCapability({ provider: 'xai', model }).channel).toBe('none');
      }
    });

    test("Grok's own picker is a MODEL menu, so it changes nothing here", () => {
      // SuperGrok: Auto · Fast · Expert · Heavy · Build. Heavy IS the multi-agent
      // model and Build IS grok-build-0.1 — the MODEL dropdown mirrors that menu,
      // and none of it is an effort rung.
      expect(rungs(effortCapability({ provider: 'xai', model: 'grok-build-0.1' }))).toEqual([]);
      expect(rungs(effortCapability({ provider: 'xai', model: 'grok-4.20-multi-agent-0309' }))).toEqual([]);
    });

    test('Kimi: the vendor-documented three rungs beside the proven switch', () => {
      // The vendor contract (kimi.com/code/docs, re-read 2026-09-23): k3,
      // k3-256k and kimi-for-coding take low|high|max. Confirmed live
      // (scripts/kimi-effort-probe.mjs): every rung accepted beside the
      // turn's real temperature, 'disabled' buys zero thinking tokens
      // (12/12); bands overlap, so rungs are honored, not claimed ranked.
      // Highspeed (K2.7) has no rungs and no proven switch (K2.7 is
      // documented to 400 on thinking.disabled) — NO_EFFORT there.
      const kimi = effortCapability({ provider: 'kimi-for-coding', model: 'k3' });
      expect(kimi.channel).toBe('kimi-effort');
      expect(rungs(kimi)).toEqual(['low', 'medium', 'pro']);
      expect(kimi.labels.medium).toBe('HIGH');
      expect(kimi.labels.pro).toBe('MAX');
      expect(kimi.thinking).toBe(true);
      for (const model of ['k3-256k', 'kimi-for-coding']) {
        expect(rungs(effortCapability({ provider: 'kimi-for-coding', model })))
          .toEqual(['low', 'medium', 'pro']);
      }
      expect(effortCapability({ provider: 'kimi-for-coding', model: 'kimi-for-coding-highspeed' }).channel)
        .toBe('none');
    });

    test('speaking the Anthropic WIRE is not being Anthropic', () => {
      // Eight doors share that dialect. Handing them Anthropic's budget ladder is
      // exactly how Kimi came to show four rungs that changed nothing, so only
      // Anthropic itself gets it and the rest fail closed until probed.
      expect(effortCapability({ provider: 'anthropic', model: 'claude-opus-4-8' }).channel)
        .toBe('thinking-budget');
      for (const provider of ['minimax', 'minimax-coding-plan', 'freemodel', 'subconscious', 'thinkingmachines']) {
        expect(effortCapability({ provider, model: 'whatever-1' }).channel).toBe('none');
      }
    });

    test('every ladder is ordered weakest-first, so the dropdown reads as a ladder', () => {
      const routes = [
        { route: { provider: 'openai-chatgpt', model: 'gpt-5.6-sol' } },
        { route: { provider: 'zai-coding-plan', model: 'glm-5.2' } },
        { route: { provider: 'anthropic', model: 'claude-opus-4-8' } },
        { route: { provider: 'xai', model: 'grok-3-mini' } },
        { route: { provider: 'kimi-for-coding', model: 'k3' } },
        { route: { provider: 'llama-server', model: 'gemma-4-31b-it' }, thinks: true },
      ];
      for (const { route, thinks } of routes) {
        const positions = effortCapability(route, thinks === true).tiers.map((r) => EFFORT_LADDER.indexOf(r));
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
        expect(positions).not.toContain(-1);
      }
    });

    test('every offered rung carries a label — no bare rung id ever reaches the desk', () => {
      const cap = effortCapability({ provider: 'openai-chatgpt', model: 'gpt-5.6-sol' });
      expect(labels(cap).filter(Boolean)).toHaveLength(cap.tiers.length);
    });

    test('an unknown provider/model reports no ladder rather than inventing one', () => {
      expect(effortCapability({ provider: 'groq', model: 'something-new' }).channel).toBe('none');
      expect(effortCapability({}).channel).toBe('none');
      expect(effortCapability(null).channel).toBe('none');
    });
  });

  describe('normalizeChoice', () => {
    const full = effortCapability({ provider: 'anthropic', model: 'claude-opus-4-8' });
    const sol = effortCapability({ provider: 'openai-chatgpt', model: 'gpt-5.6-sol' });
    const narrow = effortCapability({ provider: 'xai', model: 'grok-3-mini' });
    const local = effortCapability({ provider: 'llama-server', model: 'gemma-4-31b-it' }, true);
    const none = effortCapability({ provider: 'openai', model: 'gpt-4o' });

    test('no stored choice sits on the default rung, thinking ON', () => {
      expect(normalizeChoice(full, null)).toEqual({ effort: DEFAULT_EFFORT, thinking: true });
    });

    test('a stored rung is honored, case-insensitively', () => {
      expect(normalizeChoice(full, { effort: 'HIGH' })).toEqual({ effort: 'high', thinking: true });
      expect(normalizeChoice(sol, { effort: 'pro' })).toEqual({ effort: 'pro', thinking: true });
    });

    test('thinking can be turned OFF only where the route can be told to stop', () => {
      expect(normalizeChoice(sol, { effort: 'high', thinking: false }).thinking).toBe(false);
      expect(normalizeChoice(full, { effort: 'high', thinking: false }).thinking).toBe(false);
      // A local room ladder cannot be switched off — it reads ON, which is true.
      expect(normalizeChoice(local, { effort: 'high', thinking: false }).thinking).toBe(true);
      // Nor can codex, which answers 400 to the off value.
      const codex = effortCapability({ provider: 'openai-chatgpt', model: 'gpt-5.3-codex-spark' });
      expect(normalizeChoice(codex, { effort: 'high', thinking: false }).thinking).toBe(true);
    });

    test('the rung SURVIVES the switch — turning thinking back on restores it', () => {
      // The two controls are independent: switching off must not erase which
      // rung the operator chose, or coming back would land somewhere else.
      expect(normalizeChoice(sol, { effort: 'pro', thinking: false }))
        .toEqual({ effort: 'pro', thinking: false });
    });

    test('a rung the route lacks falls to the nearest one it has', () => {
      // grok-3-mini has no MEDIUM; the default lands on the adjacent LOW.
      expect(normalizeChoice(narrow, { effort: 'medium' }).effort).toBe('low');
      expect(normalizeChoice(narrow, { effort: 'high' }).effort).toBe('high');
      // The gears above HIGH fall back to HIGH where they do not exist...
      expect(normalizeChoice(narrow, { effort: 'pro' }).effort).toBe('high');
      expect(normalizeChoice(local, { effort: 'ultra' }).effort).toBe('high');
      // ...and Anthropic keeps ULTRA but has no PRO above it.
      expect(normalizeChoice(full, { effort: 'pro' }).effort).toBe('ultra');
    });

    test("the one-list hour's 'none' rung reads as thinking OFF, not as a rung", () => {
      // For an hour on 2026-07-30 thinking-off was written as `effort: 'none'`.
      // Those records must not resolve to a rung nobody has.
      expect(normalizeChoice(sol, { effort: 'none' }))
        .toEqual({ effort: DEFAULT_EFFORT, thinking: false });
      // And on a route with no switch it reads as the honest truth: it reasons.
      expect(normalizeChoice(local, { effort: 'none' }))
        .toEqual({ effort: DEFAULT_EFFORT, thinking: true });
    });

    test('a record from the CHIP era folds into the ladder', () => {
      // Written before 2026-07-30 as {effort, ultra, pro, thinking}. A being left
      // on PRO must come back on PRO, not silently drop to its rung.
      expect(normalizeChoice(sol, { effort: 'high', pro: true }).effort).toBe('pro');
      expect(normalizeChoice(sol, { effort: 'high', ultra: true }).effort).toBe('ultra');
      // The old flags outrank the old rung, exactly as the old bar behaved:
      // PRO first, then ULTRA. The switch was always its own field.
      expect(normalizeChoice(sol, { effort: 'low', ultra: true, pro: true }).effort).toBe('pro');
      expect(normalizeChoice(sol, { effort: 'low', pro: true, thinking: false }))
        .toEqual({ effort: 'pro', thinking: false });
      // And a folded rung the route lacks still narrows to the nearest.
      expect(normalizeChoice(local, { effort: 'low', pro: true }).effort).toBe('high');
    });

    test('a route with no ladder yields no rung at all', () => {
      expect(normalizeChoice(none, { effort: 'high' })).toEqual({ effort: null, thinking: false });
    });

    test('the Kimi default rung is the vendor default — house medium, wire high', () => {
      const kimi = effortCapability({ provider: 'kimi-for-coding', model: 'k3' });
      expect(normalizeChoice(kimi, null)).toEqual({ effort: 'medium', thinking: true });
      expect(normalizeChoice(kimi, { effort: 'pro', thinking: false }))
        .toEqual({ effort: 'pro', thinking: false });
    });

    test('garbage in the store falls to the default rung, never through', () => {
      expect(normalizeChoice(full, { effort: 'wild' }).effort).toBe(DEFAULT_EFFORT);
      expect(normalizeChoice(full, { effort: 42 }).effort).toBe(DEFAULT_EFFORT);
      expect(normalizeChoice(full, {}).effort).toBe(DEFAULT_EFFORT);
    });
  });

  describe('effortDirective', () => {
    test('the ladder AND the switch ride one field on the OpenAI wires', () => {
      // The values this wire honors, weakest to strongest. Every one was sent
      // live 2026-07-29 and changed the reasoning spent.
      const cap = effortCapability({ provider: 'openai-chatgpt', model: 'gpt-5.6-sol' });
      const value = (effort, thinking = true) => effortDirective(cap, { effort, thinking }).value;
      // Thinking off is a VALUE of the same field — measured 0 reasoning tokens
      // 2026-07-30 — which is why the switch needs no field of its own.
      expect(value('pro', false)).toBe('none');
      expect(value('low')).toBe('low');
      expect(value('medium')).toBe('medium');
      expect(value('high')).toBe('high');
      expect(value('ultra')).toBe('xhigh');
      expect(value('pro')).toBe('max');
      expect(effortDirective(cap, { effort: 'high', thinking: true }).channel).toBe('responses-effort');
    });

    test('the OpenAI chat wire takes the same values on its own channel', () => {
      const cap = effortCapability({ provider: 'openai', model: 'gpt-5.6-sol' });
      expect(effortDirective(cap, { effort: 'ultra', thinking: true }))
        .toEqual({ channel: 'reasoning-effort', value: 'xhigh' });
      expect(effortDirective(cap, { effort: 'ultra', thinking: false }))
        .toEqual({ channel: 'reasoning-effort', value: 'none' });
    });

    test("'minimal' is never sent — the schema lists it, every model refuses it", () => {
      // The 400 a bad rung earns names the FIELD SCHEMA, not the model's set:
      // 'minimal' appears there but answers "Unsupported value" on every model
      // probed (2026-07-29), so no rung may ever produce it.
      for (const provider of ['openai-chatgpt', 'openai', 'zai-coding-plan']) {
        const model = provider === 'zai-coding-plan' ? 'glm-5.2' : 'gpt-5.6-sol';
        const cap = effortCapability({ provider, model });
        for (const rung of EFFORT_LADDER) {
          for (const thinking of [true, false]) {
            const directive = effortDirective(cap, normalizeChoice(cap, { effort: rung, thinking }));
            expect(directive.value).not.toBe('minimal');
          }
        }
      }
    });

    test('GLM sends the whole ladder on its one validated field', () => {
      const cap = effortCapability({ provider: 'zai-coding-plan', model: 'glm-5.2' });
      const value = (choice) => effortDirective(cap, normalizeChoice(cap, choice)).value;
      expect(value({ effort: 'medium' })).toBe('medium');
      expect(value({ effort: 'ultra' })).toBe('xhigh');
      expect(value({ effort: 'pro' })).toBe('max');
      // DEEP THINK off — 0 reasoning tokens, measured 2026-07-30.
      expect(value({ effort: 'high', thinking: false })).toBe('none');
    });

    test('thinking OFF on the Anthropic wire sends NO thinking block at all', () => {
      const cap = effortCapability({ provider: 'anthropic', model: 'claude-opus-4-8' });
      expect(effortDirective(cap, { effort: 'high', thinking: false })).toBeNull();
      expect(effortThinkBudget(cap, { effort: 'high', thinking: false })).toBeNull();
    });

    test('Anthropic: the rung becomes a token budget that grows with the ladder', () => {
      const cap = effortCapability({ provider: 'anthropic', model: 'claude-opus-4-8' });
      const high = effortDirective(cap, { effort: 'high', thinking: true });
      const ultra = effortDirective(cap, { effort: 'ultra', thinking: true });
      expect(high.channel).toBe('thinking-budget');
      expect(high.value).toBeGreaterThanOrEqual(1024);
      expect(ultra.value).toBeGreaterThan(high.value);
    });

    test('Kimi: rung and switch ride one thinking block', () => {
      const kimi = effortCapability({ provider: 'kimi-for-coding', model: 'k3' });
      expect(effortDirective(kimi, { effort: 'low', thinking: true }))
        .toEqual({ channel: 'kimi-effort', value: 'low' });
      expect(effortDirective(kimi, { effort: 'medium', thinking: true }))
        .toEqual({ channel: 'kimi-effort', value: 'high' });
      expect(effortDirective(kimi, { effort: 'pro', thinking: true }))
        .toEqual({ channel: 'kimi-effort', value: 'max' });
      expect(effortDirective(kimi, { effort: 'medium', thinking: false }))
        .toEqual({ channel: 'kimi-effort', value: 'disabled' });
      // And it buys no reasoning ROOM — the lane reasons within its own
      // accounting, like the OpenAI wires.
      expect(effortThinkBudget(kimi, { effort: 'pro', thinking: true })).toBeNull();
    });

    test('a local substrate puts NOTHING on the wire — its knob is room, not a field', () => {
      const cap = effortCapability({ provider: 'llama-server', model: 'gemma-4-31b-it' }, true);
      expect(effortDirective(cap, { effort: 'high', thinking: true })).toBeNull();
    });

    test('no ladder, no directive', () => {
      const cap = effortCapability({ provider: 'openai', model: 'gpt-4o' });
      expect(effortDirective(cap, { effort: null, thinking: false })).toBeNull();
    });
  });

  describe('effortThinkBudget', () => {
    test('local rungs buy strictly more room as they climb', () => {
      const cap = effortCapability({ provider: 'llama-server', model: 'gemma-4-31b-it' }, true);
      const room = (effort) => effortThinkBudget(cap, { effort, thinking: true });
      expect(room('low')).toBeLessThan(room('medium'));
      expect(room('medium')).toBeLessThan(room('high'));
    });

    test('the Anthropic budget must also be granted as room (max_tokens exceeds it)', () => {
      const cap = effortCapability({ provider: 'anthropic', model: 'claude-opus-4-8' });
      expect(effortThinkBudget(cap, { effort: 'medium', thinking: true }))
        .toBe(effortDirective(cap, { effort: 'medium', thinking: true }).value);
    });

    test('OpenAI bills reasoning inside its own cap — no extra room', () => {
      const cap = effortCapability({ provider: 'openai', model: 'gpt-5' });
      expect(effortThinkBudget(cap, { effort: 'high', thinking: true })).toBeNull();
    });
  });

  describe('reasoningRoom', () => {
    test("the chosen rung's room wins", () => {
      expect(reasoningRoom({ thinkBudget: 16384, thinks: true, defaultRoom: 1800 })).toBe(16384);
    });
    test('no rung: a thinking substrate keeps its default room', () => {
      expect(reasoningRoom({ thinkBudget: null, thinks: true, defaultRoom: 1800 })).toBe(1800);
    });
    test('no rung, no thinking: nothing extra is bought', () => {
      expect(reasoningRoom({ thinkBudget: null, thinks: false, defaultRoom: 1800 })).toBe(0);
    });
  });

  describe('resolveEffort', () => {
    test('composes the whole picture for a real local route', () => {
      const resolved = resolveEffort(
        { provider: 'llama-server', model: 'gemma-4-31b-it' },
        { effort: 'ultra' },   // a rung this route does not have
        true,
      );
      expect(resolved.capability.channel).toBe('think-budget');
      expect(resolved.choice).toEqual({ effort: 'high', thinking: true });
      expect(resolved.directive).toBeNull();
      expect(resolved.thinkBudget).toBeGreaterThan(0);
    });

    test('composes the whole picture for a real cloud reasoning route', () => {
      const resolved = resolveEffort({ provider: 'openai', model: 'gpt-5.6-sol' }, { effort: 'ultra' }, false);
      expect(resolved.directive).toEqual({ channel: 'reasoning-effort', value: 'xhigh' });
      expect(resolved.thinkBudget).toBeNull();
    });
  });
});
