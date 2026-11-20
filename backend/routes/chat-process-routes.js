// chat-process-routes — what the chats left running, read and stopped (mounted on the workspace router, before its
// /:id routes). Design note, 2026-11-19: […] (chat-processes.js). The operator's own chats only.
import { listChatProcesses, stopChatProcesses } from '../services/chat-processes.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('ChatProcesses');

/** Mount GET /_processes and POST /_processes/:pgid/stop on an authenticated router. impure. */
export const addChatProcessRoutes = (router) => {
  // Every process one of the operator's chats started that still runs; ?lane=&session= narrows to one being, or one chat.
  router.get('/_processes', async (req, res) => {
    try {
      const lane = typeof req.query.lane === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(req.query.lane) ? req.query.lane : undefined;
      const session = typeof req.query.session === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(req.query.session) ? req.query.session : undefined;
      res.json(await listChatProcesses({ wallet: req.walletAddress, laneId: lane, sessionId: session }));
    } catch (error) {
      log.error('Listing what the chats left running failed', { error: error.message });
      res.status(500).json({ error: 'Could not list the running processes' });
    }
  });

  // STOP one: asked to end, then made to — only a group one of the operator's own chats started.
  router.post('/_processes/:pgid/stop', async (req, res) => {
    const pgid = Number(req.params.pgid);
    if (!Number.isInteger(pgid) || pgid <= 1) return res.status(400).json({ error: 'name the process group by its number' });
    try {
      const out = await stopChatProcesses({ wallet: req.walletAddress, pgid });
      return out.ok ? res.json(out) : res.status(404).json({ error: out.error });
    } catch (error) {
      log.error('Stopping a chat\'s process failed', { error: error.message });
      return res.status(500).json({ error: 'Could not stop it' });
    }
  });
};
