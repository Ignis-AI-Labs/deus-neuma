import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

/**
 * The dream journal API on the real route, the real store, a real temp realm
 * and real auth. Proves a phone's recording is kept byte for byte, that the
 * same dream sent twice stays one dream (a link that drops before the answer
 * re-sends), that it lists newest first, plays back, deletes, and that one
 * wallet never reads another's dreams. The words (POST /:id/transcribe) ride
 * the real whisper sidecar and are proven live, not here.
 */

const WEBM = 'audio/webm;codecs=opus';
const voice = (n) => Buffer.from(`opus frames of dream ${n} `.repeat(200));

describe('Dream journal API', () => {
  let app;
  let witness;
  let other;
  let realmRoot;

  beforeEach(async () => {
    vi.resetModules();
    const { strangerWitness } = await import('../helpers/witness.js');
    witness = strangerWitness();
    other = strangerWitness();
    const realm = await import('../../backend/services/user-realm.js');
    realmRoot = await createTempDir(`dreams-${Math.random().toString(36).slice(2)}`);
    realm.setRealmRoot(realmRoot);
    const { default: router } = await import('../../backend/routes/dream-routes.js');
    app = express();
    app.use('/api/v1/user/dreams', router);
  });

  const send = (who, id, body, { type = WEBM, recordedAt = '2026-10-08T05:12:00.000Z' } = {}) => request(app)
    .post(`/api/v1/user/dreams?id=${id}&recordedAt=${encodeURIComponent(recordedAt)}&durationMs=61234`)
    .set(who.header).set('Content-Type', type).send(body);

  test('a recording is kept byte for byte, private on disk, and plays back', async () => {
    const res = await send(witness, 'dream-0001-aaaa', voice(1));
    expect(res.status).toBe(201);
    expect(res.body.dream).toMatchObject({
      id: 'dream-0001-aaaa', recordedAt: '2026-10-08T05:12:00.000Z', durationMs: 61234,
      mime: 'audio/webm', bytes: voice(1).length, transcript: { state: 'none', text: '' },
    });
    const dir = path.join(realmRoot, witness.address.toLowerCase(), 'dreams');
    expect(await fs.readFile(path.join(dir, 'dream-0001-aaaa.webm'))).toEqual(voice(1));
    expect((await fs.stat(dir)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(path.join(dir, 'dream-0001-aaaa.json'))).mode & 0o777).toBe(0o600);

    const played = await request(app).get('/api/v1/user/dreams/dream-0001-aaaa/audio').set(witness.header)
      .buffer(true).parse((r, cb) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(played.status).toBe(200);
    expect(played.headers['content-type']).toMatch(/^audio\/webm/);
    expect(played.body).toEqual(voice(1));
  });

  test('the same dream sent twice is one dream, and the first recording stands', async () => {
    expect((await send(witness, 'dream-0002-bbbb', voice(2))).status).toBe(201);
    const again = await send(witness, 'dream-0002-bbbb', voice(99));
    expect(again.status).toBe(200);
    expect(again.body.dream.bytes).toBe(voice(2).length);
    const list = await request(app).get('/api/v1/user/dreams').set(witness.header);
    expect(list.body.dreams.map((d) => d.id)).toEqual(['dream-0002-bbbb']);
  });

  test('the journal lists newest first', async () => {
    await send(witness, 'dream-old-cccc', voice(3), { recordedAt: '2026-10-01T03:00:00.000Z' });
    await send(witness, 'dream-new-dddd', voice(4), { recordedAt: '2026-10-07T03:00:00.000Z' });
    const list = await request(app).get('/api/v1/user/dreams').set(witness.header);
    expect(list.body.dreams.map((d) => d.id)).toEqual(['dream-new-dddd', 'dream-old-cccc']);
  });

  test('one wallet never reads, plays or deletes another wallet\'s dream', async () => {
    await send(witness, 'dream-mine-eeee', voice(5));
    expect((await request(app).get('/api/v1/user/dreams').set(other.header)).body.dreams).toEqual([]);
    expect((await request(app).get('/api/v1/user/dreams/dream-mine-eeee/audio').set(other.header)).status).toBe(404);
    expect((await request(app).delete('/api/v1/user/dreams/dream-mine-eeee').set(other.header)).status).toBe(404);
    expect((await request(app).get('/api/v1/user/dreams').set(witness.header)).body.dreams).toHaveLength(1);
  });

  test('delete removes the entry and the recording', async () => {
    await send(witness, 'dream-gone-ffff', voice(6));
    expect((await request(app).delete('/api/v1/user/dreams/dream-gone-ffff').set(witness.header)).status).toBe(204);
    const dir = path.join(realmRoot, witness.address.toLowerCase(), 'dreams');
    expect(await fs.readdir(dir)).toEqual([]);
  });

  test('refusals: no auth, no id, a path for an id, not audio, an empty body', async () => {
    expect((await request(app).get('/api/v1/user/dreams')).status).toBe(401);
    expect((await send(witness, '', voice(7))).status).toBe(400);
    expect((await request(app).get('/api/v1/user/dreams/..%2F..%2Fsecret/audio').set(witness.header)).status).toBe(400);
    expect((await send(witness, 'dream-text-gggg', 'not audio', { type: 'text/plain' })).status).toBe(400);
    expect((await send(witness, 'dream-none-hhhh', Buffer.alloc(0))).status).toBe(400);
  });

  test('a transcription still marked working after the process died may be retried', async () => {
    const { mayTranscribe } = await import('../../backend/routes/dream-routes.js');
    const now = Date.parse('2026-10-08T06:00:00.000Z');
    expect(mayTranscribe({ state: 'none', at: null }, now)).toBe(true);
    expect(mayTranscribe({ state: 'failed', at: '2026-10-08T05:59:00.000Z' }, now)).toBe(true);
    expect(mayTranscribe({ state: 'working', at: '2026-10-08T05:59:00.000Z' }, now)).toBe(false);
    expect(mayTranscribe({ state: 'working', at: '2026-10-08T05:30:00.000Z' }, now)).toBe(true);
  });
});
