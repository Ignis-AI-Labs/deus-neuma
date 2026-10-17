/**
 * THE SPEAKING CLOCK (friction-map B4) — server-side wire coalescing for a
 * turn's speech. Providers deliver several deltas per paint; sending each as
 * its own JSON frame made the wire carry ~10× what the desk can paint (the
 * client already coalesces DISPLAY — this coalesces the TRANSPORT). One
 * clock per stream call: chunks accumulate and flush on a 25ms timer (the
 * client's own rAF cadence), and `flush()` runs synchronously at stream end
 * and tool-round boundaries so a turn's last words never trail a chip.
 */
import { safeSend } from './ws-send.js';

/**
 * impure — schedules and sends real portal frames.
 * @param {{ws: import('ws').WebSocket, companionName: string, take: {turnId: string, takeIndex: number}|null}} h
 * @returns {{push: (chunk: string) => void, flush: () => void}}
 */
export const makeSpeechClock = ({ ws, companionName, take }) => {
  let buffer = '';
  let timer = null;
  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!buffer) return;
    const chunk = buffer;
    buffer = '';
    safeSend(ws, {
      type: 'consciousness:stream',
      content: chunk,
      companion: companionName,
      ...(take ? { turnId: take.turnId, takeIndex: take.takeIndex } : {}),
    });
  };
  return {
    push: (chunk) => {
      buffer += chunk;
      if (!timer) timer = setTimeout(flush, 25);
    },
    flush,
  };
};
