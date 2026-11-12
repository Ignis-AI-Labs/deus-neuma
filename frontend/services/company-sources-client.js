// company-sources-client.js — adding a company to the house, each company's
// site and code repos, and the CMO's read of them, over REST (/api/v1/companies; backend
// marketing/company-sources.js); and the link changes the CMO proposed
// (/api/v1/company-links; backend marketing/link-changes.js). Looking for repos on this machine and lending
// a read are the install owner's, at the desk — a guest is told so by the
// server in words.
//
// impure — network.

import { apiCall, authHeadersOrNull as authHeaders } from '../utils/http.js';

const req = async (path, { method = 'GET', body } = {}) => {
  const headers = authHeaders();
  if (!headers) throw new Error('Not authenticated.');
  return apiCall(method, path, { headers, body, errorPrefix: 'Company sources request failed', errorSuffix: '.' });
};
const at = (companyId) => `/api/v1/companies/${encodeURIComponent(companyId)}`;

/** Add a company to the house by its name, on its own or under a parent; the server answers {company}. impure. */
export const addCompany = ({ name, parentId }) => req('/api/v1/companies', { method: 'POST', body: { name, ...(parentId ? { parentId } : {}) } });

/** Every company's site and repos, each repo's grant to the seated CMO. impure. */
export const getCompanySources = () => req('/api/v1/companies/sources');

/** Move a company in the house's tree — under a parent, or to the top (null). impure. */
export const setCompanyParent = (companyId, parentId) => req(`${at(companyId)}/parent`, { method: 'PUT', body: { parentId: parentId || null } });

/** Replace a company's repos list [{path?, remote?, role?}]. impure. */
export const setCompanyRepos = (companyId, repos) => req(`${at(companyId)}/repos`, { method: 'PUT', body: { repos } });

/** Repos beside this app that look like the company's — proposals only. impure. */
export const getRepoProposals = (companyId) => req(`${at(companyId)}/repo-proposals`);

/** Let the seated CMO read one listed repo. impure. */
export const grantRepoRead = (companyId, path) => req(`${at(companyId)}/repos/read-grant`, { method: 'POST', body: { path } });

/** Take the CMO's read of one repo back. impure. */
export const revokeRepoRead = (companyId, path) => req(`${at(companyId)}/repos/read-grant`, { method: 'DELETE', body: { path } });

/** The house's open link changes its CMO proposed, each with what it would change now. impure. */
export const getLinkChanges = () => req('/api/v1/company-links');

/** Approve one: it is written onto the company. impure. */
export const approveLinkChange = (id) => req(`/api/v1/company-links/${encodeURIComponent(id)}/approve`, { method: 'POST', body: {} });

/** Decline one: nothing is written. impure. */
export const declineLinkChange = (id) => req(`/api/v1/company-links/${encodeURIComponent(id)}/decline`, { method: 'POST', body: {} });
