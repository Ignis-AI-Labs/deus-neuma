// THE FREE DATASETS — where the house's company index comes from, fetched in one step.
//
// Design note, 2026-11-16: […]
//
// Each entry is a public file anyone may hold, with the licence it is given under and the credit
// it asks for. `fetchDataset` downloads one, unpacks it, loads it into the index
// (company-index.js) and deletes the download. Nothing here needs an account or a key. A dataset
// is added by adding one entry; one whose licence forbids commercial use, or that sits behind an
// account, is not added (see docs/design/sales/lead-engine-plan.md §1.5b for the ones weighed).
//   companies   People Data Labs' free company dataset. Their page hands the link out after a
//               short form and says downloading accepts their privacy policy; the fetch says so
//               before it starts.
//   traffic     the Tranco list of the million most visited sites (a research ranking).
//   uk-companies, lei   official registers, loaded into the registry index (registry/registry-index.js):
//               whether a company exists in law, for the legal seat as much as the sales seat.
// The unpacking is PURE over bytes; the fetch is impure (network, disk).

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { loadCompanies, loadTraffic, indexPath } from './company-index.js';
import { loadRegister } from '../registry/registry-index.js';

// Companies House names its monthly file by the first of the month it was made.
const ukFile = (now = new Date()) => `https://download.companieshouse.gov.uk/BasicCompanyDataAsOneFile-${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01.zip`;

export const DATASETS = Object.freeze({
  companies: Object.freeze({
    name: 'People Data Labs free company dataset', what: 'tens of millions of companies: name, website, industry, size, founding year, city, country, LinkedIn page',
    url: 'https://open.peopledatalabs.com/datasets/company_dataset/free_company_dataset.csv.zip', page: 'https://www.peopledatalabs.com/data-lab/dataset/company-dataset',
    licence: 'CC BY 4.0', credit: 'People Data Labs', terms: 'Their page says that downloading accepts their privacy policy: https://www.peopledatalabs.com/privacy-policy', size: 'about 2.4 GB to download, 6 GB unpacked', file: 'companies.csv', load: loadCompanies,
  }),
  traffic: Object.freeze({
    name: 'Tranco list', what: 'the million most visited sites, ranked: whether a company\'s site has any traffic',
    url: 'https://tranco-list.eu/top-1m.csv.zip', page: 'https://tranco-list.eu/',
    licence: 'free to use; cite the Tranco paper when publishing research', credit: 'Tranco (Le Pochat et al.)', terms: null, size: 'about 10 MB', file: 'traffic.csv', load: loadTraffic,
  }),
  // OFFICIAL REGISTERS (registry/registry-index.js): whether a company exists in law, where, and in what standing.
  'uk-companies': Object.freeze({
    name: 'UK Companies House free company data', what: 'every live UK company: number, status, type, registered address, incorporation date, what it does',
    url: ukFile, page: 'https://download.companieshouse.gov.uk/en_output.html',
    licence: 'published free of charge by Companies House for anyone to use', credit: 'Companies House', terms: null, size: 'about 500 MB to download, 2.6 GB unpacked', file: 'uk-companies.csv', load: (file, opts) => loadRegister('uk-companies', file, opts),
  }),
  lei: Object.freeze({
    name: 'Global LEI register (GLEIF Golden Copy)', what: 'every legal entity with a Legal Entity Identifier, worldwide: legal name, jurisdiction, legal address, standing, creation date',
    url: 'https://goldencopy.gleif.org/api/v2/golden-copies/publishes/lei2/latest.csv', page: 'https://www.gleif.org/en/lei-data/gleif-golden-copy/download-the-golden-copy',
    licence: 'CC0 1.0 (no rights reserved)', credit: 'GLEIF', terms: null, size: 'about 490 MB to download, 4 GB unpacked', file: 'lei.csv', load: (file, opts) => loadRegister('lei', file, opts),
  }),
});
const urlOf = (id) => process.env[`NEUMA_DATASET_${id.toUpperCase().replaceAll('-', '_')}`] || (typeof DATASETS[id].url === 'function' ? DATASETS[id].url() : DATASETS[id].url);

/** pure — how a downloaded file is packed, from its first bytes: gzip, zip, or not packed. */
export const packingOf = (head) => (head[0] === 0x1f && head[1] === 0x8b ? 'gzip' : head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04 ? 'zip' : 'plain');

/** pure — where a zip's first file's data begins, and whether it is deflated (the header a zip starts with). */
export const zipFirstEntry = (head) => {
  if (packingOf(head) !== 'zip' || head.length < 30) return null;
  const method = head.readUInt16LE(8);
  return { method, dataStart: 30 + head.readUInt16LE(26) + head.readUInt16LE(28) };
};

/** impure — unpack a downloaded file to plain text on disk: gzip, a zip holding one file, or already plain. */
export const unpack = async (from, to) => {
  const fd = await fs.promises.open(from, 'r');
  const head = Buffer.alloc(512);
  const { bytesRead } = await fd.read(head, 0, 512, 0);
  await fd.close();
  const packing = packingOf(head.subarray(0, bytesRead));
  if (packing === 'gzip') return pipeline(fs.createReadStream(from), zlib.createGunzip(), fs.createWriteStream(to));
  if (packing === 'zip') {
    const entry = zipFirstEntry(head.subarray(0, bytesRead));
    if (!entry || ![0, 8].includes(entry.method)) throw new Error('this zip is packed in a way the loader does not read');
    const body = fs.createReadStream(from, { start: entry.dataStart });
    // A deflated entry ends where its stream ends; what follows in the file (the zip's own index) is not read.
    return entry.method === 8 ? pipeline(body, zlib.createInflateRaw(), fs.createWriteStream(to)) : pipeline(body, fs.createWriteStream(to));
  }
  return fs.promises.copyFile(from, to);
};

/**
 * impure — fetch one dataset, unpack it, load it into the index, and delete the download.
 * @param {string} id - a key of DATASETS
 * @param {{onProgress?: (o: object) => void, say?: (line: string) => void, keep?: boolean}} opts
 * @returns {Promise<object>} what the loader counted
 */
export const fetchDataset = async (id, { onProgress = () => {}, say = () => {}, keep = false } = {}) => {
  const set = DATASETS[id];
  if (!set) throw new Error(`no such dataset: ${id} — the datasets are: ${Object.keys(DATASETS).join(', ')}`);
  const dir = path.join(path.dirname(indexPath()), 'downloads');
  await fs.promises.mkdir(dir, { recursive: true });
  const packed = path.join(dir, `${id}.download`);
  const plain = path.join(dir, set.file);
  say(`${set.name} — ${set.what}. ${set.size}. Licence: ${set.licence}; credit: ${set.credit}.${set.terms ? ` ${set.terms}` : ''}`);
  const res = await fetch(urlOf(id), { headers: { 'user-agent': 'neuma-company-index' } });
  if (!res.ok || !res.body) throw new Error(`the download answered ${res.status} — get the file by hand at ${set.page} and load it with its path`);
  const total = Number(res.headers.get('content-length')) || 0;
  let got = 0;
  const counted = Readable.fromWeb(res.body).on('data', (chunk) => { got += chunk.length; if (total) onProgress({ downloaded: got, of: total }); });
  await pipeline(counted, fs.createWriteStream(packed));
  say('unpacking');
  await unpack(packed, plain);
  say('loading into the index');
  try {
    return await set.load(plain, { onProgress });
  } finally {
    if (!keep) await Promise.all([packed, plain].map((f) => fs.promises.rm(f, { force: true })));
  }
};
