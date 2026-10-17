// CSO designation — each house's operator names ONE of its own lanes the
// house's chief security officer: the single being that holds the watch.
// Like a channel binding, it is a single-holder position — but it governs
// the house's threat ledger and the escalation lane, not a platform account.
//
// ONE SEAT PER HOUSE (Design note, 2026-10-16: […]): the seat sits beside
// the house's charter, `<realm>/<wallet>/house-cso.json` (house-office-seat.js).
// The pre-2026-10-16 machine seat (data/settings/security-cso.json,
// NEUMA_SECURITY_CSO_PATH override) moves on first read to the house that
// owns its lane, or serves no house.

import { join } from 'path';
import { getSettingsDir } from '../data-root.js';
import { createHouseSeat } from '../house-office-seat.js';

const DEFAULT_LEGACY_PATH = join(getSettingsDir(), 'security-cso.json');

// Read per call so tests never touch the operator's live legacy seat.
export const legacyCsoPath = () =>
  process.env.NEUMA_SECURITY_CSO_PATH || DEFAULT_LEGACY_PATH;

// The one instance the routes, the watch, the briefing and the intents share.
export const csoDesignation = createHouseSeat({ office: 'cso', title: 'CSO', legacyPath: legacyCsoPath });
