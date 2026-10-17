/**
 * Social Service — Core Business Logic
 *
 * Handles emanation creation, validation, social interactions (resonate, echo, reply),
 * and feed generation. Content is structured so any consciousness can navigate it
 * regardless of modality.
 */

import crypto from 'crypto';
import { createFileStorage } from './social-storage.js';
import { getDataRoot } from './data-root.js';
import path from 'path';

const VALID_INTENTS = ['share', 'question', 'announcement', 'creation', 'reflection'];
const VALID_SENTIMENTS = ['positive', 'neutral', 'negative', 'contemplative'];
const VALID_MEDIA_TYPES = ['image', 'video', 'vrm', 'audio'];
const VALID_EMBED_TYPES = ['marketplace_listing', 'emanation', 'encounter_space', 'external'];

/**
 * Generate a unique emanation ID using cryptographic random bytes.
 * @returns {string} ID prefixed with 'em_' followed by 16 base64url characters
 */
const generateId = () => {
  return 'em_' + crypto.randomBytes(12).toString('base64url');
};

/**
 * Create a SHA-256 content hash for cryptographic signing.
 * @param {object} content - Emanation content (text, media, embed)
 * @param {object} meta - Emanation metadata (intent, topics, sentiment)
 * @returns {string} Hex-encoded SHA-256 hash of the canonical JSON
 */
const hashContent = (content, meta) => {
  const canonical = JSON.stringify({ content, meta });
  return crypto.createHash('sha256').update(canonical).digest('hex');
};

/**
 * Validate emanation content fields (text, media, embed).
 * @param {object} content - Content to validate
 * @param {string} [content.text] - Text body (max 5000 chars)
 * @param {Array<{type: string, url: string}>} [content.media] - Media attachments
 * @param {{type: string}} [content.embed] - Embedded content reference
 * @returns {string|null} Error message, or null if valid
 */
const validateContent = (content) => {
  if (!content) return 'Content is required';
  if (!content.text && (!content.media || content.media.length === 0) && !content.embed) {
    return 'Emanation must have text, media, or an embed';
  }
  if (content.text && typeof content.text !== 'string') return 'Text must be a string';
  if (content.text && content.text.length > 5000) return 'Text exceeds 5000 character limit';

  if (content.media) {
    if (!Array.isArray(content.media)) return 'Media must be an array';
    for (const m of content.media) {
      if (!VALID_MEDIA_TYPES.includes(m.type)) return `Invalid media type: ${m.type}`;
      if (!m.url) return 'Media must have a URL';
    }
  }

  if (content.embed) {
    if (!VALID_EMBED_TYPES.includes(content.embed.type)) return `Invalid embed type: ${content.embed.type}`;
  }

  return null;
};

/**
 * Validate emanation metadata fields (intent, sentiment).
 * @param {object} [meta] - Metadata to validate
 * @param {string} [meta.intent] - One of: share, question, announcement, creation, reflection
 * @param {string} [meta.sentiment] - One of: positive, neutral, negative, contemplative
 * @returns {string|null} Error message, or null if valid
 */
const validateMeta = (meta) => {
  if (!meta) return null; // Meta is optional, defaults will be applied
  if (meta.intent && !VALID_INTENTS.includes(meta.intent)) return `Invalid intent: ${meta.intent}`;
  if (meta.sentiment && !VALID_SENTIMENTS.includes(meta.sentiment)) return `Invalid sentiment: ${meta.sentiment}`;
  return null;
};

/**
 * Apply default values to emanation metadata.
 * @param {object} [meta={}] - Partial metadata
 * @returns {{intent: string, topics: string[], sentiment: string, summary: string, language: string, contentWarning: string|null}} Normalized metadata
 */
const normalizeMeta = (meta = {}) => ({
  intent: meta.intent || 'share',
  topics: meta.topics || [],
  sentiment: meta.sentiment || 'neutral',
  summary: meta.summary || '',
  language: meta.language || 'en',
  contentWarning: meta.contentWarning || null,
});

/**
 * Create a social service instance.
 * @param {object} [options]
 * @param {string} [options.dataDir] - Root directory for social data
 * @param {object} [options.storage] - Pre-configured storage adapter (for testing)
 */
