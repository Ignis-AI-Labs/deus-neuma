// DELIVERY — finished work reaches a customer (the house economy's Stage 4):
// a narrow publish door, the Mercator's, to the ONE place the operator chose —
// a folder on this machine that the operator serves at an https address (a
// synced drive folder, a web server's directory). The house never pushes
// anywhere else, and a being never names the place: it names only the deal
// and the work (a file on the house ground, or an invoice, rendered from the
// record). Each published thing sits under an unguessable path, so one
// customer's link never leads to another's work.
// Events (delivery-store.js): { type: 'published', delivery, at }
// PURE.

import path from 'path';

export const FILE_MAX_BYTES = 25 * 1024 * 1024;

/**
 * The operator's destination, or a thrown reason (the folder's existence is
 * the store's to check). pure.
 * @param {{folder: unknown, linkBase: unknown}} fields
 */
export const destinationOf = ({ folder, linkBase }) => {
  const dir = typeof folder === 'string' ? folder.trim() : '';
  if (!dir || !path.isAbsolute(dir)) throw new Error('folder: the full path of a folder on this machine that you serve on the web');
  let base;
  try {
    base = new URL(String(linkBase ?? '').trim());
  } catch {
    base = null;
  }
  if (!base || base.protocol !== 'https:' || base.search || base.hash) throw new Error('linkBase: the https address that folder is served at, e.g. https://files.example.com/deliveries');
  return Object.freeze({ folder: path.resolve(dir), linkBase: base.href.replace(/\/+$/, '') });
};

/** A name safe on any disk and in any link. pure. */
export const safeName = (name) => String(name).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '').slice(0, 120) || 'delivery';

/** Where a published thing lies under the folder, and its link. pure. */
export const placeOf = (destination, { company, token, name }) => {
  const rel = [safeName(company).toLowerCase(), token, safeName(name)];
  return { file: path.join(destination.folder, ...rel), link: `${destination.linkBase}/${rel.map(encodeURIComponent).join('/')}` };
};

/** Fold the record: every delivery, oldest first. pure. */
export const foldDeliveries = (events) => events.filter((e) => e?.type === 'published' && e.delivery?.id).map((e) => e.delivery);
