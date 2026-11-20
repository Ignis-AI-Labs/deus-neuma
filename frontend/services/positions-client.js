// positions-client.js — the operator's POSITIONS window client: every position
// of the house in one read, and what one position's holder is told each turn.
// Seating goes through each office's own client (position-seats.js), where
// that seat's rules already stand.
// impure — talks to the local backend with the session token.

import { authedCall } from './authed-call.js';

const positionsCall = authedCall('/api/v1/positions');

/** Every position of the operator's house. impure. */
export const getPositions = () => positionsCall('GET', '/', { errorPrefix: 'Could not read the house positions' });

/** The seating the members filed leaves the board (applied, or set aside). */
export const clearSeating = () => positionsCall('DELETE', '/seating', { errorPrefix: 'Could not clear the seating' });

/** What the holder of one position reads at the top of its turn (null: nobody holds it). impure. @param {string} office */
export const getPositionEyes = (office) => positionsCall('GET', `/${encodeURIComponent(office)}/eyes`, { errorPrefix: 'Could not read what this position is told' });

/** Every campaign of every position, each with the campaigns it works with. impure. */
export const getHouseCampaigns = () => positionsCall('GET', '/campaigns', { errorPrefix: 'Could not read the campaigns' });

/** Link two campaigns of one company (keys are `<office>:<id>`). impure. */
export const linkCampaigns = (a, b, note) => positionsCall('POST', '/campaigns/link', { body: { a, b, note }, errorPrefix: 'Could not link the campaigns' });

/** Take the link between two campaigns away. impure. */
export const unlinkCampaigns = (a, b) => positionsCall('POST', '/campaigns/unlink', { body: { a, b }, errorPrefix: 'Could not unlink the campaigns' });

/** Each company's file with its business model, and the parts a model is made of. impure. */
export const getCompanies = () => positionsCall('GET', '/companies', { errorPrefix: 'Could not read the companies' });

/** The operator writes a company's business model; it stands at once. impure. */
export const saveModel = (company, model) => positionsCall('PUT', `/companies/${encodeURIComponent(company)}/model`, { body: model, errorPrefix: 'Could not save the business model' });

/** The operator's answer to a model a member filed: approve it, or return it with a note. impure. */
export const settleModel = (company, approve, note, proposalId) => positionsCall('POST', `/companies/${encodeURIComponent(company)}/model/${approve ? 'approve' : 'return'}`, { body: { note, proposalId }, errorPrefix: 'Could not answer the business model' });
