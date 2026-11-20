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
import { listCompanies } from '../marketing/companies.js';
import { campaignStoreFor } from '../marketing/campaign-store.js';
import { loadAccountStore } from '../social/account-store.js';
import { readSalesFacts, readSegments, readCampaigns } from '../sales/sales-store.js';
import { LINKEDIN_REDIRECT_URI } from '../social/linkedin-oauth.js';
import { readModels } from './business-model.js';
import { readSpend, attachedProviders } from '../sales/lead-spend.js';
import { positionOf } from './position-map.js';

// `way` is how the step is reached in one press (Design note, 2026-11-15: […]):
//   go    {tab, label}   a tab of this same position
//   door  {…, label}     a place elsewhere on the desk (the door table, doors/door-plan.js)
//   link  {url, label}   a page outside, where a key or an app is made
//   ask   string         what the seat's holder is asked, drafted in their chat for the operator to send
//                        (askLabel: the words on that press, when the plain ASK <holder> says too little)
const step = (id, who, label, done, how, way = {}) => Object.freeze({ id, who, label, done: done === true, how, optional: way.optional === true, go: way.go ?? null, door: way.door ?? null, link: way.link ?? null, ask: way.ask ?? null, askLabel: way.askLabel ?? null });
const MAILBOX = Object.freeze({ tab: 'mailbox', label: 'MAILBOX' });
const SWITCHES = Object.freeze({ tab: '_switches', label: 'SETTINGS' });
// pure — the door to the first company still missing its site.
const siteDoor = (s) => ({ kind: 'brand', companyId: s.companiesNoSite?.[0]?.id ?? null, section: 'sources', label: 'SITE & CODE' });

// The business model comes before any campaign or audience: nobody can say why they are at a buyer's door without it
// (Design note, 2026-11-15. The operator who knows it types it; the one who does not works it out with the seat's holder.
const MODEL_TAB = Object.freeze({ tab: 'model', label: 'COMPANY' });
const CAMPAIGNS = Object.freeze({ tab: 'campaigns', label: 'CAMPAIGNS' });
const modelStep = (s, plain) => step('model', 'operator', s.modelsWaiting.length ? `Approve the business model filed for ${s.modelsWaiting.join(', ')}` : 'Write down the business model of each company you work for', s.modelsApproved > 0 && s.modelsMissing.length === 0 && s.modelsWaiting.length === 0,
  s.modelsWaiting.length
    ? `POSITIONS, ${plain}, COMPANY: read the business model filed for ${s.modelsWaiting.join(', ')} and press APPROVE, or RETURN it with what should change.`
    : `POSITIONS, ${plain}, COMPANY${s.modelsMissing.length ? ` (still missing for ${s.modelsMissing.join(', ')})` : ''}: for each company write what it sells, who pays, their problem today, what objectively changes for them, what it costs, and what proves it. If you know it, type it and press SAVE. If you do not, press WORK IT OUT: the seat asks you one question at a time, files it, and you approve it. Every campaign, audience and email is built on this.`,
  { go: MODEL_TAB, askLabel: 'WORK IT OUT WITH', ask: 'Work out our business model with me, for each company we work for. Ask me one question at a time, in plain words, and wait for my answer: what we sell, who pays for it, the problem they have today, what objectively changes for them (a result they can check, not a feeling), what it costs and how we earn, what proves it, and what we are after in the next three months. Push back when an answer is vague. When we have it, file it with company/model and tell me to approve it in POSITIONS, COMPANY.' });

const SEAT_HOW = (plain) => `Open POSITIONS, choose ${plain}, pick a member in "choose who holds it" and press SEAT. A title given in HOUSE does not fill the seat.`;

