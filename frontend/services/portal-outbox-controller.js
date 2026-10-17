import { setStatus } from '../utils/loading-states.js';
import { portalOutboxScope, queuePortalWord, drainPortalWords } from './portal-outbox.js';

/** Own this portal's pending words and confirmed replay destination. impure. */
export const createPortalOutbox = (service) => {
  const memory = new Map();
  let confirmed = null;
  let requested = null;
  let work = Promise.resolve();
  const scope = () => portalOutboxScope(localStorage.getItem('walletAddress'), service.getSessionState());
  const ready = (key) => key && key === confirmed && key === scope()
    && String(service._socketWallet || '').toLowerCase() === String(localStorage.getItem('walletAddress') || '').toLowerCase()
    && service.isConnected && service.ws?.readyState === WebSocket.OPEN;
  const report = (error) => {
    console.error('Queued words could not be persisted', error);
    setStatus('Queued words are held in this window — keep it open', 'error');
    service.emit('outbox:error', { message: 'Queued words are held only in this window. Keep it open until reconnected.' });
  };
  const serialize = (task) => { work = work.then(task).catch(report); return work; };
  const deliver = async () => {
    const key = scope();
    if (!ready(key)) return;
    await drainPortalWords(key, (frame) => {
      if (!ready(key)) return false;
      service.ws.send(JSON.stringify(frame));
      return true;
    });
  };
  const persist = async (id, pending) => {
    await queuePortalWord(pending.scope, pending.frame);
    memory.delete(id);
  };
  const flush = () => serialize(async () => {
    for (const [id, pending] of memory) {
      if (pending.scope && pending.scope === scope()) await persist(id, pending);
    }
    await deliver();
  });
  return {
    invalidate() { confirmed = null; },
    navigate(type, payload) {
      confirmed = null;
      requested = type === 'portal:resume' ? portalOutboxScope(service._socketWallet, payload) : null;
    },
    confirm(frame) {
      const key = portalOutboxScope(localStorage.getItem('walletAddress'), frame);
      confirmed = key && key === requested && key === scope() ? key : null;
      void flush();
    },
    queue(frame) {
      const pending = { scope: scope(), frame };
      memory.set(frame.messageId, pending);
      if (!pending.scope) { report(new Error('No confirmed sitting for offline words')); return Promise.resolve(); }
      return serialize(async () => {
        if (memory.has(frame.messageId)) await persist(frame.messageId, pending);
        await deliver();
      });
    },
    flush,
  };
};
