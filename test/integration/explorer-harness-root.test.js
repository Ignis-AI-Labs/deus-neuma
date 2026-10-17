/* global fetch */
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import express from 'express';
import { createAuthRouter, requireAuth } from '../../backend/services/auth.js';
import { REPO, mintToken } from '../e2e/helpers/explorer-panel-harness.js';

it('the relocated Explorer harness resolves the real package and both child entry files', async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(REPO, 'package.json'), 'utf8'));
  expect(manifest.name).toBe('neuma');
  for (const entry of ['backend/server.js', 'node_modules/vite/bin/vite.js']) {
    const stat = await fs.stat(path.join(REPO, entry));
    expect(stat.isFile()).toBe(true);
  }
});


it('authenticates independent disposable wallets through the real HTTP challenge', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', createAuthRouter(express));
  app.get('/protected', requireAuth, (req, res) => res.json({ address: req.walletAddress }));
  const server = await new Promise((resolve) => {
    const live = app.listen(0, '127.0.0.1', () => resolve(live));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    expect((await fetch(`${base}/protected`)).status).toBe(401);
    const first = await mintToken(base);
    const second = await mintToken(base);
    expect(first.addr).not.toBe(second.addr);
    for (const session of [first, second]) {
      const response = await fetch(`${base}/protected`, {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      expect(response.status).toBe(200);
      expect((await response.json()).address).toBe(session.addr.toLowerCase());
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
