/**
 * sales/rootdata — what RootData holds for one crypto company the house gathered: what it is, its backers, where it
 * is reached (X, LinkedIn, Discord), and its team when the operator's RootData plan returns one (rootdata-api.js).
 * RootData holds no email: this is for knowing a project and reaching it by hand, never a source of addresses.
 * THE OFFICE LAW holds: the seated sales member, with the LEAD SOURCES connection on and the operator's key attached.
 */
import { officeContext } from './revenue-acts.js';
import { isConnectionOn } from '../connections/connection-switches.js';
import { readCandidates, readProspects } from '../sales/sales-store.js';
import { rootdataKey } from '../sales/rootdata-key.js';
import { rootdataProject, rootdataAccount, rootdataWords, ROOTDATA_PROJECT_COST } from '../sales/rootdata-api.js';

const denied = (reason) => ({ ok: false, status: 'denied', reason });
const invalid = (reason) => ({ ok: false, status: 'invalid', reason });
const seated = async (connection) => (await officeContext(connection).catch(() => null)) || null;

export const salesRootdataIntent = Object.freeze({
  name: 'sales/rootdata',
  policyTool: 'sales.rootdata',
  fieldsForPrompt: '{domain}',
  descriptionForPrompt: `THE LEAD ENGINE, CRYPTO COMPANIES ONLY. What ROOTDATA (a database of crypto projects) holds for one company you gathered or scored: what it is, its tags and backers, where it is reached (its X, LinkedIn and Discord), and its team members when your operator's RootData plan returns them. domain: the company's. It costs ${ROOTDATA_PROJECT_COST} of your operator's RootData credits when the project is found, nothing when it is not. RootData holds NO email address: use it to know a project and to tell your operator who to reach and where; an address still comes from the company's own pages or sales/find-address.`,
  availableFor: async ({ connection }) => ((await seated(connection)) && isConnectionOn('lead-sources') && (await rootdataKey()) ? {} : null),
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return denied('the lead engine is the sales office\'s — only its seated member files to it');
    if (!isConnectionOn('lead-sources')) return denied('the LEAD SOURCES connection is off — the operator turns it on in POSITIONS, CHIEF REVENUE OFFICER, SETTINGS');
    const apiKey = await rootdataKey();
    if (!apiKey) return denied('no RootData key is attached — the operator adds one in SETTINGS, API, Lead data');
    const domain = String(payload?.domain ?? '').trim().toLowerCase();
    const [candidates, prospects] = await Promise.all([readCandidates(context.wallet), readProspects(context.wallet)]);
    const known = prospects.find((p) => p.domain === domain) ?? candidates.find((c) => c.domain === domain);
    if (!known) return invalid(`"${domain}" is not a company you gathered or scored`);
    return { ok: true, value: { apiKey, domain, name: known.name || domain.split('.')[0] } };
  },
  summarize: (payload) => `ask RootData about ${payload?.domain ?? '?'}`,
  execute: async ({ apiKey, domain, name }, { signal } = {}) => {
    const got = await rootdataProject({ apiKey, name, domain, signal });
    if (!got.ok) return { ok: false, reason: `RootData could not be asked: ${got.detail}.` };
    if (!got.project) return { ok: true, detail: `${got.why} (${domain}; no credit spent). It may be listed under another name, or not at all.` };
    const account = await rootdataAccount({ apiKey, signal });
    return { ok: true, detail: `${rootdataWords(got.project, account?.plan ?? null)}\n(${got.spent} RootData credits spent${account ? `; ${Math.max(0, account.available - account.used)} of ${account.available} left` : ''}.)` };
  },
});
