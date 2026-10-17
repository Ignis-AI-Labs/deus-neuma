/** Real encrypted session records; no provider or GPU invoked. */
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createHarnessTurnKit } from '../helpers/harness-turn-kit.js';
import workspace from '../../core/workspace/neuma-workspace.js';
import { loadRecentImageMessages, recentImageMessages } from '../../backend/services/recent-image-turn.js';
import { solidPngDataUri } from '../helpers/image-fixtures.js';
const images = [solidPngDataUri([255, 0, 0]), solidPngDataUri([0, 0, 255])];
let kit;
beforeEach(async () => { kit = await createHarnessTurnKit('witness-test-MultiImage'); });
afterEach(async () => { await kit?.close(); });

test('both stored images remain visible on a follow-up and never cross sessions', async () => {
  await workspace.appendTurnPoint(kit.laneId, kit.connection.sessionId,
    { role: 'user', content: 'Compare these', images }, 'images-turn');
  const messages = await loadRecentImageMessages(kit.laneId, kit.connection.sessionId, [], true);
  expect(messages).toHaveLength(1);
  expect(messages[0].content.filter((p) => p.type === 'image_url').map((p) => p.image_url.url)).toEqual(images);
  expect(await loadRecentImageMessages(kit.laneId, 'another-session', [], true)).toEqual([]);
  expect(await loadRecentImageMessages(kit.laneId, kit.connection.sessionId, [images[0]], true)).toEqual([]);
  expect((await loadRecentImageMessages(kit.laneId, kit.connection.sessionId, [], false))[0].content).toMatch(/cannot see/);
});

test('replay is limited to the latest batch inside the recent window', () => {
  const records = [{ role: 'user', content: 'old', images: [images[0]] }, { role: 'user', content: 'new', images }];
  const parts = recentImageMessages(records, true)[0].content;
  expect(parts.filter((p) => p.type === 'image_url')).toHaveLength(2);
  expect(recentImageMessages([...records, ...Array.from({ length: 10 }, () => ({ role: 'assistant', content: 'later' }))], true)).toEqual([]);
  expect(recentImageMessages([{ role: 'user', content: 'over cap', images: Array(5).fill(images[0]) }], true)[0].content).toMatch(/not replayed/);
});

test('branch-selection bookkeeping does not age visible image records out', () => {
  const records = [
    { role: 'user', content: 'compare', images, turnId: 'image-turn' },
    { role: 'assistant', content: 'first', turnId: 'image-turn', takeIndex: 1 },
    { role: 'assistant', content: 'second', turnId: 'image-turn', takeIndex: 2 },
    ...Array.from({ length: 12 }, () => ({ role: 'system', branchView: { 'image-turn': 1 } })),
  ];
  const messages = recentImageMessages(records, true);
  expect(messages).toHaveLength(1);
  expect(messages[0].content.filter((part) => part.type === 'image_url').map((part) => part.image_url.url)).toEqual(images);
});
