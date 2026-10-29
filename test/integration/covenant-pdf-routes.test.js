/**
 * Covenant PDFs (/api/v1/covenant) — the branded PDF of each binding document,
 * end to end through the REAL router over the REAL pressed files in
 * docs/legal/pdf (RULE 0): the listing names each PDF, the route streams the
 * exact bytes on disk, and an unknown id is refused.
 */
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import covenantRouter from '../../backend/routes/covenant-routes.js';
import { pdfFileFor } from '../../backend/services/covenant.js';

const appWithCovenant = () => {
  const app = express();
  app.use('/api/v1/covenant', covenantRouter);
  return app;
};

describe('covenant PDFs (/api/v1/covenant)', () => {
  it('the listing gives every binding document its version and its PDF', async () => {
    const res = await request(appWithCovenant()).get('/api/v1/covenant');
    expect(res.status).toBe(200);
    expect(res.body.documents.map((d) => d.id)).toEqual(['covenant', 'terms', 'eula', 'privacy']);
    for (const doc of res.body.documents) {
      expect(doc.version).toMatch(/^\d+\.\d+(\.\d+)?$/); // a version, whatever revision is current (CHANGELOG.md)
      expect(doc.pdfUrl).toBe(`/api/v1/covenant/${doc.id}/pdf`);
    }
  });

  it('streams the pressed PDF inline, byte for byte', async () => {
    const app = appWithCovenant();
    for (const id of ['covenant', 'terms', 'eula', 'privacy']) {
      const res = await request(app).get(`/api/v1/covenant/${id}/pdf`).buffer(true)
        .parse((r, cb) => { const chunks = []; r.on('data', (c) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toMatch(/^inline; filename=".+\.pdf"$/);
      expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
      expect(res.body.equals(await fs.readFile(pdfFileFor(id)))).toBe(true);
    }
  });

  it('refuses an id that is not a binding document', async () => {
    const app = appWithCovenant();
    expect((await request(app).get('/api/v1/covenant/cookies/pdf')).status).toBe(404);
    expect((await request(app).get('/api/v1/covenant/..%2F..%2Fpackage.json/pdf')).status).toBe(404);
  });
});
