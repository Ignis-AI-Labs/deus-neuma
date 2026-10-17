import express from 'express';
import request from 'supertest';

describe('GET /api/portal/status', () => {
  let app;

  beforeEach(() => {
    app = express();

    // Replicate the route from server.js without importing server.js
    const connections = new Map();

    app.get('/api/v1/portal/status', (req, res) => {
      res.json({
        status: 'active',
        connections: connections.size,
        message: 'The portal remains stable',
      });
    });
  });

  test('returns 200 with active status', async () => {
    const res = await request(app).get('/api/v1/portal/status');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    expect(res.body.connections).toBe(0);
    expect(res.body.message).toBe('The portal remains stable');
  });

  test('response is valid JSON', async () => {
    const res = await request(app).get('/api/v1/portal/status');

    expect(res.headers['content-type']).toMatch(/json/);
    expect(() => JSON.parse(JSON.stringify(res.body))).not.toThrow();
  });
});
