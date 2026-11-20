// revenue-client.js — the operator's Mercator-office client: the sales board
// (seat, pipeline, deals), seating and unseating the house's Mercator.
// impure — talks to the local backend with the session token; every failure
// throws with the route's honest reason.

import { authedCall } from './authed-call.js';
import { authHeaders, httpErrorFromResponse } from '../utils/http.js';

const revenueCall = authedCall('/api/v1/revenue');

/** The sales board of the operator's house. impure. */
export const getRevenueBoard = () => revenueCall('GET', '/board', { errorPrefix: 'Could not read the sales board' });

/** Seat a being as the house's Mercator. impure. @param {string} laneId */
export const seatMercator = (laneId) => revenueCall('PUT', '/seat', { body: { laneId }, errorPrefix: 'Could not seat the Mercator' });

/** Clear the Mercator's seat. impure. */
export const clearMercator = () => revenueCall('DELETE', '/seat', { errorPrefix: 'Could not clear the Mercator seat' });

/** Choose where deliveries go: a folder on this machine you serve, and its https address. impure. */
export const setDeliveryDestination = (folder, linkBase) => revenueCall('PUT', '/delivery-destination', { body: { folder, linkBase }, errorPrefix: 'Could not set where deliveries go' });

/** The lead engine of the operator's house: segments, the prospect pool, the do-not-contact list, what is due. impure. */
export const getLeadEngine = () => revenueCall('GET', '/lead-engine', { errorPrefix: 'Could not read the lead engine' });
/** The names of the lead engine's records by id — what a door in a member's words says instead of the id. */
export const getRecordNames = () => revenueCall('GET', '/lead-engine/names', { errorPrefix: 'Could not read the record names' });
/**
 * Import leads from a file (the import JSON, or a CSV with an email column) onto the house's lead list. dry: say what it
 * would do and write nothing. The file goes as text, so a large one is not held to the JSON limit. impure.
 * @returns {Promise<{ok: boolean, dry: boolean, counts: object, people: object[], skipped: object[], added?: number, suppressed?: number}>}
 */
export const importLeads = async (text, { dry = false } = {}) => {
  const res = await fetch(`/api/v1/revenue/lead-engine/import${dry ? '?dry=1' : ''}`, { method: 'POST', headers: { 'Content-Type': 'text/plain', ...authHeaders() }, body: text });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw httpErrorFromResponse(data, res.status, { errorPrefix: 'Could not import the leads' });
  return data;
};

/** Approve, pause or retire a segment's pitch. impure. @param {string} id @param {'approved'|'paused'|'retired'} state */
export const setSegmentState = (id, state) => revenueCall('POST', `/lead-engine/segments/${encodeURIComponent(id)}/state`, { body: { state }, errorPrefix: 'Could not move the segment' });

/** Put an email address or a company domain on the do-not-contact list. impure. */
export const suppressContact = (target, reason) => revenueCall('POST', '/lead-engine/suppress', { body: { target, reason }, errorPrefix: 'Could not add to the do-not-contact list' });

/** Lift an address or a domain off the do-not-contact list. impure. */
export const liftSuppression = (target) => revenueCall('POST', '/lead-engine/suppress/lift', { body: { target }, errorPrefix: 'Could not lift the do-not-contact entry' });

