import http from 'node:http';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { canonicalLoopbackEndpoint, checkSavedRoutes, assertRouteOwned, clearRouteRefusals } from '../../backend/services/loopback-route-owner.js';

let server;
let endpoint;

beforeAll(async () => {
  server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"models":[]}'); });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '::1', resolve);
  });
  endpoint = `http://[::1]:${server.address().port}`;
});

afterAll(async () => {
  clearRouteRefusals();
  if (server) await new Promise((resolve) => server.close(resolve));
});

describe('PR20 M-10: loopback route ownership across families', () => {
  test('canonical local model endpoints are explicitly IPv4', () => {
    expect(canonicalLoopbackEndpoint('http://localhost:1234')).toBe('http://127.0.0.1:1234');
    expect(canonicalLoopbackEndpoint('http://[::1]:8089/api')).toBe('http://127.0.0.1:8089/api');
    expect(canonicalLoopbackEndpoint('https://api.example.com/v1')).toBe('https://api.example.com/v1');
  });

  test('a real listener on ::1 is probed and owner-checked, not skipped', async () => {
    const refused = await checkSavedRoutes([endpoint]);
    expect(refused).toEqual([]);
    expect(() => assertRouteOwned(endpoint)).not.toThrow();
  });
});
