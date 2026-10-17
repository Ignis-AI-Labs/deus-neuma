// CMO designation — each house's operator names ONE of its own lanes the
// house's chief marketing officer: the single being that holds the campaign
// bench by protocol. Like a channel binding, it is a single-holder position
// — but it governs the house's campaign bench, not a platform account.
//
// ONE SEAT PER HOUSE (Design note, 2026-10-16: `<realm>/<wallet>/house-cmo.json`,
// beside the house's charter (house-office-seat.js). The pre-2026-10-16
// machine seat (data/settings/marketing-cmo.json, NEUMA_CMO_PATH override)
// moves on first read to the house that owns its lane, or serves no house.

import { join } from 'path';
import { getSettingsDir } from '../data-root.js';
import { createHouseSeat } from '../house-office-seat.js';

const DEFAULT_LEGACY_PATH = join(getSettingsDir(), 'marketing-cmo.json');

// Read per call so tests never touch the operator's live legacy seat.
export const legacyCmoPath = () =>
  process.env.NEUMA_CMO_PATH || DEFAULT_LEGACY_PATH;

// The one instance the routes, the advertisement gate and the briefing share.
export const cmoDesignation = createHouseSeat({ office: 'cmo', title: 'CMO', legacyPath: legacyCmoPath });
