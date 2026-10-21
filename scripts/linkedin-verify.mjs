// linkedin-verify.mjs — prove the LinkedIn lane before a being touches it.
//
//   node scripts/linkedin-verify.mjs                 → verify the token only
//                                                    (who am I? no post)
//   node scripts/linkedin-verify.mjs --post "text"   → ONE real test post
//
// Resolves credentials through the SAME door the platform rides
// (resolveChannelCredential(house, 'linkedin') — encrypted store > .env) and the
// SAME wire (the poster's request builders): one path, proven here, trusted
// everywhere. A bare LINKEDIN_ACCESS_TOKEN in .env is enough for discovery —
// the script answers with the Person URN to paste, then the full set resolves.

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(REPO, '.env') });

const { resolveChannelCredential } = await import(
  path.join(REPO, 'backend/services/social/channel-credentials.js')
);
const { postToLinkedIn, readLinkedInIdentity, linkedinExpiryNote } = await import(
  path.join(REPO, 'backend/services/social/linkedin-poster.js')
);

// This script proves the REAL lane — a loopback door left in .env would make
// it verify a test double instead of LinkedIn. Refuse the door.
if (process.env.NEUMA_LINKEDIN_API_ROOT) {
  console.error('NEUMA_LINKEDIN_API_ROOT is set — this script proves the REAL lane; unset it and re-run.');
  process.exit(1);
}

// Keys are per HOUSE (backend/services/social/house-positions.js): name the
// house whose keys this proves.
const HOUSE = process.env.NEUMA_HOUSE_WALLET;
if (!/^0x[0-9a-fA-F]{40}$/.test(HOUSE || '')) {
  console.error('set NEUMA_HOUSE_WALLET=<your house wallet 0x…> — account keys are kept per house');
  process.exit(1);
}

let full = null;
try {
  full = await resolveChannelCredential(HOUSE, 'linkedin');
} catch (err) {
  // A store that throws must never read as "not configured" — the proof
  // stops here, loudly, rather than falling into discovery mode.
  console.error(`the sealed credential store refused to answer — ${err.message}`);
  process.exit(1);
}
const discovery = !full;
const credentials = full || (process.env.LINKEDIN_ACCESS_TOKEN
  ? { accessToken: process.env.LINKEDIN_ACCESS_TOKEN }
  : null);

if (!credentials) {
  console.error('LinkedIn credentials are not set — neither the sealed store nor .env carries a full set');
  console.error('(SETTINGS → API → CHANNEL KEYS, or LINKEDIN_PERSON_URN + LINKEDIN_ACCESS_TOKEN + LINKEDIN_TOKEN_EXPIRES_AT in .env');
  console.error(' first onboarding: LINKEDIN_ACCESS_TOKEN alone in .env is enough — this script prints the URN)');
  process.exit(1);
}

const me = await readLinkedInIdentity(credentials);
if (!me.ok) {
  console.error(`credential check FAILED — ${me.status ? `HTTP ${me.status}: ` : ''}${me.detail}`);
  if (me.status === 401) console.error('401 usually means the token expired (they live 60 days) or was mispasted.');
  if (me.status === 403) console.error('403 usually means the app lacks w_member_social / openid — add the Share on LinkedIn + Sign In products in the developer portal.');
  process.exit(1);
}

const personUrn = `urn:li:person:${me.data.sub}`;
console.log(`credentials VERIFIED — this token speaks as ${me.data.name || 'the member'} (${me.data.sub})`);

if (discovery) {
  const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
  console.log('\nfirst onboarding — paste these three into SETTINGS → API → CHANNEL KEYS:');
  console.log(`  personUrn        ${personUrn}`);
  console.log('  accessToken      (the token you generated)');
  console.log(`  tokenExpiresAt   ${expiresAt}  ← LinkedIn issues 60-day tokens; adjust if the portal names the true date`);
  console.log('\nnothing was published. Re-run after the keys land to verify through the sealed store.');
  process.exit(0);
}

const note = linkedinExpiryNote(full.tokenExpiresAt);
if (note) console.log(`WARNING — ${note}`);
else console.log(`token expiry on record: ${full.tokenExpiresAt}`);
console.log('before real use, read docs/user/integrations/linkedin.md — LinkedIn enforces its API terms against THIS account.');

const postIdx = process.argv.indexOf('--post');
if (postIdx === -1) {
  console.log('no --post given — nothing was published. To send one real test post:');
  console.log('  node scripts/linkedin-verify.mjs --post "your text"');
  process.exit(0);
}

const text = process.argv[postIdx + 1];
if (!text) {
  console.error('--post needs the text: node scripts/linkedin-verify.mjs --post "hello world"');
  process.exit(1);
}

console.log(`publishing ONE test post as ${personUrn}…`);
const outcome = await postToLinkedIn(full, text);
if (outcome.ok) {
  console.log(`POSTED — post id ${outcome.id} (activity: https://www.linkedin.com/feed/update/${outcome.id})`);
} else {
  console.error(`post FAILED — ${outcome.status ? `HTTP ${outcome.status}: ` : ''}${outcome.detail}`);
  process.exit(1);
}
