#!/usr/bin/env node
// serve.mjs — serves the bake-off samples dir on localhost and keeps what Founder
// decides: the pages POST their state to /save/<name> and it lands in
// <samples>/feedback/<name>.json, so ratings and voice picks reach the
// next step without an export/download round-trip.
//
//   node scripts/voice-bakeoff/serve.mjs [--samples <dir>] [--port 8765]

import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { arg } from './args.mjs';

const root = resolve(arg('--samples', join(import.meta.dirname, '../../voice-engines/_samples/bakeoff-2026-09-30')));
const port = Number(arg('--port', 8765));
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.wav': 'audio/wav', '.flac': 'audio/flac', '.mp3': 'audio/mpeg' };

const save = (req, res, name) => {
  if (!/^[\w-]{1,64}$/.test(name)) return res.writeHead(400).end();
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 1 << 20) req.destroy(); });
  req.on('end', () => {
    try {
      const parsed = JSON.parse(body);
      mkdirSync(join(root, 'feedback'), { recursive: true });
      writeFileSync(join(root, 'feedback', `${name}.json`), JSON.stringify({ saved: new Date().toISOString(), ...parsed }, null, 2));
      res.writeHead(204).end();
    } catch { res.writeHead(400).end(); }
  });
};

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && url.pathname.startsWith('/save/')) return save(req, res, url.pathname.slice(6));
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end();
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(root, rel);
  if (!file.startsWith(root)) return res.writeHead(403).end();
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) return res.writeHead(404).end();
  const { size } = statSync(file);
  const type = TYPES[extname(file)] || 'application/octet-stream';
  // byte ranges, so the browser can seek inside a clip
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
    return req.method === 'HEAD' ? res.end() : createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
  return req.method === 'HEAD' ? res.end() : createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`bake-off on http://127.0.0.1:${port}/ (feedback → ${join(root, 'feedback')})`));
