// CLO designation — each house's operator names ONE of its own lanes the
// house's chief legal officer: the Praetor, the single being that holds the
// legal watch (Design note, 2026-10-01: […]). Like the CSO seat, a single-holder position — it governs the
// house's matters ledger and the legal acts, not a platform account.
//
// ONE SEAT PER HOUSE (ruling, 2026-10-16): `<realm>/<wallet>/house-clo.json`,
// beside the house's charter (house-office-seat.js). The pre-2026-10-16
// machine seat (data/settings/legal-clo.json, NEUMA_LEGAL_CLO_PATH override)
// moves on first read to the house that owns its lane, or serves no house.

import { join } from 'path';
import { getSettingsDir } from '../data-root.js';
import { createHouseSeat } from '../house-office-seat.js';

const DEFAULT_LEGACY_PATH = join(getSettingsDir(), 'legal-clo.json');

// Read per call so tests never touch the operator's live legacy seat.
export const legacyCloPath = () =>
  process.env.NEUMA_LEGAL_CLO_PATH || DEFAULT_LEGACY_PATH;

// The one instance the routes, the watch, the briefing and the intents share.
export const cloDesignation = createHouseSeat({ office: 'clo', title: 'CLO', legacyPath: legacyCloPath });
