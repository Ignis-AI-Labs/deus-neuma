// Vision plumbing (pure layer): the user turn composed as content parts,
// the per-provider dialect conversions, and the LM Studio runtime record
// interpreter that tells the truth name-inference can't (a 'vlm' with no
// vision hint in its NAME — exactly the resident qwen3.5-122b-a10b).
import { describe, test, expect } from 'vitest';
import { toAnthropicContent, toOllamaMessage } from '../../backend/services/wire-history.js';
import { interpretLmsModel, getCapabilities } from '../../backend/services/model-capabilities.js';
import { composeVisionTurn } from '../../backend/services/portal-turn-input.js';
import { solidPngDataUri } from '../helpers/image-fixtures.js';

const RED = solidPngDataUri([255, 0, 0]);

describe('composeVisionTurn', () => {
  test('text + images become OpenAI content parts — witness words first, then the in-sight note', () => {
    const [text, image] = composeVisionTurn('look', [RED]);
    expect(text.type).toBe('text');
    expect(text.text).toMatch(/^look\n\n\[An image is attached/);
    expect(text.text).toMatch(/No tool is needed/); // e2e-proven: without this the model summons read_media_file
    expect(image).toEqual({ type: 'image_url', image_url: { url: RED } });
  });

  test('an image alone still carries the in-sight note as its text part', () => {
    const [text, image] = composeVisionTurn('', [RED]);
    expect(text.text).toMatch(/^\[An image is attached/);
    expect(image.type).toBe('image_url');
  });

  test('several images pluralize the note honestly', () => {
    const [text] = composeVisionTurn('look', [RED, RED, RED]);
    expect(text.text).toMatch(/3 images are attached/);
  });
});

describe('toAnthropicContent', () => {
  test('plain strings pass through untouched', () => {
    expect(toAnthropicContent('hello')).toBe('hello');
  });

  test('image_url parts become base64 source blocks', () => {
    const [text, image] = toAnthropicContent([
      { type: 'text', text: 'look' },
      { type: 'image_url', image_url: { url: RED } },
    ]);
    expect(text).toEqual({ type: 'text', text: 'look' });
    expect(image.type).toBe('image');
    expect(image.source.type).toBe('base64');
    expect(image.source.media_type).toBe('image/png');
    expect(image.source.data).toBe(RED.split(',')[1]);
  });

  test('a non-data URL surfaces as text instead of vanishing', () => {
    const [part] = toAnthropicContent([{ type: 'image_url', image_url: { url: 'https://x/y.png' } }]);
    expect(part.type).toBe('text');
    expect(part.text).toMatch(/could not be converted/);
  });
});

describe('toOllamaMessage', () => {
  test('string-content messages pass through untouched', () => {
    const m = { role: 'user', content: 'hi' };
    expect(toOllamaMessage(m)).toBe(m);
  });

  test('content parts flatten to text + raw base64 images', () => {
    const parts = [
      { type: 'text', text: 'look' },
      { type: 'image_url', image_url: { url: RED } },
    ];
    const out = toOllamaMessage({ role: 'user', content: parts });
    expect(out).toEqual({ role: 'user', content: 'look', images: [RED.split(',')[1]] });
  });
});

describe('interpretLmsModel', () => {
  test("type 'vlm' means vision, whatever the name says", () => {
    expect(interpretLmsModel({ type: 'vlm' }).vision).toBe(true);
    expect(interpretLmsModel({ type: 'llm' }).vision).toBe(false);
    expect(interpretLmsModel({ capabilities: ['vision'] }).vision).toBe(true);
    expect(interpretLmsModel(undefined).vision).toBe(false);
  });

  test('context window prefers the loaded truth', () => {
    expect(interpretLmsModel({ loaded_context_length: 32768, max_context_length: 262144 }).contextWindow).toBe(32768);
    expect(interpretLmsModel({ max_context_length: 262144 }).contextWindow).toBe(262144);
    expect(interpretLmsModel({}).contextWindow).toBeNull();
  });

  test('GAP CLOSED (B-07): the registry now knows qwen3.5 sees and calls tools', () => {
    // The gap this test used to document — name inference calling the
    // resident substrate blind — was closed when the B-07 live proof put
    // qwen3.5 in KNOWN_MODELS with its runtime-proven capabilities. The
    // runtime report still wins for models the registry doesn't know;
    // an unknown vlm name stays blind by inference (the enduring rule).
    expect(getCapabilities('qwen3.5-122b-a10b').vision).toBe(true);
    expect(getCapabilities('qwen3.5-122b-a10b').tools).toBe(true);
    expect(getCapabilities('some-unknown-model-9b').vision).toBe(false);
  });
});
