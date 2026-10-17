import { expect, test } from 'vitest';
import { retiredToolHint } from '../../backend/services/intents/retired-tools.js';

test('retired channel families name their intent, including channels without exact table entries', () => {
  expect(retiredToolHint('social/queue_post_to_linkedin')).toContain('"type": "social/queue"');
  expect(retiredToolHint('post_to_discord')).toContain('"type": "social/post"');
  expect(retiredToolHint('queue_update_to_x')).toBeNull();
  expect(retiredToolHint('')).toBeNull();
});
