/**
 * Social API Routes — The Weave Feed
 *
 * REST endpoints for emanations, social graph, profiles, and media uploads.
 * All authenticated routes require Bearer token from /api/auth.
 */

import express from 'express';
import multer from 'multer';
import path from 'path';
import { promises as fs } from 'fs';
import crypto from 'crypto';
import { requireAuth } from '../services/auth.js';
import { createSocialService } from '../services/social-service.js';
import { createLogger } from '../services/logger.js';
import { getDataRoot } from '../services/data-root.js';

const log = createLogger('Social');

const router = express.Router();
const socialService = createSocialService();

// --- Media upload setup ---

const uploadDir = path.join(getDataRoot(), 'weave/social/uploads');

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const id = crypto.randomBytes(12).toString('base64url');
    cb(null, `${id}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.webm', '.mp3', '.ogg', '.vrm'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${ext} not allowed`));
    }
  },
});

// --- Emanation Routes ---

// Create emanation
router.post('/emanations', requireAuth, async (req, res) => {
  try {
    const { content, meta, authorType, signature } = req.body;
    const type = authorType || 'human';

    const emanation = await socialService.createEmanation(
      req.walletAddress, type, content, meta, signature
    );
    res.status(201).json(emanation);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get single emanation
router.get('/emanations/:id', async (req, res) => {
  try {
    const emanation = await socialService.getEmanation(req.params.id);
    if (!emanation) return res.status(404).json({ error: 'Emanation not found' });
    res.json(emanation);
  } catch (error) {
    log.error('Get emanation error', { error: error.message });
    res.status(500).json({ error: 'Failed to read emanation' });
  }
});

// --- Feed Routes ---

// Global feed
router.get('/feed/global', async (req, res) => {
  try {
    const { cursor, limit } = req.query;
    const emanations = await socialService.getGlobalFeed(cursor, Math.min(parseInt(limit) || 20, 100));
    res.json({ emanations, cursor: emanations.length > 0 ? emanations[emanations.length - 1].id : null });
  } catch (error) {
    log.error('Global feed error', { error: error.message });
    res.status(500).json({ error: 'Failed to read feed' });
  }
});

// Following feed
router.get('/feed/following', requireAuth, async (req, res) => {
  try {
    const { cursor, limit } = req.query;
    const emanations = await socialService.getFollowingFeed(
      req.walletAddress, cursor, Math.min(parseInt(limit) || 20, 100)
    );
    res.json({ emanations, cursor: emanations.length > 0 ? emanations[emanations.length - 1].id : null });
  } catch (error) {
    log.error('Following feed error', { error: error.message });
    res.status(500).json({ error: 'Failed to read feed' });
  }
});

// Profile feed
router.get('/feed/profile/:address', async (req, res) => {
  try {
    const { cursor, limit } = req.query;
    const emanations = await socialService.getProfileFeed(
      req.params.address, cursor, Math.min(parseInt(limit) || 20, 100)
    );
    res.json({ emanations, cursor: emanations.length > 0 ? emanations[emanations.length - 1].id : null });
  } catch (error) {
    log.error('Profile feed error', { error: error.message });
    res.status(500).json({ error: 'Failed to read feed' });
  }
});

// --- Thread Route ---

router.get('/thread/:id', async (req, res) => {
  try {
    const thread = await socialService.getThread(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    res.json(thread);
  } catch (error) {
    log.error('Thread read error', { error: error.message });
    res.status(500).json({ error: 'Failed to read thread' });
  }
});

// --- Interaction Routes ---

// Toggle resonance
router.post('/emanations/:id/resonate', requireAuth, async (req, res) => {
  try {
    const result = await socialService.resonateEmanation(req.walletAddress, req.params.id);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Echo (repost)
router.post('/emanations/:id/echo', requireAuth, async (req, res) => {
  try {
    const echo = await socialService.echoEmanation(
      req.walletAddress, req.body.authorType || 'human', req.params.id
    );
    res.status(201).json(echo);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Reply
router.post('/emanations/:id/reply', requireAuth, async (req, res) => {
  try {
    const { content, meta, authorType, signature } = req.body;
    const reply = await socialService.replyToEmanation(
      req.walletAddress, authorType || 'human', req.params.id, content, meta, signature
    );
    res.status(201).json(reply);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// --- Profile Routes ---

router.get('/profile/:address', async (req, res) => {
  try {
    const profile = await socialService.getProfile(req.params.address);
    const followers = await socialService.getFollowers(req.params.address);
    const following = await socialService.getFollowing(req.params.address);
    res.json({
      profile: profile || { address: req.params.address.toLowerCase() },
      followerCount: followers.length,
      followingCount: following.length,
    });
  } catch (error) {
    log.error('Profile read error', { error: error.message });
    res.status(500).json({ error: 'Failed to read profile' });
  }
});

router.put('/profile', requireAuth, async (req, res) => {
  try {
    const { displayName, bio, avatarUrl, mode } = req.body;
    const validModes = ['social', 'marketplace'];
    const profileUpdate = { displayName, bio, avatarUrl };
    if (mode && validModes.includes(mode)) {
      profileUpdate.mode = mode;
    }
    const profile = await socialService.updateProfile(req.walletAddress, profileUpdate);
    res.json(profile);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// --- Social Graph Routes ---

router.post('/follow/:address', requireAuth, async (req, res) => {
  try {
    if (req.walletAddress === req.params.address.toLowerCase()) {
      return res.status(400).json({ error: 'Cannot follow yourself' });
    }
    const result = await socialService.followAddress(req.walletAddress, req.params.address);
    res.json({ followed: result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/follow/:address', requireAuth, async (req, res) => {
  try {
    await socialService.unfollowAddress(req.walletAddress, req.params.address);
    res.json({ unfollowed: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/followers/:address', async (req, res) => {
  try {
    const followers = await socialService.getFollowers(req.params.address);
    res.json({ followers });
  } catch (error) {
    log.error('Followers read error', { error: error.message });
    res.status(500).json({ error: 'Failed to read followers' });
  }
});

router.get('/following/:address', async (req, res) => {
  try {
    const following = await socialService.getFollowing(req.params.address);
    res.json({ following });
  } catch (error) {
    log.error('Following read error', { error: error.message });
    res.status(500).json({ error: 'Failed to read following' });
  }
});

// --- Media Upload ---

router.post('/upload', requireAuth, upload.single('media'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const ext = path.extname(req.file.filename).toLowerCase();
    const typeMap = {
      '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.gif': 'image', '.webp': 'image',
      '.mp4': 'video', '.webm': 'video',
      '.mp3': 'audio', '.ogg': 'audio',
      '.vrm': 'vrm',
    };

    res.json({
      url: `/api/social/media/${req.file.filename}`,
      type: typeMap[ext] || 'image',
      mimeType: req.file.mimetype,
      size: req.file.size,
      filename: req.file.filename,
    });
  } catch (error) {
    log.error('Media upload error', { error: error.message });
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Serve uploaded media
router.use('/media', express.static(uploadDir));

export default router;
