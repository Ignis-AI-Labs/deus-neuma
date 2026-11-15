// SETTING UP A POSITION — what each seat needs before it can do its job, who
// does each part, and whether it is done (Design note, 2026-11-15: […]).
//
// A step: id · who ('operator' — only the person can; 'seat' — the member
// holding the seat does it) · label · done (MEASURED from the house's own
// records, never ticked by hand) · how (the exact words to follow) ·
// optional (the seat works without it). The POSITIONS window shows the steps
// on a SETUP tab; the seat's holder reads the ones still open at the top of
// its turn and walks the operator through theirs.
// The steps and the text are PURE over a state; readSetupState is impure.

import { isConnectionOn } from '../connections/connection-switches.js';
import { resolveEmailCredential } from '../email/email-credentials.js';
import { emailBinding, canNeumaUseEmail } from '../email/email-binding.js';
import { resolveUsableCredential } from '../oauth-token-broker.js';
import { listCompanies } from '../marketing/companies.js';
import { campaignStoreFor } from '../marketing/campaign-store.js';
import { loadAccountStore } from '../social/account-store.js';
import { readSalesFacts, readSegments, readCampaigns } from '../sales/sales-store.js';
import { LINKEDIN_REDIRECT_URI } from '../social/linkedin-oauth.js';
import { positionOf } from './position-map.js';

// `way` is how the step is reached in one press (Design note, 2026-11-15: […]):
//   go    {tab, label}   a tab of this same position
//   door  {…, label}     a place elsewhere on the desk (the door table, doors/door-plan.js)
//   link  {url, label}   a page outside, where a key or an app is made
//   ask   string         what the seat's holder is asked, drafted in their chat for the operator to send
const step = (id, who, label, done, how, way = {}) => Object.freeze({ id, who, label, done: done === true, how, optional: way.optional === true, go: way.go ?? null, door: way.door ?? null, link: way.link ?? null, ask: way.ask ?? null });
const MAILBOX = Object.freeze({ tab: 'mailbox', label: 'MAILBOX' });
const SWITCHES = Object.freeze({ tab: '_switches', label: 'SWITCHES' });
const LEADS = Object.freeze({ tab: 'leads', label: 'LEADS' });
// pure — the door to the first company still missing its site.
const siteDoor = (s) => ({ kind: 'brand', companyId: s.companiesNoSite?.[0]?.id ?? null, section: 'sources', label: 'SITE & CODE' });

const SEAT_HOW = (plain) => `Open POSITIONS, choose ${plain}, pick a member in "choose who holds it" and press SEAT. A title given in HOUSE does not fill the seat.`;

