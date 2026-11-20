const CHANNEL = '<|channel|>';
const END = '<|end|>';
const MESSAGE = '<|message|>';
const TARGET = /\bto=([^\s<]+)/;

/** Read each gpt-oss channel once, retaining its target and message payload. Pure. */
export const gptOssChannelSegments = (text) => {
  const segments = [];
  let from = 0;
  while (from < text.length) {
    const start = text.indexOf(CHANNEL, from);
    if (start === -1) break;
    const body = start + CHANNEL.length;
    const nextChannel = text.indexOf(CHANNEL, body);
    const endMarker = text.indexOf(END, body);
    const end = Math.min(nextChannel === -1 ? text.length : nextChannel, endMarker === -1 ? text.length : endMarker);
    const message = text.indexOf(MESSAGE, body);
    if (message !== -1 && message < end) {
      const target = TARGET.exec(text.slice(body, message))?.[1];
      if (target) segments.push({ target, rest: text.slice(message + MESSAGE.length, end) });
    }
    from = end;
  }
  return segments;
};
