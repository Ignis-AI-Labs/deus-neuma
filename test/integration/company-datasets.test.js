/**
 * THE FREE DATASETS, FETCHED IN ONE STEP — Design note, 2026-11-16: […]
 *
 * Rule 0: a real HTTP server on this machine serves a real gzip file and a real zip file; the real fetch
 * downloads, unpacks and loads them into a real index file on tmp disk, and the download is gone afterwards.
 */
import fs from 'fs/promises';
import http from 'node:http';
import os from 'os';
import path from 'path';
import zlib from 'node:zlib';
import process from 'node:process';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { DATASETS, packingOf, zipFirstEntry, fetchDataset } from '../../backend/services/sales/company-datasets.js';
import { indexStats, searchIndex, closeIndex } from '../../backend/services/sales/company-index.js';

const CSV = 'country,founded,id,industry,linkedin_url,locality,name,region,size,website\nunited states,2012,a1,financial services,linkedin.com/company/coinbase,san francisco,coinbase,california,1001-5000,coinbase.com\nisrael,,a2,management consulting,linkedin.com/company/haran,ashdod,"haran \\"logistics\\" ltd",southern district,1-10,haran-logistics.example\n';
const RANKS = '1,google.com\n188,coinbase.com\n';

// A real zip file holding one deflated file: the layout every zip tool writes.
const zipOf = (name, text) => {
  const data = zlib.deflateRawSync(Buffer.from(text));
  const crc = zlib.crc32(Buffer.from(text));
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(text.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(text.length, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(30 + name.length + data.length, 16);
  return Buffer.concat([local, Buffer.from(name), data, central, Buffer.from(name), end]);
};

let server; let dir;
const SAVED = Object.fromEntries(['NEUMA_COMPANY_INDEX', 'NEUMA_DATASET_COMPANIES', 'NEUMA_DATASET_TRAFFIC'].map((k) => [k, process.env[k]]));

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-datasets-'));
  const files = { '/companies.csv.zip': zlib.gzipSync(Buffer.from(CSV)), '/top-1m.csv.zip': zipOf('top-1m.csv', RANKS) };
  server = http.createServer((req, res) => (files[req.url] ? res.writeHead(200, { 'content-length': files[req.url].length }).end(files[req.url]) : res.writeHead(404).end()));
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(process.env, { NEUMA_COMPANY_INDEX: path.join(dir, 'index', 'companies.sqlite'), NEUMA_DATASET_COMPANIES: `${base}/companies.csv.zip`, NEUMA_DATASET_TRAFFIC: `${base}/top-1m.csv.zip` });
});
afterAll(async () => {
  closeIndex();
  for (const [k, v] of Object.entries(SAVED)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await new Promise((resolve) => { server.close(resolve); });
  await fs.rm(dir, { recursive: true, force: true });
});

describe('the free datasets', () => {
  test('each says what it holds, its size, its licence and whom to credit', () => {
    expect(Object.keys(DATASETS)).toEqual(['companies', 'traffic', 'uk-companies', 'lei']);
    for (const d of Object.values(DATASETS)) expect([d.name, d.what, d.page, d.licence, d.credit, d.size].every((v) => typeof v === 'string' && v.length > 3)).toBe(true);
    expect(DATASETS.companies.terms).toMatch(/downloading accepts their privacy policy/);
  });

  test('a download is read by what it IS, whatever its name says', () => {
    expect([packingOf(zlib.gzipSync(Buffer.from('x'))), packingOf(zipOf('a.csv', 'x')), packingOf(Buffer.from('rank,domain'))]).toEqual(['gzip', 'zip', 'plain']);
    expect(zipFirstEntry(zipOf('top-1m.csv', RANKS))).toEqual({ method: 8, dataStart: 30 + 'top-1m.csv'.length });
  });

  test('one step fetches, unpacks and loads each; the downloads are gone; an unknown one is refused', async () => {
    const said = [];
    // The company file is gzip under a .zip name, as the real one is, and writes a quote after a backslash.
    expect(await fetchDataset('companies', { say: (l) => said.push(l) })).toEqual({ read: 2, kept: 2, skipped: 0 });
    expect(said[0]).toMatch(/^People Data Labs free company dataset — .* Licence: CC BY 4\.0; credit: People Data Labs\. Their page says that downloading accepts their privacy policy/);
    expect(await fetchDataset('traffic')).toEqual({ ranked: 2 });
    expect(indexStats()).toMatchObject({ loaded: true, companies: 2, ranked: 2, companiesWithTraffic: 1 });
    expect(searchIndex({ words: 'logistics' }).rows.map((r) => r.name)).toEqual(['haran "logistics" ltd']);
    expect(await fs.readdir(path.join(dir, 'index', 'downloads'))).toEqual([]);
    await expect(fetchDataset('everything')).rejects.toThrow(/no such dataset: everything — the datasets are: companies, traffic, uk-companies, lei/);
  });
});