export const createSocialService = (options = {}) => {
  const dataDir = options.dataDir || path.join(getDataRoot(), 'weave/social');
  const storage = options.storage || createFileStorage(dataDir);

  /**
   * Create a new emanation (top-level post).
   * @param {string} author - Author wallet address
   * @param {'human'|'neuma'} authorType - Whether the author is human or neuma
   * @param {{text?: string, media?: Array, embed?: object}} content - Emanation content
   * @param {object} [meta={}] - Metadata (intent, topics, sentiment)
   * @param {string|null} [signature=null] - Cryptographic signature of the content
   * @returns {Promise<object>} The created emanation
   * @throws {Error} If content or metadata validation fails, or author is missing
   */
  const createEmanation = async (author, authorType, content, meta = {}, signature = null) => {
    // Validate
    const contentErr = validateContent(content);
    if (contentErr) throw new Error(contentErr);
    const metaErr = validateMeta(meta);
    if (metaErr) throw new Error(metaErr);

    if (!author) throw new Error('Author address is required');
    if (!['human', 'neuma'].includes(authorType)) throw new Error('Author type must be "human" or "neuma"');

    const emanation = {
      id: generateId(),
      author: author.toLowerCase(),
      authorType,
      content: {
        text: content.text || null,
        media: content.media || [],
        embed: content.embed || null,
      },
      meta: normalizeMeta(meta),
      stats: { resonances: 0, echoes: 0, replies: 0, views: 0 },
      signature: signature || null,
      parentId: null,
      echoOf: null,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };

    return storage.saveEmanation(emanation);
  };

  /**
   * Reply to an existing emanation, creating a threaded response.
   * @param {string} author - Author wallet address
   * @param {'human'|'neuma'} authorType - Whether the author is human or neuma
   * @param {string} parentId - ID of the parent emanation to reply to
   * @param {{text?: string, media?: Array, embed?: object}} content - Reply content
   * @param {object} [meta={}] - Metadata (intent, topics, sentiment)
   * @param {string|null} [signature=null] - Cryptographic signature
   * @returns {Promise<object>} The created reply emanation
   * @throws {Error} If parent not found or content validation fails
   */
  const replyToEmanation = async (author, authorType, parentId, content, meta = {}, signature = null) => {
    const parent = await storage.getEmanation(parentId);
    if (!parent) throw new Error('Parent emanation not found');

    const contentErr = validateContent(content);
    if (contentErr) throw new Error(contentErr);

    const emanation = {
      id: generateId(),
      author: author.toLowerCase(),
      authorType,
      content: {
        text: content.text || null,
        media: content.media || [],
        embed: content.embed || null,
      },
      meta: normalizeMeta(meta),
      stats: { resonances: 0, echoes: 0, replies: 0, views: 0 },
      signature: signature || null,
      parentId,
      echoOf: null,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };

    await storage.saveEmanation(emanation);

    // Increment parent reply count
    await storage.updateEmanation(parentId, {
      stats: { ...parent.stats, replies: parent.stats.replies + 1 },
    });

    return emanation;
  };

  /**
   * Echo (repost) an emanation to the author's feed.
   * @param {string} author - Author wallet address
   * @param {'human'|'neuma'} authorType - Whether the author is human or neuma
   * @param {string} emanationId - ID of the emanation to echo
   * @returns {Promise<object>} The created echo emanation (with echoOf referencing original)
   * @throws {Error} If emanation not found or already echoed by this author
   */
  const echoEmanation = async (author, authorType, emanationId) => {
    const original = await storage.getEmanation(emanationId);
    if (!original) throw new Error('Emanation not found');

    const added = await storage.addEcho(author, emanationId);
    if (!added) throw new Error('Already echoed');

    // Create an echo emanation that references the original
    const echo = {
      id: generateId(),
      author: author.toLowerCase(),
      authorType,
      content: { text: null, media: [], embed: null },
      meta: normalizeMeta({ intent: 'share' }),
      stats: { resonances: 0, echoes: 0, replies: 0, views: 0 },
      signature: null,
      parentId: null,
      echoOf: emanationId,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };

    await storage.saveEmanation(echo);

    // Increment original echo count
    await storage.updateEmanation(emanationId, {
      stats: { ...original.stats, echoes: original.stats.echoes + 1 },
    });

    return echo;
  };

  /**
   * Toggle resonance (like) on an emanation. If already resonated, removes it.
   * @param {string} address - Wallet address of the resonator
   * @param {string} emanationId - ID of the emanation
   * @returns {Promise<{resonated: boolean}>} Current resonance state after toggle
   * @throws {Error} If emanation not found
   */
  const resonateEmanation = async (address, emanationId) => {
    const emanation = await storage.getEmanation(emanationId);
    if (!emanation) throw new Error('Emanation not found');

    const alreadyResonated = await storage.hasResonated(address, emanationId);

    if (alreadyResonated) {
      await storage.removeResonance(address, emanationId);
      await storage.updateEmanation(emanationId, {
        stats: { ...emanation.stats, resonances: Math.max(0, emanation.stats.resonances - 1) },
      });
      return { resonated: false };
    }

    await storage.addResonance(address, emanationId);
    await storage.updateEmanation(emanationId, {
      stats: { ...emanation.stats, resonances: emanation.stats.resonances + 1 },
    });
    return { resonated: true };
  };

  /**
   * Get the global feed (all emanations, newest first).
   * @param {string|null} cursor - Emanation ID to paginate after, or null for first page
   * @param {number} limit - Max emanations to return
   * @returns {Promise<object[]>} Array of hydrated emanation objects
   */
  const getGlobalFeed = (cursor, limit) => storage.getFeed(cursor, limit);

  /**
   * Get emanations from a specific address.
   * @param {string} address - Wallet address to filter by
   * @param {string|null} cursor - Emanation ID to paginate after
   * @param {number} limit - Max emanations to return
   * @returns {Promise<object[]>} Array of hydrated emanation objects
   */
  const getProfileFeed = (address, cursor, limit) => storage.getProfileFeed(address, cursor, limit);

  /**
   * Get emanations from followed addresses (plus the user's own).
   * @param {string} address - Wallet address whose following list to use
   * @param {string|null} cursor - Emanation ID to paginate after
   * @param {number} limit - Max emanations to return
   * @returns {Promise<object[]>} Array of hydrated emanation objects
   */
  const getFollowingFeed = (address, cursor, limit) => storage.getFollowingFeed(address, cursor, limit);

  /**
   * Get a single emanation by ID.
   * @param {string} id - Emanation ID
   * @returns {Promise<object|null>} The emanation, or null if not found
   */
  const getEmanation = (id) => storage.getEmanation(id);

  /**
   * Get a thread: parent emanation plus all its replies.
   * @param {string} id - Parent emanation ID
   * @returns {Promise<{parent: object, replies: object[]}|null>} Thread data, or null if parent not found
   */
  const getThread = (id) => storage.getThread(id);

  /**
   * Follow an address (subscribe to their emanations).
   * @param {string} follower - Wallet address of the follower
   * @param {string} followed - Wallet address to follow
   * @returns {Promise<boolean>} True if follow was created, false if already following
   */
  const followAddress = (follower, followed) => storage.follow(follower, followed);

  /**
   * Unfollow an address.
   * @param {string} follower - Wallet address of the follower
   * @param {string} followed - Wallet address to unfollow
   * @returns {Promise<boolean>} True when complete
   */
  const unfollowAddress = (follower, followed) => storage.unfollow(follower, followed);

  /**
   * Get all followers of an address.
   * @param {string} address - Wallet address to query
   * @returns {Promise<string[]>} Array of follower wallet addresses
   */
  const getFollowers = (address) => storage.getFollowers(address);

  /**
   * Get all addresses followed by a given address.
   * @param {string} address - Wallet address to query
   * @returns {Promise<string[]>} Array of followed wallet addresses
   */
  const getFollowing = (address) => storage.getFollowing(address);

  /**
   * Get a user's public profile.
   * @param {string} address - Wallet address
   * @returns {Promise<object|null>} Profile data, or null if not found
   */
  const getProfile = (address) => storage.getProfile(address);

  /**
   * Update a user's public profile (merge with existing data).
   * @param {string} address - Wallet address
   * @param {object} data - Profile fields to update
   * @returns {Promise<object>} Merged profile data
   */
  const updateProfile = (address, data) => storage.saveProfile(address, data);

  return Object.freeze({
    createEmanation,
    replyToEmanation,
    echoEmanation,
    resonateEmanation,
    getGlobalFeed,
    getProfileFeed,
    getFollowingFeed,
    getEmanation,
    getThread,
    followAddress,
    unfollowAddress,
    getFollowers,
    getFollowing,
    getProfile,
    updateProfile,
    // Expose for testing
    hashContent,
  });
};
