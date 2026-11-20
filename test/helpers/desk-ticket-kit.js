import { verifySessionToken } from '../../backend/services/auth.js';
import { issueDeskTicket } from '../../backend/services/desk-tickets.js';

export const deskTicketFor = (token, path, query = {}) => {
  const session = verifySessionToken(token);
  return issueDeskTicket({
    address: session.address,
    sessionExpiresAt: session.expiresAt,
    path,
    query,
  }).ticket;
};

export const ticketedUrl = (baseUrl, token, path, query = {}) =>
  `${baseUrl}?ticket=${deskTicketFor(token, path, query)}`;

export const ticketedWsUrl = ticketedUrl;
