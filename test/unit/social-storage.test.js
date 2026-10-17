import { createFileStorage } from '../../backend/services/social-storage.js';
import { createTempDir } from '../helpers/temp-fs.js';

describe('Social Storage (file-based)', () => {
  let storage;

  beforeAll(async () => {
    const dir = await createTempDir('social-storage');
    storage = createFileStorage(dir);
    await storage.ensureDirs();
  });

  const makeEmanation = (overrides = {}) => ({
    id: `em_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    author: '0xabcdef1234567890abcdef1234567890abcdef12',
    authorType: 'human',
    content: { text: 'Test emanation', media: [], embed: null },
    meta: { intent: 'share', topics: [], sentiment: 'neutral', summary: '', language: 'en', contentWarning: null },
    stats: { resonances: 0, echoes: 0, replies: 0, views: 0 },
    signature: null,
    parentId: null,
    echoOf: null,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    ...overrides,
  });

  describe('emanations', () => {
    test('save and retrieve an emanation', async () => {
      const em = makeEmanation();
      await storage.saveEmanation(em);
      const retrieved = await storage.getEmanation(em.id);
      expect(retrieved).toEqual(em);
    });

    test('returns null for non-existent emanation', async () => {
      const result = await storage.getEmanation('em_doesnt_exist');
      expect(result).toBe(null);
    });

    test('update an emanation', async () => {
      const em = makeEmanation();
      await storage.saveEmanation(em);

      const updated = await storage.updateEmanation(em.id, { stats: { ...em.stats, resonances: 5 } });
      expect(updated.stats.resonances).toBe(5);
      expect(updated.updatedAt).not.toBe(null);
    });
  });

  describe('feeds', () => {
    test('global feed returns emanations newest first', async () => {
      const em1 = makeEmanation({ id: 'em_feed_1', createdAt: '2026-01-01T00:00:00Z' });
      const em2 = makeEmanation({ id: 'em_feed_2', createdAt: '2026-01-02T00:00:00Z' });
      await storage.saveEmanation(em1);
      await storage.saveEmanation(em2);

      const feed = await storage.getFeed(null, 10);
      const ids = feed.map(e => e.id);
      expect(ids.indexOf('em_feed_2')).toBeLessThan(ids.indexOf('em_feed_1'));
    });

    test('profile feed filters by author', async () => {
      const addr = '0x1111111111111111111111111111111111111111';
      const em = makeEmanation({ id: 'em_profile_1', author: addr });
      await storage.saveEmanation(em);

      const feed = await storage.getProfileFeed(addr, null, 10);
      expect(feed.some(e => e.id === 'em_profile_1')).toBe(true);
      expect(feed.every(e => e.author === addr)).toBe(true);
    });
  });

  describe('threads', () => {
    test('returns parent + replies', async () => {
      const parent = makeEmanation({ id: 'em_thread_parent' });
      const reply = makeEmanation({ id: 'em_thread_reply', parentId: 'em_thread_parent' });
      await storage.saveEmanation(parent);
      await storage.saveEmanation(reply);

      const thread = await storage.getThread('em_thread_parent');
      expect(thread.parent.id).toBe('em_thread_parent');
      expect(thread.replies.some(r => r.id === 'em_thread_reply')).toBe(true);
    });

    test('returns null for non-existent thread', async () => {
      const thread = await storage.getThread('em_nope');
      expect(thread).toBe(null);
    });
  });

  describe('social graph — follow', () => {
    const alice = '0xaaaa000000000000000000000000000000000001';
    const bob = '0xbbbb000000000000000000000000000000000002';

    test('follow and get followers/following', async () => {
      await storage.follow(alice, bob);
      const followers = await storage.getFollowers(bob);
      expect(followers).toContain(alice);
      const following = await storage.getFollowing(alice);
      expect(following).toContain(bob);
    });

    test('duplicate follow returns false', async () => {
      const result = await storage.follow(alice, bob);
      expect(result).toBe(false);
    });

    test('unfollow removes the relationship', async () => {
      await storage.unfollow(alice, bob);
      const followers = await storage.getFollowers(bob);
      expect(followers).not.toContain(alice);
    });
  });

  describe('social graph — resonance', () => {
    test('add and check resonance', async () => {
      const addr = '0xcccc000000000000000000000000000000000003';
      const emId = 'em_resonance_test';
      const em = makeEmanation({ id: emId });
      await storage.saveEmanation(em);

      const added = await storage.addResonance(addr, emId);
      expect(added).toBe(true);

      const has = await storage.hasResonated(addr, emId);
      expect(has).toBe(true);
    });

    test('duplicate resonance returns false', async () => {
      const addr = '0xcccc000000000000000000000000000000000003';
      const result = await storage.addResonance(addr, 'em_resonance_test');
      expect(result).toBe(false);
    });

    test('remove resonance', async () => {
      const addr = '0xcccc000000000000000000000000000000000003';
      await storage.removeResonance(addr, 'em_resonance_test');
      const has = await storage.hasResonated(addr, 'em_resonance_test');
      expect(has).toBe(false);
    });
  });

  describe('profiles', () => {
    test('save and retrieve a profile', async () => {
      const addr = '0xdddd000000000000000000000000000000000004';
      await storage.saveProfile(addr, { displayName: 'TestUser', bio: 'Hello void' });
      const profile = await storage.getProfile(addr);
      expect(profile.displayName).toBe('TestUser');
      expect(profile.bio).toBe('Hello void');
      expect(profile.address).toBe(addr);
    });

    test('returns null for non-existent profile', async () => {
      const profile = await storage.getProfile('0x0000000000000000000000000000000000000000');
      expect(profile).toBe(null);
    });
  });
});
