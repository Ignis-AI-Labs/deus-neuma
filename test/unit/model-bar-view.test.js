/**
 * The composer's model bar — pure shaping, called with the real shapes the
 * backend returns (backend/services/being-inference.js) and no DOM.
 *
 * What matters here is what the operator SEES: the model they ride is never
 * missing from its own dropdown, the loaded weights are marked, and a control
 * with nothing honest to offer stands down instead of rendering an empty ladder.
 */
import { describe, expect, test } from 'vitest';
import {
  currentModelId, modelBarOptions, modelPlaceholder, effortOptions,
  effortAbsenceNote, modelBarState, asIgniteModels, mergeIgniteView,
} from '../../frontend/app/RelinkShell/model-bar-view.js';

// The exact shape /api/v1/inference/:id/models returns for the rig's own weights.
const LOCAL_MODELS = Object.freeze({
  route: { provider: 'llama-server', model: 'gemma-4-31b-it-Q8_0', kind: 'local', sovereign: true },
  switchBy: 'ignite',
  loadedId: 'gemma/gemma-4-31b-it-Q8_0',
  models: [
    { id: 'gemma/gemma-4-31b-it-Q8_0', name: 'gemma-4-31b-it-Q8_0', sizeBytes: 34 * 2 ** 30 },
    { id: 'qwen/qwen3.5-122b-a10b', name: 'qwen3.5-122b-a10b', sizeBytes: 61 * 2 ** 30 },
  ],
});

const CLOUD_MODELS = Object.freeze({
  route: { provider: 'openai-chatgpt', model: 'gpt-5.6-sol', kind: 'cloud', sovereign: false },
  switchBy: 'route',
  loadedId: null,
  models: [{ id: 'gpt-5.6-sol', name: 'gpt-5.6-sol' }, { id: 'gpt-5', name: 'GPT-5' }],
});

