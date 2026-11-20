import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { walletDir } from '../user-realm.js';

const directoryOf = (house) => path.join(walletDir(house), 'money-in', 'consumed');
const refOf = (receipt) => `${String(receipt?.kind ?? 'money-in')}:${String(receipt?.ref ?? receipt?.key ?? '')}`;

// impure — registry plus the pre-registry records of all three consumers.
export const consumedReceiptRefs = async (house) => {
  const refs = new Set();
  const directory = directoryOf(house);
  const names = await fs.readdir(directory).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const name of names.filter((file) => file.endsWith('.json'))) {
    const record = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'));
    refs.add(record.key);
  }

  const [{ readInvoices }, { listCompanies }, { readRaise }, { bookedRefs }] = await Promise.all([
    import('../invoices/invoice-store.js'),
    import('../company-line/company-store.js'),
    import('../raise/raise-store.js'),
    import('../accounts/books-store.js'),
  ]);
  const [{ invoices }, { companies }, booked] = await Promise.all([readInvoices(house), listCompanies(house), bookedRefs(house)]);
  for (const invoice of invoices) {
    if (invoice.paid?.receipt) refs.add(`money-in:${invoice.paid.receipt}`);
  }
  const raises = await Promise.all(companies.map((company) => readRaise(house, company.id)));
  for (const raise of raises) {
    for (const investor of raise.investors ?? []) {
      const received = investor.closed?.received;
      if (received?.ref) refs.add(`${received.kind}:${received.ref}`);
    }
  }
  for (const ref of booked) refs.add(ref);
  return refs;
};

/**
 * Claim one receipt for one house-wide consumer. A failed later event write
 * leaves the claim in place, fail-closed against double attribution. impure.
 */
export const claimReceipt = async (house, receipt, consumer) => {
  const key = refOf(receipt);
  if (!/^[a-z-]+:.+$/.test(key) || key.length > 600) return { ok: false, reason: 'receipt reference is invalid' };
  if ((await consumedReceiptRefs(house)).has(key)) {
    return { ok: false, reason: 'that receipt is already consumed — one receipt, one consumer' };
  }
  const directory = directoryOf(house);
  await fs.mkdir(directory, { recursive: true });
  const name = `${crypto.createHash('sha256').update(key).digest('hex')}.json`;
  try {
    await fs.writeFile(path.join(directory, name), `${JSON.stringify({ version: 1, key, consumer })}\n`, { flag: 'wx' });
    return { ok: true };
  } catch (error) {
    if (error.code === 'EEXIST') return { ok: false, reason: 'that receipt is already consumed — one receipt, one consumer' };
    throw error;
  }
};
