// CFO designation — each house's operator names ONE of its own lanes the
// house's Quaestor · CFO: the treasury's oversight seat (founding canon:
// TREASURY — MONEY, COMPUTE, TIME, PROCUREMENT). Someone keeps oversight of
// the house's finances and checks that everything is managed correctly.
//
// The office OVERSEES money; it never moves it. It reads the house's wallets,
// reviews a pending spend (a recommendation shown on the operator's card) and
// flags what looks wrong. It holds no key, signs nothing, and changes no
// recipient or cap — every spend still waits on the operator's own signature.
//
// ONE SEAT PER HOUSE: `<realm>/<wallet>/house-cfo.json` (house-office-seat.js),
// born per house — there is no machine-wide seat to move.

import { createHouseSeat } from '../house-office-seat.js';

// The one instance the routes, the briefing, the reads and the intents share.
export const cfoDesignation = createHouseSeat({ office: 'cfo', title: 'CFO' });