// pure — each office's steps over what was read.
const STEPS = Object.freeze({
  cro: (s) => [
    step('mailbox', 'operator', 'Connect the mailbox the house sends from', s.mailbox,
      'POSITIONS, SALES, MAILBOX: enter the email address, the same address as Login Username, and an app password (for Google: myaccount.google.com/apppasswords, with 2-Step Verification on; not your normal password). Leave the host and port fields as they are for Google. Press SAVE ACCOUNT.',
      { go: MAILBOX, link: { url: 'https://myaccount.google.com/apppasswords', label: 'GOOGLE APP PASSWORDS' } }),
    step('holder', 'operator', 'Give the mailbox to the member who holds this seat', s.mailboxHeld,
      'POSITIONS, SALES, MAILBOX: in "choose the holder" pick the member who holds SALES and press BIND. Until then nobody may send.', { go: MAILBOX }),
    step('mail-watch', 'operator', 'Turn on the mailbox watch, so a reply wakes the seat', s.mailWatch, 'POSITIONS, SALES, SWITCHES: turn HOUSE MAILBOX WATCH on.', { go: SWITCHES }),
    step('lead-sources', 'operator', 'Turn on lead sources, so companies can be gathered in bulk', s.leadSources, 'POSITIONS, SALES, SWITCHES: turn LEAD SOURCES on.', { go: SWITCHES }),
    step('site', 'operator', 'Give each company you sell its site address', s.companiesWithoutSite.length === 0,
      `MARKETING, BRAND, SITE & CODE: add the site address${s.companiesWithoutSite.length ? ` for ${s.companiesWithoutSite.join(', ')}` : ''}. The seat reads the site to write true facts.`, { door: siteDoor(s) }),
    step('campaign', 'seat', 'Open the first campaign', s.salesCampaigns > 0, 'File sales/campaign with a name, the company it is for and what it is meant to bring in.',
      { ask: 'Open our first sales campaign with sales/campaign. Before you file it, tell me the name, the company and the goal you propose, and ask me anything you need to choose them.', go: { tab: 'campaigns', label: 'CAMPAIGNS' } }),
    step('facts', 'seat', 'File what a buyer may be told', s.factsFiled, 'Read the company\'s own site, then file sales/facts: each fact with its company and the page it stands on.',
      { ask: 'Read our company\'s own site and file what a buyer may be told with sales/facts, each fact with its company and the page it stands on. Ask me for anything the site does not say.' }),
    step('facts-approved', 'operator', 'Approve the facts', s.factsApproved, 'POSITIONS, SALES, LEADS: read the sheet under WHAT A BUYER MAY BE TOLD and press APPROVE THE FACTS, or RETURN it with what should change. No lead is emailed before this.', { go: LEADS }),
    step('audience', 'seat', 'File the first audience', s.audiences > 0, 'File sales/segment under the campaign it serves: the offer, their problem, the role to reach, the countries it may be sent to, the signs of a fit.',
      { ask: 'File our first audience with sales/segment under the campaign it serves. Before you file it, tell me who you propose to reach and why, and ask me which countries it may be sent to.' }),
    step('audience-approved', 'operator', 'Approve the audience', s.audiencesApproved > 0, 'POSITIONS, SALES, LEADS: read the audience and press APPROVE. Nothing from it reaches the lead list before this.', { go: LEADS }),
    step('provider', 'operator', 'Attach a contact-data provider', s.provider,
      'Sign up at hunter.io, copy the API key (hunter.io/api-keys), then SETTINGS, API, Service keys, Lead data: paste it and save. Without it the seat reads each address on the company\'s own pages.',
      { optional: true, link: { url: 'https://hunter.io/api-keys', label: 'HUNTER API KEYS' }, door: { kind: 'app', app: 'settings', label: 'SETTINGS' } }),
  ],
  cmo: (s) => [
    step('account', 'operator', 'Connect at least one account to post from', s.accounts > 0,
      'MARKETING, ACCOUNTS: add an account for the platform and enter its keys; each key field has a link to the page where that platform issues it.', { door: { kind: 'marketing', tab: 'accounts', label: 'ACCOUNTS' } }),
    step('linkedin', 'operator', 'Connect LinkedIn with one press', s.linkedin,
      `At linkedin.com/developers open your app (or create one, attached to your company page, and press Verify). Products: add "Sign In with LinkedIn using OpenID Connect" and "Share on LinkedIn". Auth: add ${LINKEDIN_REDIRECT_URI} to Authorized redirect URLs, and copy the Client ID and Primary Client Secret. Then MARKETING, ACCOUNTS, the LinkedIn account: paste both, save, press CONNECT and approve on LinkedIn's page. It lasts about 60 days; CONNECT again renews it.`,
      { optional: true, link: { url: 'https://www.linkedin.com/developers/apps', label: 'LINKEDIN DEVELOPERS' }, door: { kind: 'marketing', tab: 'accounts', label: 'ACCOUNTS' } }),
    step('site', 'operator', 'Give each company its site address', s.companiesWithoutSite.length === 0,
      `MARKETING, BRAND, SITE & CODE: add the site address${s.companiesWithoutSite.length ? ` for ${s.companiesWithoutSite.join(', ')}` : ''}.`, { door: siteDoor(s) }),
    step('campaign', 'seat', 'Open the first campaign', s.marketingCampaigns > 0, 'File campaigns/create: the company, the goal, the angles each piece argues, and the accounts it runs on.',
      { ask: 'Open our first marketing campaign with campaigns/create. Before you file it, tell me the company, the goal and the angles you propose, and ask me anything you need to choose them.' }),
  ],
});

/**
 * pure — one position's setup: the seat itself, then its own steps.
 * @param {string} office
 * @param {?string} holder - the lane seated, or null
 * @param {object} state - readSetupState's answer
 * @returns {{steps: object[], done: number, total: number, open: object[]}}
 */
