/** Mounted behind workspace authentication and its :id ownership gate. */
import { searchChatContents } from '../services/chat-content-search.js';
import { createLogger } from '../services/logger.js';
const log = createLogger('ChatSearch');

/** impure — validate the query, cancel disconnected scans, expose read failures. */
export const handleChatSearch = async (req, res) => {
  const query = req.query.q;
  if (typeof query !== 'string' || query.length > 200) {
    return res.status(400).json({ error: 'Search must be text of at most 200 characters.' });
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  res.once('close', cancel);
  res.set('Cache-Control', 'no-store');
  try {
    const matches = await searchChatContents(req.params.id, query, controller.signal);
    if (!controller.signal.aborted) res.json({ matches });
  } catch (error) {
    if (controller.signal.aborted) return;
    log.warn('Chat search could not read history', { neumaId: req.params.id, error: error.message });
    res.status(500).json({ error: 'Chat history could not be searched. Please retry.' });
  } finally {
    res.off('close', cancel);
  }
};
