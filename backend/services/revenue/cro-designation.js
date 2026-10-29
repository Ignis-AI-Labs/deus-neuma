// The Mercator designation — which of the house's lanes holds its revenue
// office: the sales seat (Design note, 2026-10-29, turning what marketing makes wanted
// into a yes, and a yes into a deal, the MAKOTO way. One holder per house,
// seated by the operator (house-office-seat.js); the company line reads it as
// the Mercator for PROVE and SELL (company-line/stage-holders.js).
import { createHouseSeat } from '../house-office-seat.js';

export const croDesignation = createHouseSeat({ office: 'cro', title: 'Mercator' });