// pure — each office's steps over what was read.
const STEPS = Object.freeze({
  cro: (s) => [
    step('mailbox', 'operator', 'Connect the mailbox the house sends from', s.mailbox,
      'POSITIONS, CHIEF REVENUE OFFICER, MAILBOX: enter the email address, the same address as Login Username, and an app password (for Google: myaccount.google.com/apppasswords, with 2-Step Verification on; not your normal password). Leave the host and port fields as they are for Google. Press SAVE ACCOUNT.',
      { link: { url: 'https://myaccount.google.com/apppasswords', label: '1 · GET A GOOGLE APP PASSWORD' }, go: { ...MAILBOX, label: '2 · ENTER IT IN MAILBOX' } }),
    step('holder', 'operator', 'Give the mailbox to the member who holds this seat', s.mailboxHeld,
      'POSITIONS, CHIEF REVENUE OFFICER, MAILBOX: in "choose the holder" pick the member who holds the CHIEF REVENUE OFFICER seat and press BIND. Until then nobody may send.', { go: MAILBOX }),
    step('mail-watch', 'operator', 'Turn on the mailbox watch, so a reply wakes the seat', s.mailWatch, 'POSITIONS, CHIEF REVENUE OFFICER, SETTINGS: turn HOUSE MAILBOX WATCH on.', { go: SWITCHES }),
    step('lead-sources', 'operator', 'Turn on lead sources, so companies can be gathered in bulk', s.leadSources, 'POSITIONS, CHIEF REVENUE OFFICER, SETTINGS: turn LEAD SOURCES on.', { go: SWITCHES }),
    step('site', 'operator', 'Give each company you sell its site address', s.companiesWithoutSite.length === 0,
      `MARKETING, BRAND, SITE & CODE: add the site address${s.companiesWithoutSite.length ? ` for ${s.companiesWithoutSite.join(', ')}` : ''}. The seat reads the site to write true facts.`, { door: siteDoor(s) }),
    modelStep(s, 'SALES'),
    step('campaign', 'seat', 'Open the first campaign', s.salesCampaigns > 0, 'File sales/campaign with a name, the company it is for and what it is meant to bring in.',
      { ask: 'Open our first sales campaign with sales/campaign. Before you file it, tell me the name, the company and the goal you propose, and ask me anything you need to choose them.', go: { tab: 'campaigns', label: 'CAMPAIGNS' } }),
    step('facts', 'seat', 'File what a buyer may be told', s.factsFiled, 'Read the company\'s own site, then file sales/facts: each fact with its company and the page it stands on.',
      { ask: 'Read our company\'s own site and file what a buyer may be told with sales/facts, each fact with its company and the page it stands on. Ask me for anything the site does not say.' }),
    step('facts-approved', 'operator', 'Approve the facts', s.factsApproved, 'POSITIONS, CHIEF REVENUE OFFICER, COMPANY: read the facts under WHAT A BUYER MAY BE TOLD. Press APPROVE ALL when every one is right. Otherwise tick the ones that are right and press APPROVE CHECKED: the rest go back to the seat to fix. EDIT or DELETE changes one fact yourself. No lead is emailed before this.', { go: MODEL_TAB }),
    step('audience', 'seat', 'File the first audience', s.audiences > 0, 'File sales/segment under the campaign it serves: the offer, their problem, the role to reach, the countries it may be sent to, the signs of a fit.',
      { ask: 'File our first audience with sales/segment under the campaign it serves. Before you file it, tell me who you propose to reach and why, and ask me which countries it may be sent to.' }),
    step('audience-approved', 'operator', 'Approve the audience', s.audiencesApproved > 0, 'POSITIONS, CHIEF REVENUE OFFICER, CAMPAIGNS: read the audience under its campaign and press APPROVE. Nothing from it reaches the lead list before this.', { go: CAMPAIGNS }),
    step('provider', 'operator', 'Attach a contact-data provider', s.provider,
      'First sign up at hunter.io and copy your API key (hunter.io/api-keys). Then paste it into the Hunter row under SETTINGS, API, Service keys, Lead data, and press save. Tomba and Apollo go in the same group, each with its own link; Tomba\'s row takes its API key and its secret. Without one the seat reads each address on the company\'s own pages.',
      { optional: true, link: { url: 'https://hunter.io/api-keys', label: '1 · GET THE KEY AT HUNTER' }, door: { kind: 'service', serviceId: 'hunter', label: '2 · PASTE IT HERE' } }),
    step('paid-rule', 'operator', 'Turn paid lead data on, or leave it off', s.spendChosen,
      'POSITIONS, CHIEF REVENUE OFFICER, SETTINGS: PAID LEAD DATA is one switch. ON lets the seat pay for a lookup when a company\'s own pages give no address, up to the monthly limit beside it. OFF spends nothing.', { optional: true, go: SWITCHES }),
  ],
  cmo: (s) => [
    step('account', 'operator', 'Connect at least one account to post from', s.accounts > 0,
      'MARKETING, ACCOUNTS: add an account for the platform and enter its keys; each key field has a link to the page where that platform issues it.', { door: { kind: 'marketing', tab: 'accounts', label: 'ACCOUNTS' } }),
    step('linkedin', 'operator', 'Connect LinkedIn with one press', s.linkedin,
      `At linkedin.com/developers open your app (or create one, attached to your company page, and press Verify). Products: add "Sign In with LinkedIn using OpenID Connect" and "Share on LinkedIn". Auth: add ${LINKEDIN_REDIRECT_URI} to Authorized redirect URLs, and copy the Client ID and Primary Client Secret. Then MARKETING, ACCOUNTS, the LinkedIn account: paste both, save, press CONNECT and approve on LinkedIn's page. It lasts about 60 days; CONNECT again renews it.`,
      { optional: true, link: { url: 'https://www.linkedin.com/developers/apps', label: '1 · SET UP THE APP AT LINKEDIN' }, door: { kind: 'marketing', tab: 'accounts', label: '2 · CONNECT IN ACCOUNTS' } }),
    step('site', 'operator', 'Give each company its site address', s.companiesWithoutSite.length === 0,
      `MARKETING, BRAND, SITE & CODE: add the site address${s.companiesWithoutSite.length ? ` for ${s.companiesWithoutSite.join(', ')}` : ''}.`, { door: siteDoor(s) }),
    modelStep(s, 'MARKETING'),
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
  // the seat's own name (CHIEF REVENUE OFFICER), the one every surface uses
  const plain = positionOf(office)?.seat ?? office;
  const steps = [
    step('seat', 'operator', `Seat a member as ${plain}`, Boolean(holder), SEAT_HOW(plain)),
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
      `${positionOf(office)?.seat ?? office}: ${setup.done} of ${setup.total} set up.`,
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
  const [credential, bindings, companies, facts, segments, campaigns, provider, store, bench, models, spend] = await Promise.all([
    safe(resolveEmailCredential(wallet), null), safe(emailBinding.load(wallet), {}), safe(listCompanies(wallet), []),
    safe(readSalesFacts(wallet), null), safe(readSegments(wallet), []), safe(readCampaigns(wallet), []),
    safe(attachedProviders(), []), safe(loadAccountStore(wallet), { accounts: {} }),
    safe(campaignStoreFor(wallet).then((s) => s.load()), []), safe(readModels(wallet), new Map()), safe(readSpend(wallet), { chosen: false }),
  ]);
  const accounts = Object.entries(store?.accounts ?? {});
  const live = segments.filter((s) => s.state !== 'retired');
  // A company the house already works for (a campaign or an audience names it) needs its model; so does the first one.
  const worked = new Set([...campaigns.map((c) => c.company), ...bench.map((c) => c.companyId), ...live.map((s) => s.company)].filter(Boolean));
  return {
    mailbox: Boolean(credential),
    mailboxHolder: Object.keys(bindings ?? {}).length ? (Object.values(bindings).find((b) => b?.neumaId && canNeumaUseEmail(bindings, b.neumaId))?.neumaId ?? null) : null,
    mailWatch: isConnectionOn('mail-watch'),
    leadSources: isConnectionOn('lead-sources'),
    companiesWithoutSite: companies.filter((c) => !c.site?.url).map((c) => c.name),
    companiesNoSite: companies.filter((c) => !c.site?.url).map((c) => ({ id: c.id, name: c.name })),
    modelsApproved: companies.filter((c) => models.get(c.id)?.approved).length,
    modelsMissing: companies.filter((c) => worked.has(c.id) && !models.get(c.id)?.approved && !models.get(c.id)?.proposal).map((c) => c.name),
    modelsWaiting: companies.filter((c) => models.get(c.id)?.proposal).map((c) => c.name),
    factsFiled: Boolean(facts?.sheet),
    factsApproved: Boolean(facts?.approved),
    audiences: live.length,
    audiencesApproved: live.filter((s) => s.state === 'approved').length,
    salesCampaigns: campaigns.filter((c) => c.state === 'open').length,
    marketingCampaigns: bench.length,
    provider: provider.length > 0,
    spendChosen: spend.chosen === true,
    accounts: accounts.length,
    linkedin: accounts.some(([, a]) => a.channelId === 'linkedin' && a.platformUserId),
  };
};
