// Workspace Memory Routes — the memory / observations / entity / graph
// endpoints, extracted verbatim from workspace-routes.js (size-law breakdown)
// as a sub-router mounted inside it. The parent supplies requireAuth on the
// shared router; the ownership gate is passed into this factory because
// Express param callbacks are per-router — the parent's `router.param('id')`
// never fires for routes declared here.

import { Router } from 'express';
import { default as workspace } from '../../core/workspace/neuma-workspace.js';
import { readContextMapField } from '../services/context-map.js';
import { readAtlasMemory, readMemoryAtlasPage, searchMemoryAtlas } from '../services/memory-atlas.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Workspace');

export const createWorkspaceMemoryRouter = (requireOwnership) => {
  const router = Router();

  // Apply ownership check to all routes with :id param
  router.param('id', (req, res, next) => {
    requireOwnership(req, res, next);
  });

  router.get('/:id/memory', async (req, res) => {
    try {
      const [entities, relations, observations] = await Promise.all([
        workspace.listEntities(req.params.id),
        workspace.readRelations(req.params.id),
        workspace.listObservations(req.params.id),
      ]);
      res.json({ entities, relations, observations });
    } catch (error) {
      log.error('Memory read', { error: error.message });
      res.status(500).json({ error: 'Failed to read memory' });
    }
  });

  router.post('/:id/memory/entity', async (req, res) => {
    try {
      await workspace.writeEntity(req.params.id, req.body.entity);
      res.json({ success: true });
    } catch (error) {
      log.error('Entity write', { error: error.message });
      res.status(500).json({ error: 'Failed to write entity' });
    }
  });

  router.post('/:id/memory/observation', async (req, res) => {
    try {
      const record = await workspace.addObservation(req.params.id, req.body.observation);
      res.json({ success: true, observation: record });
    } catch (error) {
      log.error('Observation', { error: error.message });
      res.status(500).json({ error: 'Failed to add observation' });
    }
  });

  // --- Memory graph (CONTEXT MAP, B-06) ---

  router.get('/:id/memory/graph', async (req, res) => {
    try {
      res.json(await readContextMapField(req.params.id));
    } catch (error) {
      log.error('Memory graph', { error: error.message });
      res.status(500).json({ error: 'Failed to compute memory graph' });
    }
  });

  // --- Memory atlas (CONTEXT MAP · MEMORY): the whole memory by topic, people
  // and period; one memory opened with its source and nearest memories; and a
  // plain every-word search. Counts and bounded lines only on the atlas page —
  // a memory's full text crosses only when that one memory is opened.

  router.get('/:id/memory/atlas', async (req, res) => {
    try {
      res.json(await readMemoryAtlasPage(req.params.id));
    } catch (error) {
      log.error('Memory atlas', { error: error.message });
      res.status(500).json({ error: 'Failed to lay out the memory atlas' });
    }
  });

  router.get('/:id/memory/atlas/search', async (req, res) => {
    try {
      const result = await searchMemoryAtlas(req.params.id, typeof req.query.q === 'string' ? req.query.q : '');
      if (!result.ok) return res.status(400).json({ error: result.reason });
      return res.json({ ids: result.ids, words: result.words });
    } catch (error) {
      log.error('Memory atlas search', { error: error.message });
      return res.status(500).json({ error: 'Failed to search memory' });
    }
  });

  router.get('/:id/memory/atlas/memory/:memoryId', async (req, res) => {
    try {
      if (!/^[a-f0-9]{16}$/.test(req.params.memoryId)) return res.status(400).json({ error: 'not a memory id' });
      const result = await readAtlasMemory(req.params.id, req.params.memoryId);
      if (!result.ok) return res.status(404).json({ error: result.reason });
      const { ok: _ok, ...memory } = result;
      return res.json(memory);
    } catch (error) {
      log.error('Memory atlas read', { error: error.message });
      return res.status(500).json({ error: 'Failed to open that memory' });
    }
  });

  return router;
};
