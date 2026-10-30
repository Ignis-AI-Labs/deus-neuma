// The Logista designation — which of the house's lanes keeps its books (the
// sixteenth seat, Design note, 2026-10-29: […]). One holder per house, seated by the operator
// (house-office-seat.js) — and never the being that holds the Quaestor: the
// routes refuse that pairing from both sides (TREASURY is not ACCOUNTS).
import { createHouseSeat } from '../house-office-seat.js';

export const caoDesignation = createHouseSeat({ office: 'cao', title: 'Logista' });