export const setupOf = (office, holder, state) => {
  const plain = positionOf(office)?.plain ?? office;
  const steps = [
    step('seat', 'operator', `Seat a member in ${plain}`, Boolean(holder), SEAT_HOW(plain)),
    ...(STEPS[office]?.({ ...state, mailboxHeld: state.mailboxHolder && state.mailboxHolder === holder }) ?? []),
  ];
  const needed = steps.filter((s) => !s.optional);
  return { steps, done: needed.filter((s) => s.done).length, total: needed.length, open: steps.filter((s) => !s.done) };
};

/**
 * pure — what the seat's holder reads while its position is not fully set up:
 * its own open steps, then the operator's with the exact words to pass on.
 * '' when nothing is open (an optional step alone is named in one line).
 */
export const setupText = (offices, setups) => {
  const blocks = offices.map((office) => ({ office, setup: setups[office] })).filter((b) => b.setup?.open.length).map(({ office, setup }) => {
    const mine = setup.open.filter((s) => s.who === 'seat' && !s.optional);
    const theirs = setup.open.filter((s) => s.who === 'operator' && !s.optional);
    const extra = setup.open.filter((s) => s.optional);
    if (!mine.length && !theirs.length && !extra.length) return null;
    return [
      `${positionOf(office)?.plain ?? office}: ${setup.done} of ${setup.total} set up.`,
      ...(mine.length ? ['Yours to do now:', ...mine.map((s) => `- ${s.label}. ${s.how}`)] : []),
      ...(theirs.length ? ['Only your operator can do these. Tell them each one in these words, one at a time, and say why it matters:', ...theirs.map((s) => `- ${s.label}. ${s.how}`)] : []),
      ...(extra.length ? [`Optional, when they ask for more: ${extra.map((s) => `${s.label} (${s.how})`).join(' ')}`] : []),
    ].join('\n');
  }).filter(Boolean);
  return blocks.length ? ['## SETTING UP YOUR POSITION — guide your operator through what only they can do', ...blocks,
    'Every step is checked against the house\'s own records: when one is done it leaves this list by itself. Never say a step is done because you were told so.'].join('\n') : '';
};

/** impure — what every position's steps are measured against. A store that cannot be read counts as not done. */
export const readSetupState = async (wallet) => {
  const safe = (p, fallback) => p.catch(() => fallback);
  const [credential, bindings, companies, facts, segments, campaigns, provider, store, bench] = await Promise.all([
    safe(resolveEmailCredential(wallet), null), safe(emailBinding.load(wallet), {}), safe(listCompanies(wallet), []),
    safe(readSalesFacts(wallet), null), safe(readSegments(wallet), []), safe(readCampaigns(wallet), []),
    safe(resolveUsableCredential('hunter'), null), safe(loadAccountStore(wallet), { accounts: {} }),
    safe(campaignStoreFor(wallet).then((s) => s.load()), []),
  ]);
  const accounts = Object.entries(store?.accounts ?? {});
  const live = segments.filter((s) => s.state !== 'retired');
  return {
    mailbox: Boolean(credential),
    mailboxHolder: Object.keys(bindings ?? {}).length ? (Object.values(bindings).find((b) => b?.neumaId && canNeumaUseEmail(bindings, b.neumaId))?.neumaId ?? null) : null,
    mailWatch: isConnectionOn('mail-watch'),
    leadSources: isConnectionOn('lead-sources'),
    companiesWithoutSite: companies.filter((c) => !c.site?.url).map((c) => c.name),
    companiesNoSite: companies.filter((c) => !c.site?.url).map((c) => ({ id: c.id, name: c.name })),
    factsFiled: Boolean(facts?.sheet),
    factsApproved: Boolean(facts?.approved),
    audiences: live.length,
    audiencesApproved: live.filter((s) => s.state === 'approved').length,
    salesCampaigns: campaigns.filter((c) => c.state === 'open').length,
    marketingCampaigns: bench.length,
    provider: Boolean(provider?.apiKey),
    accounts: accounts.length,
    linkedin: accounts.some(([, a]) => a.channelId === 'linkedin' && a.platformUserId),
  };
};
