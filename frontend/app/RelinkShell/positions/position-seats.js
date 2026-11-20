// position-seats.js — seating and clearing each position through its OWN
// office route, where that seat's rules stand (the Logista is never the
// Quaestor, the Optio's consent, each office's scaffold). The hub offers one
// control; the law behind it stays where it was written.
// impure — network.

import { seatCos, clearCosSeat } from '../../../services/staff-client.js';
import { seatMercator, clearMercator } from '../../../services/revenue-client.js';
import { setCmo, clearCmo } from '../../../services/campaigns-client.js';
import { seatClo, clearClo } from '../../../services/legal-client.js';
import { seatCso, clearCso } from '../../../services/cso-client.js';
import { seatCfo, clearCfo } from '../../../services/treasury-client.js';
import { seatLogista, clearLogista } from '../../../services/accounts-client.js';

const SEATS = Object.freeze({
  cos: [seatCos, clearCosSeat], cro: [seatMercator, clearMercator], cmo: [setCmo, clearCmo], clo: [seatClo, clearClo],
  cso: [seatCso, clearCso], cfo: [seatCfo, clearCfo], cao: [seatLogista, clearLogista],
});

/** Seat a member in an office. @param {string} office @param {string} laneId */
export const seatPosition = (office, laneId) => SEATS[office][0](laneId);

/** Clear an office's seat. @param {string} office */
export const clearPosition = (office) => SEATS[office][1]();
