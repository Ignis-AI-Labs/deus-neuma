// own-hosts — the house's OWN web addresses, for the reply tier (audit P6-71;
// default set 2026-11-19). An answer sent under a mandate may link to the site
// of the company its account speaks for; every other link waits on the
// operator. The record already exists: the company's brand kit holds its site
// (kit-shape.js `company.site.url`), set by the operator in BRAND KITS. A kit's
// other `links` (a social profile sits on someone else's host) never count,
// and a kit this app ships counts for no house until the house makes it its own.
// No company on the account, or no site on the company: no own host, and every
// link waits, exactly as before.

import { loadAccountStore } from '../../social/account-store.js';
import { listCompanies } from '../companies.js';
import { createLogger } from '../../logger.js';

const log = createLogger('Mandate.OwnHosts');

/**
 * The host of a web address, lower-cased, without a leading "www."; null for
 * anything that is not a plain http(s) address (credentials in it, another
 * scheme, a backslash). pure.
 * @param {string} address - with or without its scheme
 * @returns {?string}
 */
export const hostOfLink = (address) => {
  const text = String(address ?? '').trim();
  if (!text || /[@\\]/.test(text)) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    return url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '') || null;
  } catch {
    return null; // not an address a reader could follow as written
  }
};

/**
 * Is this link on one of these hosts, or a subdomain of one? pure.
 * @param {string} link
 * @param {string[]} hosts - bare hosts (hostOfLink's output)
 */
export const onOwnHost = (link, hosts = []) => {
  const host = hostOfLink(link);
  return Boolean(host) && hosts.some((own) => own && (host === own || host.endsWith(`.${own}`)));
};

/**
 * The own hosts of the company an account speaks for. impure; never throws —
 * what cannot be read is no host, so every link waits.
 * @param {string} house - the house's wallet
 * @param {string} accountId
 * @returns {Promise<string[]>}
 */
export const ownHostsFor = async (house, accountId) => {
  try {
    const companyId = (await loadAccountStore(house)).accounts?.[accountId]?.companyId ?? null;
    if (!companyId) return [];
    const company = (await listCompanies(house)).find((c) => c.id === companyId && c.where === 'workspace');
    const host = hostOfLink(company?.site?.url);
    return host ? [host] : [];
  } catch (err) {
    log.warn('the house\'s own site could not be read — every link waits on the operator', { error: err.message });
    return [];
  }
};
