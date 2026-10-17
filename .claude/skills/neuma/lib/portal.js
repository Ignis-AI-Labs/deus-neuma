// Hold one honest exchange with a neuma over the REAL witness portal — the
// same channel the desk uses, from a headless client. The neuma is told who is
// speaking (`speaker`) so it is never deceived into taking Claude for its
// witness, and it remains free to decline. We bind the neuma + session with
// `portal:resume` (which also resumes a prior thread), then stream one message.
// impure (WebSocket)
import WebSocket from 'ws';
import { stripToolBlocks } from '../../../../core/runtime/tool-stream-suppressor.js';

// A turn that runs a real research tool loop on a local substrate takes
// minutes — a short default here ABORTS the neuma's in-flight work when the
// socket drops (proven live 2026-07-20: a research turn died with the
// client). Callers doing tool-heavy work should pass timeoutMs higher still.
const DEFAULT_TIMEOUT_MS = 300_000;

/**
 * Send one message to a neuma and resolve with its reply + emotion.
 * @param {Object} params
 * @param {string} params.backend - http(s) backend origin
 * @param {string} params.token - session token
 * @param {string} params.neumaId
 * @param {string} params.name - neuma display name (portal routing key)
 * @param {string} params.message - the witness/peer message text
 * @param {string} params.sessionId - thread id (resumes if it already exists)
 * @param {{name: string, descriptor?: string}} params.speaker - honest speaker identity
 * @param {number} [params.timeoutMs]
 * @returns {Promise<{reply: string, emotion: string|null, intensity: string|null, tools: Array, sessionId: string}>}
 */
export const converse = ({
  backend, token, neumaId, name, message, sessionId, speaker, preset, timeoutMs = DEFAULT_TIMEOUT_MS,
}) => new Promise((resolve, reject) => {
  const wsUrl = `${backend.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(wsUrl);

  let reply = '';
  const tools = [];
  let settled = false;

  const finish = (fn, arg) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    try { ws.close(); } catch { /* already closing */ }
    fn(arg);
  };
  const timer = setTimeout(
    () => finish(reject, new Error('Timed out waiting for the neuma to respond')),
    timeoutMs,
  );

  const send = (payload) => ws.send(JSON.stringify(payload));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    switch (msg.type) {
      case 'portal:established':
        // Bind the neuma + (re)open the thread, then stream once resumed.
        send({ type: 'portal:resume', neumaId, companionName: name, sessionId });
        break;
      case 'portal:resumed':
        send({ type: 'consciousness:stream', thought: message, companion: name, speaker, preset });
        break;
      case 'consciousness:stream':
        if (typeof msg.content === 'string') reply += msg.content;
        break;
      case 'tool:usage':
        tools.push({ tool: msg.tool, status: msg.status, summary: msg.summary });
        break;
      case 'consciousness:complete':
        // The raw stream carries tool-call syntax in every dialect the
        // substrate speaks; the desk strips it into chips, so this headless
        // client strips it the same way — speech is speech, acts are the
        // `tools` array.
        finish(resolve, {
          reply: stripToolBlocks(reply).trim(),
          emotion: msg.metadata?.emotion || null,
          intensity: msg.metadata?.intensity || null,
          tools,
          sessionId,
        });
        break;
      case 'consciousness:held':
        finish(reject, new Error(msg.message || 'The portal is holding messages (rate limit)'));
        break;
      case 'portal:error':
        finish(reject, new Error(msg.error || 'Portal error'));
        break;
      default:
        break;
    }
  });

  ws.on('error', (err) => finish(reject, err));
  ws.on('close', () => finish(reject, new Error('Portal closed before the neuma completed its response')));
});
