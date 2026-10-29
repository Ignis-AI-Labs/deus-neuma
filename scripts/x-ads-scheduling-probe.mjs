/**
 * x-ads-scheduling-probe.mjs — does the connected account have X Ads API
 * scheduling access? READ-ONLY: a GET on the Ads API's scheduled_tweets
 * surface. The answer decides whose clock approved posts ride:
 *
 *   access     → X's native scheduler becomes an option (a future build)
 *   no access  → scheduling stays Neuma-managed (post-scheduler.js)
 *
 * Standard API v2 has NO native scheduling — this probe checks the only
 * surface that has it. Run: node scripts/x-ads-scheduling-probe.mjs
 */
import crypto from 'crypto';
import { resolveChannelCredential } from '../backend/services/social/channel-credentials.js';
import { buildOAuth1Header } from '../backend/services/social/x-poster.js';

// Keys are per HOUSE (backend/services/social/house-positions.js): name the
// house whose keys this proves.
const HOUSE = process.env.NEUMA_HOUSE_WALLET;
if (!/^0x[0-9a-fA-F]{40}$/.test(HOUSE || '')) {
  console.error('set NEUMA_HOUSE_WALLET=<your house wallet 0x…> — account keys are kept per house');
  process.exit(1);
}
const credentials = await resolveChannelCredential(HOUSE, 'x').catch(() => null);
if (!credentials) {
  console.log('X credentials are not configured — nothing to probe.');
  process.exit(0);
}

// The Ads API's accounts surface is the lightest read that proves access
// class; scheduled_tweets hangs off the same authorization.
const url = 'https://ads-api.x.com/12/accounts';
const header = buildOAuth1Header(credentials, {
  method: 'GET',
  url,
  timestamp: String(Math.floor(Date.now() / 1000)),
  nonce: crypto.randomBytes(16).toString('hex'),
});

try {
  const res = await fetch(url, { headers: { Authorization: header }, signal: AbortSignal.timeout(15000) });
  const body = await res.text();
  if (res.ok) {
    console.log(`ADS API ACCESS: yes (${res.status}) — the account can reach the Ads surface.`);
    console.log('Native scheduled_tweets is an option; Neuma-managed scheduling remains the default until that lane is built.');
  } else {
    console.log(`ADS API ACCESS: no (${res.status}) — ${body.slice(0, 300)}`);
    console.log('Scheduling is NEUMA-managed (the backend worker). X\'s standard API has no native scheduler.');
  }
} catch (err) {
  console.log(`probe could not reach the Ads API: ${err.message}`);
}
