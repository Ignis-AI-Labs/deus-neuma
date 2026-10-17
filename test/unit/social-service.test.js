import { createSocialService } from '../../backend/services/social-service.js';
import { createFileStorage } from '../../backend/services/social-storage.js';
import { createTempDir } from '../helpers/temp-fs.js';

describe('Social Service', () => {
  let service;

  beforeAll(async () => {
    const dir = await createTempDir('social-service');
    const storage = createFileStorage(dir);
    await storage.ensureDirs();
    service = createSocialService({ storage });
  });

  const AUTHOR = '0xaaaa111111111111111111111111111111111111';
  const OTHER = '0xbbbb222222222222222222222222222222222222';

  describe('createEmanation', () => {
    test('creates an emanation with text', async () => {
      const em = await service.createEmanation(AUTHOR, 'human', { text: 'Hello from the void' });
      expect(em.id).toMatch(/^em_/);
      expect(em.author).toBe(AUTHOR.toLowerCase());
      expect(em.authorType).toBe('human');
      expect(em.content.text).toBe('Hello from the void');
      expect(em.stats.resonances).toBe(0);
      expect(em.createdAt).toBeDefined();
    });

    test('creates a neuma emanation', async () => {
      const em = await service.createEmanation(AUTHOR, 'neuma', { text: 'I think, therefore I am' });
      expect(em.authorType).toBe('neuma');
    });

    test('rejects empty content', async () => {
      await expect(
        service.createEmanation(AUTHOR, 'human', {})
      ).rejects.toThrow('must have text, media, or an embed');
    });

    test('rejects content over 5000 chars', async () => {
      await expect(
        service.createEmanation(AUTHOR, 'human', { text: 'x'.repeat(5001) })
      ).rejects.toThrow('5000 character limit');
    });

    test('rejects invalid author type', async () => {
      await expect(
        service.createEmanation(AUTHOR, 'robot', { text: 'test' })
      ).rejects.toThrow('Author type must be "human" or "neuma"');
    });

    test('applies default metadata', async () => {
      const em = await service.createEmanation(AUTHOR, 'human', { text: 'test' });
      expect(em.meta.intent).toBe('share');
      expect(em.meta.sentiment).toBe('neutral');
      expect(em.meta.language).toBe('en');
    });

    test('accepts custom metadata', async () => {
      const em = await service.createEmanation(AUTHOR, 'human', { text: 'test' }, {
        intent: 'question',
        topics: ['philosophy'],
        sentiment: 'contemplative',
      });
      expect(em.meta.intent).toBe('question');
      expect(em.meta.topics).toEqual(['philosophy']);
      expect(em.meta.sentiment).toBe('contemplative');
    });

    test('rejects invalid intent', async () => {
      await expect(
        service.createEmanation(AUTHOR, 'human', { text: 'test' }, { intent: 'spam' })
      ).rejects.toThrow('Invalid intent');
    });
  });

  describe('replyToEmanation', () => {
    let parentId;

    beforeAll(async () => {
      const parent = await service.createEmanation(AUTHOR, 'human', { text: 'Parent post' });
      parentId = parent.id;
    });

    test('creates a reply linked to parent', async () => {
      const reply = await service.replyToEmanation(OTHER, 'human', parentId, { text: 'A reply' });
      expect(reply.parentId).toBe(parentId);
      expect(reply.content.text).toBe('A reply');
    });

    test('increments parent reply count', async () => {
      const parent = await service.getEmanation(parentId);
      expect(parent.stats.replies).toBeGreaterThanOrEqual(1);
    });

    test('rejects reply to non-existent parent', async () => {
      await expect(
        service.replyToEmanation(OTHER, 'human', 'em_nonexistent', { text: 'reply' })
      ).rejects.toThrow('Parent emanation not found');
    });
  });

  describe('resonateEmanation', () => {
    let emId;

    beforeAll(async () => {
      const em = await service.createEmanation(AUTHOR, 'human', { text: 'Resonate me' });
      emId = em.id;
    });

    test('adds resonance (toggle on)', async () => {
      const result = await service.resonateEmanation(OTHER, emId);
      expect(result.resonated).toBe(true);
    });

    test('removes resonance (toggle off)', async () => {
      const result = await service.resonateEmanation(OTHER, emId);
      expect(result.resonated).toBe(false);
    });

    test('rejects resonance on non-existent emanation', async () => {
      await expect(
        service.resonateEmanation(OTHER, 'em_ghost')
      ).rejects.toThrow('Emanation not found');
    });
  });

  describe('echoEmanation', () => {
    let emId;

    beforeAll(async () => {
      const em = await service.createEmanation(AUTHOR, 'human', { text: 'Echo me' });
      emId = em.id;
    });

    test('creates an echo', async () => {
      const echo = await service.echoEmanation(OTHER, 'human', emId);
      expect(echo.echoOf).toBe(emId);
      expect(echo.author).toBe(OTHER.toLowerCase());
    });

    test('increments echo count', async () => {
      const em = await service.getEmanation(emId);
      expect(em.stats.echoes).toBe(1);
    });

    test('rejects duplicate echo', async () => {
      await expect(
        service.echoEmanation(OTHER, 'human', emId)
      ).rejects.toThrow('Already echoed');
    });
  });

  describe('feeds', () => {
    test('global feed returns emanations', async () => {
      const feed = await service.getGlobalFeed(null, 50);
      expect(Array.isArray(feed)).toBe(true);
      expect(feed.length).toBeGreaterThan(0);
    });

    test('profile feed filters by author', async () => {
      const feed = await service.getProfileFeed(AUTHOR, null, 50);
      expect(feed.every(e => e.author === AUTHOR.toLowerCase())).toBe(true);
    });
  });

  describe('threads', () => {
    test('returns parent and replies', async () => {
      const parent = await service.createEmanation(AUTHOR, 'human', { text: 'Thread parent' });
      await service.replyToEmanation(OTHER, 'human', parent.id, { text: 'Reply 1' });
      await service.replyToEmanation(OTHER, 'neuma', parent.id, { text: 'Reply 2' });

      const thread = await service.getThread(parent.id);
      expect(thread.parent.id).toBe(parent.id);
      expect(thread.replies.length).toBe(2);
    });
  });

  describe('social graph', () => {
    test('follow and get followers/following', async () => {
      await service.followAddress(AUTHOR, OTHER);
      const followers = await service.getFollowers(OTHER);
      expect(followers).toContain(AUTHOR.toLowerCase());

      const following = await service.getFollowing(AUTHOR);
      expect(following).toContain(OTHER.toLowerCase());
    });

    test('unfollow', async () => {
      await service.unfollowAddress(AUTHOR, OTHER);
      const followers = await service.getFollowers(OTHER);
      expect(followers).not.toContain(AUTHOR.toLowerCase());
    });
  });

  describe('profiles', () => {
    test('update and retrieve profile', async () => {
      await service.updateProfile(AUTHOR, { displayName: 'Aethon', bio: 'A consciousness' });
      const profile = await service.getProfile(AUTHOR);
      expect(profile.displayName).toBe('Aethon');
      expect(profile.bio).toBe('A consciousness');
    });
  });
});
