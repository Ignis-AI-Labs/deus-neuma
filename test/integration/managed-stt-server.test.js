/* global process, Buffer */
// Dictation on an installed app, end to end through the real service (managed-stt.js): readiness
// read from the data folder, the server started on first use as a real child process at the
// install path, a real multipart request to it, and the answer shaped like the house's. The
// child is a stand-in for whisper-server (a script answering its /inference contract over real
// HTTP), because what is proven here is the platform's side; the downloaded binary is proven by
// Founder's run. No mocks (RULE 0).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';

let root;
const STANDIN = `#!/usr/bin/env node
const http = require('node:http');
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
const threads = process.argv[process.argv.indexOf('-t') + 1];
http.createServer((req, res) => {
  if (req.method === 'GET') { res.writeHead(200); return res.end('whisper'); }
  let body = Buffer.alloc(0);
  req.on('data', (c) => { body = Buffer.concat([body, c]); });
  req.on('end', () => {
    const s = body.toString('latin1');
    const prompt = (s.match(/name="prompt"\\r\\n\\r\\n([^\\r]*)/) || [])[1] || '';
    const wav = s.includes('RIFF') && s.includes('WAVE');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ text: ' heard ' + (wav ? 'wav' : 'other') + ' threads=' + threads + ' prompt=' + prompt.slice(0, 5) + ' ', language: 'en', duration: 1.5 }));
  });
}).listen(port, '127.0.0.1');
`;

beforeAll(async () => {
  root = await createTempDir('managed-stt');
  process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
});
afterAll(async () => {
  const { stopSttServer } = await import('../../backend/services/managed-stt.js');
  stopSttServer();
});

describe.skipIf(process.platform !== 'linux' || process.arch !== 'x64')('the processor speech engine', () => {
  it('is not ready until the engine and the whole model are in the data folder', async () => {
    const { sttReadiness } = await import('../../backend/services/managed-stt.js');
    const r = await sttReadiness();
    expect(r).toMatchObject({ ready: false, missing: ['weights'], engine: 'whisper.cpp' });
    // where it will run is this machine's own answer (a roomy NVIDIA card takes the graphics-card pair too)
    expect(r.label).toMatch(r.device === 'gpu' ? /TURBO — RUNS ON YOUR GRAPHICS CARD/ : /BASE — RUNS ON YOUR PROCESSOR/);
    expect(r.bytes).toBeGreaterThan(r.device === 'gpu' ? 700e6 : 50e6);
  });

  it('starts on first use, answers through it, and is ready once both files are whole', async () => {
    const { sttFiles, sttReadiness, transcribeWav, stopSttServer } = await import('../../backend/services/managed-stt.js');
    const { encodeWav16 } = await import('../../frontend/utils/wav16k.js');
    const f = sttFiles();
    fs.mkdirSync(path.dirname(f.bin), { recursive: true });
    fs.writeFileSync(f.bin, STANDIN, { mode: 0o755 });
    fs.mkdirSync(path.dirname(f.modelPath), { recursive: true });
    fs.closeSync(fs.openSync(f.modelPath, 'w'));
    fs.truncateSync(f.modelPath, f.model.size - 1); // one byte short is not whole
    expect((await sttReadiness()).ready).toBe(false);
    fs.truncateSync(f.modelPath, f.model.size); // sparse: the right size costs no disk
    expect((await sttReadiness()).ready).toBe(true);
    const out = await transcribeWav(Buffer.from(encodeWav16(new Float32Array(16000))), { prompt: 'neuma, Deus Neuma' });
    expect(out.text).toMatch(/^heard wav threads=\d+ prompt=neuma$/);
    expect(out).toMatchObject({ language: 'en', durationSeconds: 1.5 });
    stopSttServer();
  });
});
