import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import WebSocket, { WebSocketServer } from 'ws';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';
import { createSessionToken, verifySessionToken } from '../../backend/services/auth.js';
import { deskTicketSessionForUrl, issueDeskTicket } from '../../backend/services/desk-tickets.js';
import { getRoots, setRoots } from '../../backend/services/user-files.js';
import deskTicketRouter from '../../backend/routes/desk-ticket-routes.js';
import userFilesRouter from '../../backend/routes/user-files-routes.js';
import { setupTerminalRoutes } from '../../backend/routes/terminal-routes.js';

let app; let root; let previousRoots; let wallet; let token; let file;
let server; let wss; let terminalUrl;

beforeAll(async () => {
  root = await createTempDir('desk-tickets');
  previousRoots = getRoots();
  wallet = ethers.Wallet.createRandom();
  token = createSessionToken(wallet.address);
  await makeInstallOwner(wallet.address);
  file = path.join(root, 'proof.txt');
  await fs.writeFile(file, 'real file bytes');
  setRoots([root]);
  app = express();
  app.use(express.json());
  app.use('/api/v1/desk-tickets', deskTicketRouter);
  app.use('/api/v1/user/files', userFilesRouter);

  server = http.createServer();
  wss = new WebSocketServer({ noServer: true });
  setupTerminalRoutes(wss);
  server.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  terminalUrl = `ws://127.0.0.1:${server.address().port}/terminal-ws`;
});

afterAll(async () => {
  setRoots(previousRoots);
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
});

const issueOverHttp = async (pathName, query = {}) => {
  const res = await request(app).post('/api/v1/desk-tickets')
    .set('Authorization', `Bearer ${token}`).send({ method: 'GET', path: pathName, query });
  expect(res.status).toBe(200);
  return res.body.ticket;
};

const closeOf = (url) => new Promise((resolve) => {
  const ws = new WebSocket(url);
  ws.on('close', resolve);
  ws.on('error', () => {});
});

describe('P6-INFO-DESK-BEARER real HTTP admission', () => {
  it('serves the exact raw file by ticket and refuses other resources and legacy bearer URLs', async () => {
    const ticket = await issueOverHttp('/api/v1/user/files/raw', { path: file });
    const ok = await request(app).get(`/api/v1/user/files/raw?path=${encodeURIComponent(file)}&ticket=${ticket}`);
    expect(ok.status).toBe(200);
    expect(ok.body.toString()).toBe('real file bytes');
    const other = path.join(root, 'other.txt');
    await fs.writeFile(other, 'other');
    expect((await request(app).get(`/api/v1/user/files/raw?path=${encodeURIComponent(other)}&ticket=${ticket}`)).status).toBe(401);
    expect((await request(app).get(`/api/v1/user/files/raw?path=${encodeURIComponent(file)}&token=${encodeURIComponent(token)}`)).status).toBe(401);
    expect((await request(app).get(`/api/v1/user/files/raw?path=${encodeURIComponent(file)}`).set('Authorization', `Bearer ${token}`)).status).toBe(200);
  });
});

describe('P6-INFO-DESK-BEARER real terminal WebSocket admission', () => {
  it('opens a real terminal with an exact ticket and refuses wrong-lane, expired and full-bearer credentials', async () => {
    const session = verifySessionToken(token);
    const issued = issueDeskTicket({ address: session.address, sessionExpiresAt: session.expiresAt, path: '/terminal-ws', query: {} });
    const ws = new WebSocket(`${terminalUrl}?ticket=${issued.ticket}`);
    const hello = await new Promise((resolve, reject) => {
      ws.on('message', (data) => {
        const frame = JSON.parse(data.toString());
        if (frame.type === 'terminal:hello') resolve(frame);
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('terminal hello timed out')), 5000).unref();
    });
    expect(hello.id).toBeTruthy();
    ws.close(1000, 'proof complete');

    const wrong = issueDeskTicket({ address: session.address, sessionExpiresAt: session.expiresAt, path: '/dictate-ws', query: {} });
    expect(await closeOf(`${terminalUrl}?ticket=${wrong.ticket}`)).toBe(4001);
    const expired = issueDeskTicket({ address: session.address, sessionExpiresAt: session.expiresAt, path: '/terminal-ws', query: {}, now: Date.now() - 70_000 });
    expect(await closeOf(`${terminalUrl}?ticket=${expired.ticket}`)).toBe(4001);
    expect(await closeOf(`${terminalUrl}?token=${encodeURIComponent(token)}`)).toBe(4001);
    expect(deskTicketSessionForUrl(`/terminal-ws?ticket=${wrong.ticket}`)).toBeNull();
  }, 15_000);
});
