// crm-client.js — the operator's own record of people: the house's fields, a person's tags, field values and note,
// merging two leads that are one person, and one search across the house's records (backend/routes/crm-routes.js).
// impure — talks to the local backend with the session token.

import { authedCall } from './authed-call.js';

const crmCall = authedCall('/api/v1/crm');

/** The house's own fields and the types a field may be. impure. */
export const getCrmFields = () => crmCall('GET', '/fields', { errorPrefix: 'Could not read your fields' });

/** Set the house's whole field list. impure. */
export const saveCrmFields = (fields) => crmCall('PUT', '/fields', { body: { fields }, errorPrefix: 'Could not save your fields' });

/** A person's tags, field values and note; only what is named changes. impure. */
export const saveRecord = (leadId, change) => crmCall('PUT', `/leads/${encodeURIComponent(leadId)}`, { body: change, errorPrefix: 'Could not save their record' });

/** The lead `fromId` is the same person as `keepId`: one lead from two. impure. */
export const mergeLeads = (keepId, fromId) => crmCall('POST', `/leads/${encodeURIComponent(keepId)}/merge`, { body: { from: fromId }, errorPrefix: 'Could not merge the leads' });

/** One search across people, deals, invoices and companies. impure. */
export const searchCrm = (q) => crmCall('GET', `/search?q=${encodeURIComponent(q)}`, { errorPrefix: 'Could not search' });
