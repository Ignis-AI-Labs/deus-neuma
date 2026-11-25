/**
 * ONE SIGNAL WHEN ANYTHING CHANGES — Design note, 2026-11-16: fourteen replies approved in the post queue
 * still stood under WAITING ON YOU in another window. […]
 *
 * Rule 0: a real Express app with the real middleware in front of real routes, driven over HTTP;
 * the transport is the module's own seam (the portal wires the same one), collecting what would be
 * sent to the house's desks. Real timers.
 */
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { waitingPulse, pulseWaiting, setWaitingSender, WAITING_FRAME } from '../../backend/services/waiting/waiting-pulse.js';

const HOUSE = '0x00000000000000000000000000000000000000Aa';
const OTHER = '0x00000000000000000000000000000000000000bb';
const settle = () => new Promise((resolve) => { setTimeout(resolve, 260); });
let sent;

const app = () => {
  const a = express();
  a.use(express.json());
  a.use('/api/v1', waitingPulse);
  // The routes' own auth names the house, as requireAuth does.
  const auth = (req, res, next) => { req.walletAddress = req.get('x-house') || null; return req.walletAddress ? next() : res.status(401).json({ error: 'sign in' }); };
  a.get('/api/v1/queue', auth, (req, res) => res.json({ entries: [] }));
  a.post('/api/v1/queue/:id/approve', auth, (req, res) => res.json({ ok: true }));
  a.post('/api/v1/queue/:id/refused', auth, (req, res) => res.status(409).json({ error: 'already decided' }));
  a.delete('/api/v1/queue/:id', auth, (req, res) => res.status(204).end());
  return a;
};

beforeEach(() => { sent = []; setWaitingSender((wallet, frame) => { sent.push([wallet, frame.type]); return 1; }); });
afterEach(() => setWaitingSender(null));

describe('the waiting pulse', () => {
  test('a change the operator made, by any route, tells their house once; a read or a refusal tells nobody', async () => {
    const a = app();
    await request(a).get('/api/v1/queue').set('x-house', HOUSE).expect(200);
    await request(a).post('/api/v1/queue/1/refused').set('x-house', HOUSE).expect(409);
    await request(a).post('/api/v1/queue/1/approve').expect(401);
    await settle();
    expect(sent).toEqual([]);

    await request(a).post('/api/v1/queue/1/approve').set('x-house', HOUSE).expect(200);
    await settle();
    expect(sent).toEqual([[HOUSE, WAITING_FRAME]]);
    await request(a).delete('/api/v1/queue/2').set('x-house', HOUSE).expect(204);
    await settle();
    expect(sent).toHaveLength(2);
  });

  test('a burst is one pulse per house, and one house never hears another\'s', async () => {
    const a = app();
    await Promise.all([1, 2, 3, 4, 5].map((id) => request(a).post(`/api/v1/queue/${id}/approve`).set('x-house', HOUSE).expect(200)));
    await request(a).post('/api/v1/queue/9/approve').set('x-house', OTHER).expect(200);
    await settle();
    expect(sent.filter(([w]) => w === HOUSE)).toHaveLength(1);
    expect(sent.filter(([w]) => w === OTHER)).toHaveLength(1);
  });

  test('a member\'s settled act pulses its house; no wallet, no sender or a failing sender never throws', async () => {
    pulseWaiting(HOUSE);
    pulseWaiting(HOUSE.toLowerCase());
    pulseWaiting(null);
    pulseWaiting('');
    await settle();
    expect(sent).toEqual([[HOUSE, WAITING_FRAME]]);
    setWaitingSender(() => { throw new Error('the socket died'); });
    pulseWaiting(HOUSE);
    await settle();
    setWaitingSender(null);
    expect(() => pulseWaiting(HOUSE)).not.toThrow();
  });
});