/** Approve an approved audience's company list as it stands; its leads' emails then go within the daily limits. impure. @param {string} id */
/** Have the next gathered companies' own sites read (alive or not, what each says it is, its published addresses). */
export const readSegmentSites = (id, count = 40) => revenueCall('POST', `/lead-engine/segments/${encodeURIComponent(id)}/read-sites`, { body: { count }, errorPrefix: 'Could not read the sites' });
/** THE OUTBOX: emails the sales seat staged for the operator's review. */
/** acceptRisk: the operator's SEND ANYWAY on one email whose address no database confirmed live. */
export const sendOutbox = (ids, { acceptRisk = false } = {}) => revenueCall('POST', '/lead-engine/outbox/send', { body: { ids, ...(acceptRisk ? { acceptRisk: true } : {}) }, errorPrefix: 'Could not send from the outbox' });
export const returnOutboxEmail = (id, note) => revenueCall('POST', `/lead-engine/outbox/${encodeURIComponent(id)}/return`, { body: { note }, errorPrefix: 'Could not return the email' });
/** The operator deletes staged emails: each is withdrawn and never goes. impure. @param {string[]} ids */
/** The operator's hands on one scored company: {move: 'drop'|'unlist'|'move', reason?, segmentId?}. impure. */
export const handProspect = (id, change) => revenueCall('POST', `/lead-engine/prospects/${encodeURIComponent(id)}/hand`, { body: change, errorPrefix: 'Could not change the company' });
/** Pass over a company not scored yet (it leaves the companies to validate). impure. */
export const passCandidate = (segmentId, domain, why) => revenueCall('POST', '/lead-engine/candidates/pass', { body: { segmentId, domain, why }, errorPrefix: 'Could not pass over the company' });
/** Check the addresses of staged emails now: {checked, refused: [{id, reason}]}. */
/** every: ask each attached database that has not checked the address yet (address-check.js checkWithEvery). */
export const checkOutboxAddresses = (ids, { every = false } = {}) => revenueCall('POST', '/lead-engine/outbox/check', { body: { ids, ...(every ? { every: true } : {}) }, errorPrefix: 'Could not check the addresses' });
/** The operator locks a campaign's email plan in ('approved') or sends it back with what should change ('returned'). */
export const reviewCampaignEmailPlan = (id, verdict, note = '') => revenueCall('POST', `/lead-engine/campaigns/${encodeURIComponent(id)}/email-plan`, { body: { verdict, note }, errorPrefix: 'Could not review the email plan' });
/** CONFIRM OR FIND each staged email's unconfirmed address (address-confirm.js): {results: [{email, outcome, to?, words}]}. */
export const confirmOutboxAddresses = (ids) => revenueCall('POST', '/lead-engine/outbox/confirm', { body: { ids }, errorPrefix: 'Could not confirm the addresses' });
/** A reply a lead sent, read again from the house mailbox by its number: {from, subject, date, words, text}. */
export const getLeadMail = (uid) => revenueCall('GET', `/lead-engine/mail/${encodeURIComponent(uid)}`, { errorPrefix: 'Could not read their email' });
export const deleteOutboxEmails = (ids) => revenueCall('POST', '/lead-engine/outbox/delete', { body: { ids }, errorPrefix: 'Could not delete the emails' });
export const editOutboxEmail = (id, change) => revenueCall('POST', `/lead-engine/outbox/${encodeURIComponent(id)}`, { body: change, errorPrefix: 'Could not change the email' });
export const setEmailReview = (on) => revenueCall('POST', '/lead-engine/outbox/review', { body: { on }, errorPrefix: 'Could not change the review setting' });
export const approveSegmentList = (id, ids) => revenueCall('POST', `/lead-engine/segments/${encodeURIComponent(id)}/list`, { body: { ids }, errorPrefix: 'Could not approve the list' });

/** Approve or return the Mercator's latest sales facts sheet. impure. @param {string} sheetId @param {'approved'|'returned'} verdict @param {string} [note] */
export const reviewSalesFacts = (sheetId, verdict, note, only) => revenueCall('POST', `/lead-engine/facts/${encodeURIComponent(sheetId)}`, { body: { verdict, note, only }, errorPrefix: 'Could not record the review' });

/** Open a sales campaign: a name, the company it is for, what it is meant to bring in. impure. */
export const openSalesCampaign = (campaign) => revenueCall('POST', '/lead-engine/campaigns', { body: campaign, errorPrefix: 'Could not open the campaign' });

/** Move a sales campaign: archive, reopen, edit (name, goal) or delete. impure. @param {string} id @param {{move: string, name?: string, goal?: string}} change */
export const moveSalesCampaign = (id, change) => revenueCall('POST', `/lead-engine/campaigns/${encodeURIComponent(id)}`, { body: change, errorPrefix: 'Could not change the campaign' });

/** Put an audience under a campaign (null: under none). impure. */
export const setAudienceCampaign = (segmentId, campaignId) => revenueCall('POST', `/lead-engine/segments/${encodeURIComponent(segmentId)}/campaign`, { body: { campaign: campaignId }, errorPrefix: 'Could not move the audience' });

/** When paid lead data may be spent: 'ask' | 'free-first' | 'paid-first', and the month's cap in credits. impure. */
export const setLeadSpend = (mode, cap) => revenueCall('POST', '/lead-engine/spend', { body: { mode, cap }, errorPrefix: 'Could not set the paid lead data rule' });

/** Rewrite one fact of the sales facts sheet on screen ({n, claim?, source?}), or take it off ({n, remove: true}). impure. */
export const changeSalesFact = (sheetId, change) => revenueCall('POST', `/lead-engine/facts/${encodeURIComponent(sheetId)}/fact`, { body: change, errorPrefix: 'Could not change the fact' });

/** Say what a lead's reply says (wants, open, auto, gone, no): a no or a person who left closes it, kept as a contact. impure. */
export const setLeadSaid = (leadId, says, want) => revenueCall('POST', `/lead-engine/leads/${encodeURIComponent(leadId)}/said`, { body: { says, ...(want ? { want } : {}) }, errorPrefix: 'Could not change what the reply says' });

/** Re-file one lead under what it is to the house (buyer, applicant, partner, investor, press, vendor, other). impure. */
export const setLeadKind = (leadId, kind) => revenueCall('POST', `/lead-engine/leads/${encodeURIComponent(leadId)}/kind`, { body: { kind }, errorPrefix: 'Could not re-file the lead' });
