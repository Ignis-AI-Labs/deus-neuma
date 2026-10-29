// OutreachApps — the windows behind the MARKETING and COMMUNITY dock sections
// (Design note, 2026-07-28: two layers — open platforms are marketed through; private
// circles are community-managed, never advertised to).
//
// MARKETING is ONE window (marketing-panel-plan.md §5, ruling 2026-10-24:
// "less is more"): the CMO's office, zoomed down the company tree, holding
// what were its own windows — each public platform is its ACCOUNT level, the
// social check its ACCOUNTS tab, the brand kits its BRAND tab, the leads its
// LEADS tab. Their old ids open MARKETING at that place
// (windowing/retired-windows.js).
//
// COMMUNITY keeps one window per platform — TELEGRAM, DISCORD — each that
// platform's space (PlatformSpace), exactly as before.

import './OutreachApps.css';
import './OutreachApps-card.css';
import { AppTitle } from './app-title.jsx';
import { PlatformSpace } from './PlatformSpace.jsx';
import { MarketingOffice } from './marketing/MarketingOffice.jsx';
import { MarketingTitle } from './marketing/MarketingTitle.jsx';
import { BrandMark } from './brand-marks.jsx';

const MarketingIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M4 14V2.5" />
    <path d="M4 3h8l-2 2.5L12 8H4" />
  </svg>
);

// One platform's window descriptor — the Body is that platform's space.
const platformApp = (channelId, label, icon) => ({
  label,
  icon,
  title: <AppTitle label={label} />,
  Body: () => <PlatformSpace channelId={channelId} />,
  storageKey: `outreach-${channelId}`,
});

const marketingApp = {
  label: 'MARKETING',
  labelKey: 'apps.marketing',
  icon: <MarketingIcon />,
  // The CMO's office: the title names the seat's holder, never the chat's focus.
  title: <MarketingTitle />,
  // Zoomed down the company tree (marketing-panel-plan.md §2): HOUSE › company
  // › subsidiary › PLATFORM account, each company level on BOARD · CAMPAIGNS ·
  // ACCOUNTS · BRAND · LEADS, the CMO seat and MANDATE at HOUSE (MarketingOffice.jsx).
  Body: () => (
    <div className="outreach-panel settings">
      <MarketingOffice />
    </div>
  ),
  storageKey: 'outreach-marketing',
};

// Registry entries, keyed by window id — spread into the shell's REGISTRY.
export const outreachApps = {
  telegram: platformApp('telegram', 'TELEGRAM', <BrandMark id="telegram" />),
  discord: platformApp('discord', 'DISCORD', <BrandMark id="discord" />),
  marketing: marketingApp,
};
