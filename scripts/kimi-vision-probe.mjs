// kimi-vision-probe.mjs — can the Kimi coding lane SEE images?
//
// The desk refuses image sends for this lane because the capability registry
// has no k3 entry and the hand table's kimi row says vision: false — data,
// not measurement. Same doctrine as the effort probe: measure the wire, then
// write what it proves.
//
//   node scripts/kimi-vision-probe.mjs                       → probe k3
//   KIMI_PROBE_MODEL=kimi-for-coding node ...                → probe K2.7
//   KIMI_PROBE_MODEL=k3-256k node ...                        → probe 256k
//
// Sends ONE small red PNG as an anthropic image block and asks for its color.
// Read-only probe: it sends questions, it changes nothing.

import path from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(REPO, '.env') });

const { resolveUsableCredential } = await import(path.join(REPO, 'backend/services/oauth-token-broker.js'));

const MODEL = process.env.KIMI_PROBE_MODEL || 'k3';

// A 96x96 solid-red PNG, hand-built (no image deps).
const redPng = () => {
  const w = 96; const h = 96;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y += 1) {
    const row = y * (1 + w * 3);
    raw[row] = 0; // filter: none
    for (let x = 0; x < w; x += 1) {
      const p = row + 1 + x * 3;
      raw[p] = 255; raw[p + 1] = 0; raw[p + 2] = 0;
    }
  }
  const chunk = (type, data) => {
    const buf = Buffer.alloc(12 + data.length);
    buf.writeUInt32BE(data.length, 0);
    buf.write(type, 4, 'ascii');
    data.copy(buf, 8);
    buf.writeUInt32BE(zlib.crc32(buf.subarray(4, 8 + data.length)) >>> 0, 8 + data.length);
    return buf;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit, truecolor
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
};

const cred = await resolveUsableCredential('kimi-for-coding');
if (!cred?.apiKey) {
  console.error('no usable credential for kimi-for-coding');
  process.exit(1);
}

const response = await fetch(`${cred.endpoint}/messages`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': cred.apiKey,
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model: MODEL,
    max_tokens: 64,
    stream: false,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: redPng() } },
        { type: 'text', text: 'Look at this image. Reply with exactly one word: the dominant color.' },
      ],
    }],
  }),
});
const body = await response.json().catch(() => null);
const text = (body?.content || []).map((b) => (b.type === 'text' ? b.text : `[${b.type}]`)).join('');
console.log(`model=${MODEL} status=${response.status}`);
console.log(`answer: ${text || JSON.stringify(body?.error ?? body)?.slice(0, 300)}`);
