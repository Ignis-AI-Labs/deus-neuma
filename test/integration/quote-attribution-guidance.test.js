// Real template files through the production model-facing catalog; no rendering
// or model-compliance claim. This guards delivery of #423's attribution rule.
import { expect, test } from 'vitest';
import { loadTemplate } from '../../backend/services/branding/brand-tokens.js';
import { describeCards } from '../../backend/services/branding/card-tool.js';

test('quote source and speaker guidance reach the card catalog unchanged', async () => {
  const template = await loadTemplate('quote');
  expect(template.ok).toBe(true);
  const { lineOne, speaker } = template.spec.fields;
  expect(lineOne.label).toContain('published quote or words supplied verbatim by the operator');
  expect(lineOne.label).toContain('Never invent or paraphrase words and attribute them to a person');
  expect(lineOne.label).toContain('request a shorter sourced excerpt instead of rewriting it');
  expect(speaker.label).toContain('actual speaker named by the source or operator');
  const catalog = await describeCards();
  expect(catalog).toContain(lineOne.label);
  expect(catalog).toContain(speaker.label);
});
