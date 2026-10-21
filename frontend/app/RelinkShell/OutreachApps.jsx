// OutreachApps — the platform roster behind the MARKETING and COMMUNITY
// dock sections (Design note, 2026-07-28: two layers — open platforms are marketed
// through; private circles are community-managed, never advertised to).
// Every channel is its own separate space, navigated from the dock like any
// other app — never tabs buried inside one vague window.
//
// One window per platform — X, TELEGRAM, DISCORD, FACEBOOK, MASTODON,
// BLUESKY — each carrying that platform's standing, campaigns, and queue
// (PlatformSpace). Beside them: the CMO seat (the deliberately house-wide
// campaigns) and LEADS (the funnel, one book for the house).
// A new platform (TikTok, YouTube, Reddit…) lands its poster + catalog
// entry, then one descriptor line here — its window renders itself.

import './OutreachApps.css';
import './OutreachApps-card.css';
import { AppTitle } from './app-title.jsx';
import { PlatformSpace } from './PlatformSpace.jsx';
import { CampaignsSection } from './CampaignsSection.jsx';
import { LeadsSection } from './LeadsSection.jsx';
import { BrandKitsSection } from './brandkits/BrandKitsSection.jsx';
import { BrandMark } from './brand-marks.jsx';

const MarketingIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M4 14V2.5" />
    <path d="M4 3h8l-2 2.5L12 8H4" />
  </svg>
);

// A swatch card — the kit as a physical thing you set up once and work from.
const BrandKitIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <rect x="2" y="2.5" width="12" height="11" rx="1" />
    <path d="M2 6h12" />
    <circle cx="5" cy="9.5" r="1.3" fill="currentColor" stroke="none" />
    <path d="M8.5 9h4M8.5 11.5h3" />
  </svg>
);

const LeadsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M2.5 3h11L9.5 8v5l-3 1.5V8L2.5 3z" />
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
  title: <AppTitle label="MARKETING" labelKey="apps.marketing" />,
  // The CMO seat and the campaigns that deliberately span platforms — a
  // campaign that runs on one platform belongs in that platform's window.
  Body: () => (
    <div className="outreach-panel settings">
      <CampaignsSection channelId={null} />
    </div>
  ),
  storageKey: 'outreach-marketing',
};

// The brand kits themselves — every managed company's standing instruction for
// what it says, how it looks, and what may never be claimed on its behalf. It
// sits in MARKETING rather than in a platform window because a kit is not a
// channel: one kit governs every channel a company speaks through, and the work
// that reads it (campaigns, cards, pressed documents) starts here.
const brandKitsApp = {
  label: 'BRAND KITS',
  labelKey: 'apps.brandKits',
  icon: <BrandKitIcon />,
  title: <AppTitle label="BRAND KITS" labelKey="apps.brandKits" />,
  Body: () => (
    <div className="outreach-panel settings">
      <BrandKitsSection />
    </div>
  ),
  storageKey: 'outreach-brand-kits',
};

const leadsApp = {
  label: 'LEADS',
  labelKey: 'apps.leads',
  icon: <LeadsIcon />,
  title: <AppTitle label="LEADS" labelKey="apps.leads" />,
  Body: () => (
    <div className="outreach-panel settings">
      <LeadsSection />
    </div>
  ),
  storageKey: 'outreach-leads',
};

// Registry entries, keyed by window id — spread into the shell's REGISTRY.
export const outreachApps = {
  x: platformApp('x', 'X', <BrandMark id="x" />),
  telegram: platformApp('telegram', 'TELEGRAM', <BrandMark id="telegram" />),
  discord: platformApp('discord', 'DISCORD', <BrandMark id="discord" />),
  facebook: platformApp('facebook', 'FACEBOOK', <BrandMark id="facebook" />),
  mastodon: platformApp('mastodon', 'MASTODON', <BrandMark id="mastodon" />),
  bluesky: platformApp('bluesky', 'BLUESKY', <BrandMark id="bluesky" />),
  linkedin: platformApp('linkedin', 'LINKEDIN', <BrandMark id="linkedin" />),
  marketing: marketingApp,
  brandKits: brandKitsApp,
  leads: leadsApp,
};