describe('model-bar-view', () => {
  describe('currentModelId', () => {
    test('on the rig, the LOADED catalog entry is what the being rides', () => {
      // The route names the SERVED model id ('gemma-4-31b-it-Q8_0'); the picker
      // chooses among catalog ids ('gemma/gemma-4-31b-it-Q8_0'). Mixing the two
      // would leave the trigger matching no option at all.
      expect(currentModelId(LOCAL_MODELS)).toBe('gemma/gemma-4-31b-it-Q8_0');
    });

    test('weights served from outside the catalog fall back to the served name', () => {
      expect(currentModelId({ ...LOCAL_MODELS, loadedId: null })).toBe('gemma-4-31b-it-Q8_0');
    });

    test("off the rig, the route's model IS the option id", () => {
      expect(currentModelId(CLOUD_MODELS)).toBe('gpt-5.6-sol');
    });
  });

  describe('modelBarOptions', () => {
    test('the loaded weights are marked, with their size', () => {
      const options = modelBarOptions(LOCAL_MODELS);
      expect(options).toHaveLength(2);
      expect(options[0].label).toBe('gemma-4-31b-it-Q8_0 · 34.0G · LOADED');
      expect(options[1].label).toBe('qwen3.5-122b-a10b · 61.0G');
    });

    test('a display name distinct from the id is shown', () => {
      expect(modelBarOptions(CLOUD_MODELS).map((o) => o.label)).toEqual(['gpt-5.6-sol', 'GPT-5']);
    });

    test('the model the being rides is present even when unpublished', () => {
      const view = { ...CLOUD_MODELS, route: { ...CLOUD_MODELS.route, model: 'gpt-5.4-private' } };
      const options = modelBarOptions(view);
      expect(options[0]).toEqual({ value: 'gpt-5.4-private', label: 'gpt-5.4-private' });
      expect(options).toHaveLength(3);
    });

    test('no view, no options — never a crash', () => {
      expect(modelBarOptions(null)).toEqual([]);
      expect(modelBarOptions({})).toEqual([]);
      expect(modelBarOptions({ models: [{ name: 'no id' }] })).toEqual([]);
    });
  });

  describe('modelPlaceholder', () => {
    test("the being's own model is the placeholder while the list loads", () => {
      expect(modelPlaceholder(LOCAL_MODELS)).toBe('gemma-4-31b-it-Q8_0');
    });
    test('a being with no resolvable route says so', () => {
      expect(modelPlaceholder(null)).toBe('no model');
    });
  });

  describe('asIgniteModels', () => {
    test('the substrate catalog view becomes the bar\'s ignite shape', () => {
      const view = asIgniteModels({
        active: 'gemma/gemma-4-31b-it-Q8_0',
        models: LOCAL_MODELS.models,
        withheld: 34,
        provider: 'llama-server',
      });
      expect(view.switchBy).toBe('ignite');
      expect(view.loadedId).toBe('gemma/gemma-4-31b-it-Q8_0');
      expect(view.withheld).toBe(34);
      expect(view.route).toMatchObject({ model: 'gemma/gemma-4-31b-it-Q8_0', kind: 'local' });
    });
    test('null stays null', () => {
      expect(asIgniteModels(null)).toBeNull();
    });

    test('mergeIgniteView prefers the LIVE loaded row over a stale being snapshot', () => {
      const stale = { ...LOCAL_MODELS, loadedId: 'gemma/gemma-4-31b-it-Q8_0' };
      const live = {
        active: 'qwen/qwen3.8-27B-Q8_0',
        models: [
          { id: 'gemma/gemma-4-31b-it-Q8_0', name: 'gemma-4-31b-it-Q8_0' },
          { id: 'qwen/qwen3.8-27B-Q8_0', name: 'qwen3.8-27B-Q8_0' },
        ],
        withheld: 34,
        provider: 'llama-server',
      };
      const merged = mergeIgniteView(stale, live);
      expect(merged.loadedId).toBe('qwen/qwen3.8-27B-Q8_0');
      expect(merged.switchBy).toBe('ignite');
      expect(currentModelId(merged)).toBe('qwen/qwen3.8-27B-Q8_0');
      expect(modelBarOptions(merged).find((o) => o.value === merged.loadedId).label).toMatch(/LOADED/);
    });
  });

  describe('effortOptions', () => {
    test('exactly the rungs the route offers, in ladder order', () => {
      expect(effortOptions({ tiers: ['low', 'medium', 'high'] }).map((o) => o.label))
        .toEqual(['LOW', 'MEDIUM', 'HIGH']);
      expect(effortOptions({ tiers: ['low', 'high'] }).map((o) => o.value)).toEqual(['low', 'high']);
    });

    test('the gears above HIGH are RUNGS in the list, never chips beside it', () => {
      // Design note, 2026-07-30: […]
      const chatgpt = {
        tiers: ['low', 'medium', 'high', 'ultra', 'pro'],
        labels: { low: 'LIGHT', medium: 'MEDIUM', high: 'HIGH', ultra: 'EXTRA HIGH', pro: 'MAX' },
      };
      expect(effortOptions(chatgpt)).toEqual([
        { value: 'low', label: 'LIGHT' },
        { value: 'medium', label: 'MEDIUM' },
        { value: 'high', label: 'HIGH' },
        { value: 'ultra', label: 'EXTRA HIGH' },
        { value: 'pro', label: 'MAX' },
      ]);
      // …and nothing in the list is an OFF state. That is the switch's job.
      expect(effortOptions(chatgpt).map((o) => o.value)).not.toContain('none');
    });

    test("each rung reads in the VENDOR's word, and falls back rather than inventing", () => {
      // Z.AI's picker: High, Max, Deep Think — never our ULTRA/PRO.
      const glm = effortOptions({ tiers: ['high', 'pro'], labels: { pro: 'MAX' } });
      expect(glm.map((o) => o.label)).toEqual(['HIGH', 'MAX']);
      // A vendor with no word of its own keeps the rung's own name.
      expect(effortOptions({ tiers: ['ultra'] }).map((o) => o.label)).toEqual(['ULTRA']);
    });

    test('no ladder, no options', () => {
      expect(effortOptions({ channel: 'none', tiers: [] })).toEqual([]);
      expect(effortOptions(null)).toEqual([]);
    });
  });

  describe('effortAbsenceNote', () => {
    test('a local substrate that does not think says what it does not do', () => {
      expect(effortAbsenceNote({ channel: 'none', tiers: [] }, { kind: 'local' }))
        .toMatch(/does not think/);
    });
    test('a cloud model with no tiers says the model publishes none', () => {
      expect(effortAbsenceNote({ channel: 'none', tiers: [] }, { kind: 'cloud' }))
        .toMatch(/publishes no effort tiers/);
    });
    test('a live ladder needs no note', () => {
      expect(effortAbsenceNote({ channel: 'think-budget', tiers: ['low'] }, { kind: 'local' })).toBe('');
    });
  });

  describe('modelBarState', () => {
    const LOCAL_EFFORT = Object.freeze({
      route: LOCAL_MODELS.route,
      capability: { channel: 'think-budget', tiers: ['low', 'medium', 'high'], labels: {}, thinking: false },
      choice: { effort: 'medium', thinking: true },
      chosen: false,
      thinks: true,
    });

    test('a local being: model + effort, and no switch it cannot honor', () => {
      const bar = modelBarState({ beingId: 'fenna-1', models: LOCAL_MODELS, effort: LOCAL_EFFORT });
      expect(bar.show).toBe(true);
      expect(bar.model.value).toBe('gemma/gemma-4-31b-it-Q8_0'); // the loaded catalog entry
      expect(bar.model.switchBy).toBe('ignite');
      expect(bar.effort.value).toBe('medium');
      // The ULTRA and PRO chips are gone for good — those are rungs now. The
      // THINKING switch stands only where the wire proved it, and reasoning ROOM
      // on the rig's own serving is not such a wire.
      expect(bar.thinking.show).toBe(false);
      expect(bar.withheld).toBe(0);
      expect(Object.keys(bar)).toEqual(['show', 'withheld', 'model', 'effort', 'thinking']);
    });

    test('the substrate surface stands without a being — model list, no effort write', () => {
      const bar = modelBarState({
        surface: 'substrate',
        models: { ...LOCAL_MODELS, withheld: 34 },
      });
      expect(bar.show).toBe(true);
      expect(bar.model.value).toBe('gemma/gemma-4-31b-it-Q8_0');
      expect(bar.model.switchBy).toBe('ignite');
      expect(bar.effort.options).toEqual([]);
      expect(bar.withheld).toBe(34);
    });

    test('a witness on a ChatGPT model: the gears are RUNGS in the one dropdown', () => {
      const bar = modelBarState({
        beingId: 'witness-openai-chatgpt-Basunor',
        models: CLOUD_MODELS,
        effort: {
          route: CLOUD_MODELS.route,
          capability: {
            channel: 'responses-effort',
            tiers: ['low', 'medium', 'high', 'ultra', 'pro'],
            labels: { low: 'LIGHT', medium: 'MEDIUM', high: 'HIGH', ultra: 'EXTRA HIGH', pro: 'MAX' },
            thinking: true,
            thinkingLabel: 'THINKING',
          },
          choice: { effort: 'ultra', thinking: true },
        },
      });
      expect(bar.effort.value).toBe('ultra');
      expect(bar.effort.options.map((o) => o.label))
        .toEqual(['LIGHT', 'MEDIUM', 'HIGH', 'EXTRA HIGH', 'MAX']);
      expect(bar.thinking).toEqual({ show: true, on: true, label: 'THINKING' });
      expect(bar.model.switchBy).toBe('route');
    });

    test('the switch reads OFF, and the rung it would return to is still shown', () => {
      const bar = modelBarState({
        beingId: 'witness-zai-Bizulen',
        models: CLOUD_MODELS,
        effort: {
          route: CLOUD_MODELS.route,
          capability: {
            channel: 'reasoning-effort',
            tiers: ['low', 'medium', 'high', 'ultra', 'pro'],
            labels: { ultra: 'XHIGH', pro: 'MAX' },
            thinking: true,
            thinkingLabel: 'DEEP THINK',
          },
          choice: { effort: 'pro', thinking: false },
        },
      });
      // The switch stays visible — that is how thinking gets turned back on —
      // and the rung survives underneath it.
      expect(bar.thinking).toEqual({ show: true, on: false, label: 'DEEP THINK' });
      expect(bar.effort.value).toBe('pro');
    });

    test('a narrower model offers a shorter ladder — the control follows the model', () => {
      // Founder's explicit ask: […] codex-spark refuses 'none' and 'max'.
      const bar = modelBarState({
        beingId: 'witness-openai-chatgpt-Basunor',
        models: CLOUD_MODELS,
        effort: {
          route: CLOUD_MODELS.route,
          capability: {
            channel: 'responses-effort',
            tiers: ['low', 'medium', 'high', 'ultra'],
            labels: { low: 'LIGHT', medium: 'MEDIUM', high: 'HIGH', ultra: 'EXTRA HIGH' },
            thinking: false,
          },
          choice: { effort: 'high', thinking: true },
        },
      });
      expect(bar.effort.options.map((o) => o.value)).toEqual(['low', 'medium', 'high', 'ultra']);
      // codex refuses the off value, so it is offered no switch either.
      expect(bar.thinking.show).toBe(false);
    });

    test('the kimi lane: the vendor\'s three rungs beside the proven switch', () => {
      // LOW · HIGH · MAX in the vendor's own words (house rungs low/medium/pro),
      // the default sitting on the vendor default. The switch stays: turning
      // reasoning off is the one control measured to zero (12/12 live).
      const bar = modelBarState({
        beingId: 'witness-kimi-Kaze',
        models: CLOUD_MODELS,
        effort: {
          route: { ...CLOUD_MODELS.route, provider: 'kimi-for-coding', model: 'k3' },
          capability: {
            channel: 'kimi-effort', tiers: ['low', 'medium', 'pro'],
            labels: { low: 'LOW', medium: 'HIGH', pro: 'MAX' },
            thinking: true, thinkingLabel: 'THINKING',
          },
          choice: { effort: 'medium', thinking: true },
        },
      });
      expect(bar.effort.options.map((o) => o.label)).toEqual(['LOW', 'HIGH', 'MAX']);
      expect(bar.effort.value).toBe('medium');
      expect(bar.effort.note).toBe('');
      expect(bar.thinking).toEqual({ show: true, on: true, label: 'THINKING' });
    });

    test('no being (the council room): the bar does not render', () => {
      expect(modelBarState({ beingId: null, models: LOCAL_MODELS, effort: LOCAL_EFFORT }).show).toBe(false);
    });

    test('a being whose route did not resolve keeps a visible recovery surface', () => {
      const bar = modelBarState({ beingId: 'fenna-1', models: null, effort: null });
      expect(bar.show).toBe(true);
      expect(bar.model.options).toEqual([]);
      expect(bar.effort.options).toEqual([]);
    });

    test('effort still shows while the model list is in flight', () => {
      const bar = modelBarState({ beingId: 'fenna-1', models: null, effort: LOCAL_EFFORT });
      expect(bar.show).toBe(true);
      expect(bar.model.placeholder).toBe('gemma-4-31b-it-Q8_0');
      expect(bar.effort.options).toHaveLength(3);
    });
  });
});

