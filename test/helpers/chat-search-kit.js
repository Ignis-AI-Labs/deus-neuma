/** Real disk, signed wallet challenge, production router and browser transport. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { randomBytes } from 'node:crypto';
import { resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';
import express from 'express';
import { createServer } from 'vite';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import router from '../../backend/routes/workspace-routes.js';
import { fullAuth, writeOwner } from './audit-auth.js';

/** impure — fixtures are ownership/session records, never births or model runs. */
export const createChatSearchKit = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-chat-search-'));
  const previous = getWorkspacesRoot();
  const previousKey = process.env.DNA_ENCRYPTION_KEY;
  process.env.DNA_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  resetWorkspaceCryptoKey();
  setWorkspacesRoot(path.join(root, 'workspaces'));
  const auth = await fullAuth();
  const other = await fullAuth();
  for (const [id, wallet] of [['search-one', auth.address], ['search-two', auth.address], ['search-private', other.address]]) {
    await workspace.create(id);
    await writeOwner(getWorkspacesRoot(), id, wallet);
  }
  await workspace.appendMessage('search-one', 'session-100', { role: 'user', content: 'We discussed a Violet telescope for the mountain observatory.' });
  for (let i = 0; i < 70; i += 1) {
    await workspace.appendMessage('search-one', 'session-100', { role: 'assistant', content: `Later unrelated message ${i}.` });
  }
  await workspace.appendMessage('search-one', 'session-200', { role: 'assistant', content: 'Packing a picnic lunch.' });
  await workspace.appendMessage('search-one', 'session-300', { role: 'user', content: 'Literal [.*] and <img src=x onerror=alert(1)> text.' });
  await workspace.appendMessage('search-one', 'session-400', { role: 'user', content: 'A newer conversation.' });
  await workspace.writeArchiveSegment('search-one', 'session-400', 0, {
    origin: 'compaction', archivedAt: new Date().toISOString(),
    messages: [{ role: 'user', content: 'The forgotten observatory has copper shutters.', timestamp: new Date().toISOString() }],
  });
  await workspace.appendMessage('search-one', 'council-hidden', { role: 'user', content: 'Violet telescope council record' });
  await workspace.appendMessage('search-two', 'session-500', { role: 'user', content: 'Another conversation about sailing.' });
  await workspace.appendMessage('search-private', 'session-secret', { role: 'user', content: 'Violet telescope private secret' });
  const app = express();
  app.use('/api/v1/workspace', router);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const vite = await createServer({ configFile: false,
    root: fileURLToPath(new URL('../..', import.meta.url)), cacheDir: path.join(root, 'vite'),
    appType: 'custom', esbuild: { jsx: 'automatic' },
    optimizeDeps: { entries: ['test/fixtures/chat-search.jsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
    // No HMR socket; the client dials a port the browser refuses — hmr:false still
    // aimed it at :24678, where any other Vite on the box answers and the page reloads.
    server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
  });
  app.get('/', (_req, res) => res.type('html').send('<!doctype html><div id="root"></div><script type="module" src="/test/fixtures/chat-search.jsx"></script>'));
  app.use(vite.middlewares);
  return {
    root, token: auth.token, url: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      await vite.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      setWorkspacesRoot(previous);
      if (previousKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
      else process.env.DNA_ENCRYPTION_KEY = previousKey;
      resetWorkspaceCryptoKey();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
};
