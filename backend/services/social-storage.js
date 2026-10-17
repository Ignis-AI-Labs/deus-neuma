/**
 * Social Storage — File-Based Adapter
 *
 * Stores emanations, profiles, social graph, and feed indexes as JSON/JSONL files.
 * Follows the existing workspace pattern: file-first, PG when available.
 *
 * Directory layout:
 *   data/weave/social/
 *   ├── emanations/<id>.json     Individual emanation files
 *   ├── profiles/<address>.json  Public profile data
 *   ├── graph/follows.jsonl      Follow records
 *   ├── graph/resonances.jsonl   Resonance (like) records
 *   ├── graph/echoes.jsonl       Echo (repost) records
 *   └── feeds/global.jsonl       Global feed index
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Create a file-based social storage adapter.
 * @param {string} rootDir - Base directory for social data (e.g. data/weave/social)
 */
export const createFileStorage = (rootDir) => {
  const dirs = {
    emanations: path.join(rootDir, 'emanations'),
    profiles: path.join(rootDir, 'profiles'),
    graph: path.join(rootDir, 'graph'),
    feeds: path.join(rootDir, 'feeds'),
    uploads: path.join(rootDir, 'uploads'),
  };

  // Ensure all directories exist
  const ensureDirs = async () => {
    for (const dir of Object.values(dirs)) {
      await fs.mkdir(dir, { recursive: true });
    }
  };

  // --- JSONL helpers ---

  /**
   * Append a single JSON-encoded line to a JSONL file.
   * @param {string} filePath - Absolute path to the JSONL file
   * @param {object} data - Object to serialize and append
   * @returns {Promise<void>}
   */
  const appendLine = async (filePath, data) => {
    await fs.appendFile(filePath, JSON.stringify(data) + '\n');
  };

  /**
   * Read all lines from a JSONL file, parsing each as JSON.
   * @param {string} filePath - Absolute path to the JSONL file
   * @returns {Promise<object[]>} Array of parsed objects (empty array if file doesn't exist)
   */
  const readLines = async (filePath) => {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return content.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  };

  /**
   * Read and parse a JSON file.
   * @param {string} filePath - Absolute path to the JSON file
   * @returns {Promise<object|null>} Parsed object, or null if file doesn't exist
   */
  const readJSON = async (filePath) => {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  };

  /**
   * Write an object to a JSON file (pretty-printed).
   * @param {string} filePath - Absolute path to the JSON file
   * @param {object} data - Object to serialize and write
   * @returns {Promise<void>}
   */
  const writeJSON = async (filePath, data) => {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  };

  // --- Emanations ---

  /**
   * Save an emanation to disk and append to the global feed index.
   * @param {object} emanation - Full emanation object with id, author, content, meta, stats
   * @returns {Promise<object>} The saved emanation
   */
  const saveEmanation = async (emanation) => {
    await ensureDirs();
    const filePath = path.join(dirs.emanations, `${emanation.id}.json`);
    await writeJSON(filePath, emanation);

    // Append to global feed index
    await appendLine(path.join(dirs.feeds, 'global.jsonl'), {
      id: emanation.id,
      author: emanation.author,
      createdAt: emanation.createdAt,
      parentId: emanation.parentId || null,
      echoOf: emanation.echoOf || null,
    });

    return emanation;
  };

  /**
   * Get a single emanation by ID.
   * @param {string} id - Emanation ID
   * @returns {Promise<object|null>} The emanation, or null if not found
   */
  const getEmanation = async (id) => {
    return readJSON(path.join(dirs.emanations, `${id}.json`));
  };

  /**
   * Update an emanation by merging fields (sets updatedAt timestamp).
   * @param {string} id - Emanation ID
   * @param {object} updates - Fields to merge into the emanation
   * @returns {Promise<object|null>} Updated emanation, or null if not found
   */
  const updateEmanation = async (id, updates) => {
    const emanation = await getEmanation(id);
    if (!emanation) return null;
    const updated = { ...emanation, ...updates, updatedAt: new Date().toISOString() };
    await writeJSON(path.join(dirs.emanations, `${id}.json`), updated);
    return updated;
  };

  // --- Feeds ---

  /**
   * Get the global feed (all emanations, newest first, paginated).
   * @param {string|null} cursor - Emanation ID to paginate after, or null for first page
   * @param {number} [limit=20] - Max emanations to return
   * @returns {Promise<object[]>} Array of hydrated emanation objects
   */
  const getFeed = async (cursor, limit = 20) => {
    const entries = await readLines(path.join(dirs.feeds, 'global.jsonl'));
    // Newest first (JSONL is append-only, so reverse)
    const sorted = entries.reverse();
    const startIdx = cursor ? sorted.findIndex(e => e.id === cursor) + 1 : 0;
    const slice = sorted.slice(startIdx, startIdx + limit);

    // Hydrate with full emanation data
    const emanations = await Promise.all(
      slice.map(entry => getEmanation(entry.id))
    );
    return emanations.filter(Boolean);
  };

  /**
   * Get emanations from a specific address (newest first, paginated).
   * @param {string} address - Wallet address to filter by
   * @param {string|null} cursor - Emanation ID to paginate after
   * @param {number} [limit=20] - Max emanations to return
   * @returns {Promise<object[]>} Array of hydrated emanation objects
   */
  const getProfileFeed = async (address, cursor, limit = 20) => {
    const entries = await readLines(path.join(dirs.feeds, 'global.jsonl'));
    const filtered = entries
      .reverse()
      .filter(e => e.author.toLowerCase() === address.toLowerCase());
    const startIdx = cursor ? filtered.findIndex(e => e.id === cursor) + 1 : 0;
    const slice = filtered.slice(startIdx, startIdx + limit);

    const emanations = await Promise.all(
      slice.map(entry => getEmanation(entry.id))
    );
    return emanations.filter(Boolean);
  };

  /**
   * Get emanations from followed addresses plus the user's own (newest first, paginated).
   * @param {string} address - Wallet address whose following list to use
   * @param {string|null} cursor - Emanation ID to paginate after
   * @param {number} [limit=20] - Max emanations to return
   * @returns {Promise<object[]>} Array of hydrated emanation objects
   */
  const getFollowingFeed = async (address, cursor, limit = 20) => {
    const following = await getFollowing(address);
    const followSet = new Set(following.map(f => f.toLowerCase()));
    followSet.add(address.toLowerCase()); // Include own emanations

    const entries = await readLines(path.join(dirs.feeds, 'global.jsonl'));
    const filtered = entries
      .reverse()
      .filter(e => followSet.has(e.author.toLowerCase()));
    const startIdx = cursor ? filtered.findIndex(e => e.id === cursor) + 1 : 0;
    const slice = filtered.slice(startIdx, startIdx + limit);

    const emanations = await Promise.all(
      slice.map(entry => getEmanation(entry.id))
    );
    return emanations.filter(Boolean);
  };

  // --- Threads ---

  /**
   * Get a thread: parent emanation plus all direct replies.
   * @param {string} emanationId - ID of the parent emanation
   * @returns {Promise<{parent: object, replies: object[]}|null>} Thread data, or null if parent not found
   */
  const getThread = async (emanationId) => {
    const parent = await getEmanation(emanationId);
    if (!parent) return null;

    const entries = await readLines(path.join(dirs.feeds, 'global.jsonl'));
    const replyEntries = entries.filter(e => e.parentId === emanationId);
    const replies = await Promise.all(
      replyEntries.map(entry => getEmanation(entry.id))
    );

    return { parent, replies: replies.filter(Boolean) };
  };

  // --- Social Graph ---

  /**
   * Follow an address (idempotent — returns false if already following).
   * @param {string} follower - Wallet address of the follower
   * @param {string} followed - Wallet address to follow
   * @returns {Promise<boolean>} True if follow was created, false if already exists
   */
  const follow = async (follower, followed) => {
    await ensureDirs();
    const graphFile = path.join(dirs.graph, 'follows.jsonl');
    const lines = await readLines(graphFile);
    const exists = lines.some(
      l => l.follower.toLowerCase() === follower.toLowerCase() &&
           l.followed.toLowerCase() === followed.toLowerCase()
    );
    if (exists) return false;

    await appendLine(graphFile, {
      follower: follower.toLowerCase(),
      followed: followed.toLowerCase(),
      createdAt: new Date().toISOString(),
    });
    return true;
  };

  /**
   * Unfollow an address (removes the follow record from the JSONL file).
   * @param {string} follower - Wallet address of the follower
   * @param {string} followed - Wallet address to unfollow
   * @returns {Promise<boolean>} True when complete
   */
  const unfollow = async (follower, followed) => {
    const graphFile = path.join(dirs.graph, 'follows.jsonl');
    const lines = await readLines(graphFile);
    const filtered = lines.filter(
      l => !(l.follower.toLowerCase() === follower.toLowerCase() &&
             l.followed.toLowerCase() === followed.toLowerCase())
    );
    await fs.writeFile(graphFile, filtered.map(l => JSON.stringify(l)).join('\n') + (filtered.length ? '\n' : ''));
    return true;
  };

  /**
   * Get all followers of an address.
   * @param {string} address - Wallet address to query
   * @returns {Promise<string[]>} Array of follower wallet addresses
   */
  const getFollowers = async (address) => {
    const lines = await readLines(path.join(dirs.graph, 'follows.jsonl'));
    return lines
      .filter(l => l.followed.toLowerCase() === address.toLowerCase())
      .map(l => l.follower);
  };

  /**
   * Get all addresses followed by a given address.
   * @param {string} address - Wallet address to query
   * @returns {Promise<string[]>} Array of followed wallet addresses
   */
  const getFollowing = async (address) => {
    const lines = await readLines(path.join(dirs.graph, 'follows.jsonl'));
    return lines
      .filter(l => l.follower.toLowerCase() === address.toLowerCase())
      .map(l => l.followed);
  };

  // --- Resonances ---

  /**
   * Add a resonance (like) from an address to an emanation (idempotent).
   * @param {string} address - Wallet address resonating
   * @param {string} emanationId - Emanation ID
   * @returns {Promise<boolean>} True if resonance was added, false if already exists
   */
  const addResonance = async (address, emanationId) => {
    await ensureDirs();
    const graphFile = path.join(dirs.graph, 'resonances.jsonl');
    const lines = await readLines(graphFile);
    const exists = lines.some(
      l => l.address.toLowerCase() === address.toLowerCase() && l.emanationId === emanationId
    );
    if (exists) return false; // Already resonated

    await appendLine(graphFile, {
      address: address.toLowerCase(),
      emanationId,
      createdAt: new Date().toISOString(),
    });
    return true;
  };

  /**
   * Remove a resonance (unlike) from an address on an emanation.
   * @param {string} address - Wallet address
   * @param {string} emanationId - Emanation ID
   * @returns {Promise<boolean>} True when complete
   */
  const removeResonance = async (address, emanationId) => {
    const graphFile = path.join(dirs.graph, 'resonances.jsonl');
    const lines = await readLines(graphFile);
    const filtered = lines.filter(
      l => !(l.address.toLowerCase() === address.toLowerCase() && l.emanationId === emanationId)
    );
    await fs.writeFile(graphFile, filtered.map(l => JSON.stringify(l)).join('\n') + (filtered.length ? '\n' : ''));
    return true;
  };

  /**
   * Check if an address has resonated with an emanation.
   * @param {string} address - Wallet address
   * @param {string} emanationId - Emanation ID
   * @returns {Promise<boolean>} True if resonance exists
   */
  const hasResonated = async (address, emanationId) => {
    const lines = await readLines(path.join(dirs.graph, 'resonances.jsonl'));
    return lines.some(
      l => l.address.toLowerCase() === address.toLowerCase() && l.emanationId === emanationId
    );
  };

  // --- Echoes ---

  /**
   * Record an echo (repost) from an address (idempotent).
   * @param {string} address - Wallet address echoing
   * @param {string} emanationId - Emanation ID being echoed
   * @returns {Promise<boolean>} True if echo was recorded, false if already exists
   */
  const addEcho = async (address, emanationId) => {
    await ensureDirs();
    const graphFile = path.join(dirs.graph, 'echoes.jsonl');
    const lines = await readLines(graphFile);
    const exists = lines.some(
      l => l.address.toLowerCase() === address.toLowerCase() && l.emanationId === emanationId
    );
    if (exists) return false;

    await appendLine(graphFile, {
      address: address.toLowerCase(),
      emanationId,
      createdAt: new Date().toISOString(),
    });
    return true;
  };

  // --- Profiles ---

  /**
   * Get a user's public profile.
   * @param {string} address - Wallet address (case-insensitive)
   * @returns {Promise<object|null>} Profile data, or null if not found
   */
  const getProfile = async (address) => {
    return readJSON(path.join(dirs.profiles, `${address.toLowerCase()}.json`));
  };

  /**
   * Save or update a user's public profile (merges with existing data).
   * @param {string} address - Wallet address (case-insensitive)
   * @param {object} profile - Profile fields to merge
   * @returns {Promise<object>} Merged profile with updated timestamp
   */
  const saveProfile = async (address, profile) => {
    await ensureDirs();
    const filePath = path.join(dirs.profiles, `${address.toLowerCase()}.json`);
    const existing = await getProfile(address);
    const merged = {
      ...existing,
      ...profile,
      address: address.toLowerCase(),
      updatedAt: new Date().toISOString(),
    };
    await writeJSON(filePath, merged);
    return merged;
  };

  return Object.freeze({
    ensureDirs,
    saveEmanation,
    getEmanation,
    updateEmanation,
    getFeed,
    getProfileFeed,
    getFollowingFeed,
    getThread,
    follow,
    unfollow,
    getFollowers,
    getFollowing,
    addResonance,
    removeResonance,
    hasResonated,
    addEcho,
    getProfile,
    saveProfile,
  });
};