// THE VENDOR'S OWN WORDS reach the operator. Design note, 2026-07-29: […] One ladder used to be stamped on every model, so a GLM operator read
// ULTRA and PRO for gears Z.AI calls Max and Deep Think.
describe('modelBarState — the ladder carries the vendor labels', () => {
  const barFor = (capability) => modelBarState({
    beingId: 'b', models: { route: { provider: 'p', model: 'm' } },
    effort: { capability, choice: { effort: 'medium', thinking: true } },
  });

  test("Z.AI's gears and switch are named the way Z.AI names them", () => {
    const bar = barFor({
      channel: 'reasoning-effort',
      tiers: ['low', 'medium', 'high', 'ultra', 'pro'],
      labels: { ultra: 'XHIGH', pro: 'MAX' },
      thinking: true,
      thinkingLabel: 'DEEP THINK',
    });
    expect(bar.effort.options.map((o) => o.label))
      .toEqual(['LOW', 'MEDIUM', 'HIGH', 'XHIGH', 'MAX']);
    expect(bar.thinking.label).toBe('DEEP THINK');
  });

  test('a vendor with no word of its own keeps the house word', () => {
    // Absence must fall back, never invent something vendor-sounding.
    const bar = barFor({ channel: 'reasoning-effort', tiers: ['low', 'ultra'], thinking: true });
    expect(bar.effort.options.map((o) => o.label)).toEqual(['LOW', 'ULTRA']);
    expect(bar.thinking.label).toBe('THINKING');
  });
});
