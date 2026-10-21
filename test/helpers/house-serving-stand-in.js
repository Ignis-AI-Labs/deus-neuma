/**
 * A HOUSE SERVING STAND-IN — a real executable the real supervisor spawns as
 * its llama-server: it binds the --port it is given and answers the endpoints
 * the platform reads (healthy /health, /v1/models, /slots, and a streamed
 * chat completion). Real process, real socket, real claim on real disk; the
 * only thing it does not do is run weights, and no test that uses it claims
 * otherwise (generation is proven in the substrate-live lane).
 *
 * `useHouseServing` pins the doors a supervised boot reads — the claim dir,
 * the data root the artifact store stages into, and LLAMA_SERVER_* — onto
 * temp paths and a free port, so nothing here can reach the machine's own
 * serving.
 */
import { writeFile, chmod, mkdir } from 'fs/promises';
import { createServer } from 'http';
import path from 'path';
import { createTempDir, unsealDirectories } from './temp-fs.js';

/** impure — a loopback port nothing is listening on right now. */
export const freePort = () => new Promise((resolve) => {
  const srv = createServer();
  srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
});

const STAND_IN = `
import http from 'http';
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
const json = (res, body) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') return json(res, { status: 'ok' });
  if (req.method === 'GET' && req.url === '/slots') return json(res, []);
  if (req.method === 'GET' && req.url.startsWith('/v1/models')) return json(res, { data: [{ id: 'stand-in-model' }] });
  if (req.method === 'GET') { res.writeHead(404); return res.end(); }
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch { /* malformed stays {} */ }
    if (!Array.isArray(body.messages)) return json(res, {});
    if (body.stream === false) return json(res, { choices: [{ message: { role: 'assistant', content: 'ready' }, finish_reason: 'stop' }] });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'I am here and answering.' } }] }) + '\\n\\n');
    res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\\n\\n');
    res.end('data: [DONE]\\n\\n');
  });
}).listen(port, '127.0.0.1');
`;

/** impure — write an executable script; `body` is the shell after the shebang. */
const writeExecutable = async (file, body) => {
  await writeFile(file, `#!/bin/sh\n${body}\n`);
  await chmod(file, 0o755);
  return file;
};

/**
 * Stand the house's serving doors on temp paths and a free port.
 * impure — temp disk, process.env.
 * @returns {Promise<{port: number, bin: string, crashBin: string, endpoint: string, restore: () => Promise<void>}>}
 */
export const useHouseServing = async () => {
  const dir = await createTempDir('house-serving');
  const server = path.join(dir, 'stand-in.mjs');
  await writeFile(server, STAND_IN);
  const bin = await writeExecutable(path.join(dir, 'llama-server'), `exec "${process.execPath}" "${server}" "$@"`);
  // A server that ends within a second of its start — cleanly, so no exit
  // code records a failure for it — before it was ever healthy.
  const crashBin = await writeExecutable(path.join(dir, 'llama-server-crash'), 'sleep 1; exit 0');
  const dataRoot = path.join(await createTempDir('house-serving-data'), 'data');
  await mkdir(dataRoot, { recursive: true });
  const port = await freePort();
  const doors = {
    NEUMA_SUBSTRATE_CLAIM_DIR: await createTempDir('house-serving-claim'),
    NEUMA_DATA_ROOT: dataRoot,
    LLAMA_SERVER_BIN: bin,
    LLAMA_SERVER_MODEL: bin,
    LLAMA_SERVER_URL: `http://127.0.0.1:${port}`,
  };
  const saved = Object.fromEntries(Object.keys(doors).map((k) => [k, process.env[k]]));
  Object.assign(process.env, doors);
  const restore = async () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await unsealDirectories(dataRoot);
  };
  return { port, bin, crashBin, endpoint: `http://127.0.0.1:${port}`, restore };
};
