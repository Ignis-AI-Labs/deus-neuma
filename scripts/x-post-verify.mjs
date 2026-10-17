// x-post-verify.mjs — prove the X lane end-to-end before a being touches it.
//
//   node scripts/x-post-verify.mjs                 → verify credentials only
//                                                    (who am I? no post)
//   node scripts/x-post-verify.mjs --post "text"   → ONE real test post
//
// Reads the same four env vars the platform uses (X_API_KEY, X_API_SECRET,
// X_ACCESS_TOKEN, X_ACCESS_SECRET — .env at the repo root) and signs with
// the SAME OAuth 1.0a core the post_to_x tool rides (uniform-architecture
// law: one signing path, proven here, trusted everywhere).

import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(REPO, '.env') });

const { xPostCredentials, postToX, buildOAuth1Header } = await import(
  path.join(REPO, 'backend/services/social/x-poster.js')
);

const credentials = xPostCredentials();
if (!credentials) {
  console.error('X credentials are not set — fill X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET in .env');
  console.error('(developer.x.com → your app → Keys and tokens; access token needs Read+Write)');
  process.exit(1);
}

// Who does this token speak as? GET /2/users/me, signed the same way.
const ME_ENDPOINT = 'https://api.x.com/2/users/me';
const header = buildOAuth1Header(credentials, {
  method: 'GET',
  url: ME_ENDPOINT,
  timestamp: String(Math.floor(Date.now() / 1000)),
  nonce: crypto.randomBytes(16).toString('hex'),
});
const res = await fetch(ME_ENDPOINT, { headers: { Authorization: header } });
const body = await res.json().catch(() => ({}));
if (!res.ok || !body?.data?.username) {
  console.error(`credential check FAILED — HTTP ${res.status}: ${body?.detail || body?.title || JSON.stringify(body).slice(0, 200)}`);
  if (res.status === 401) console.error('401 usually means a key was mispasted, or the access token predates Read+Write.');
  if (res.status === 403) console.error('403 usually means the app lacks Read+Write, or the project has no v2 access attached.');
  process.exit(1);
}
console.log(`credentials VERIFIED — this token speaks as @${body.data.username} (${body.data.name})`);
console.log('before real use, read docs/user/integrations/x.md — X enforces its automation rules against THIS account.');

const postIdx = process.argv.indexOf('--post');
if (postIdx === -1) {
  console.log('no --post given — nothing was published. To send one real test post:');
  console.log('  node scripts/x-post-verify.mjs --post "your text"');
  process.exit(0);
}

const text = process.argv[postIdx + 1];
if (!text) {
  console.error('--post needs the text: node scripts/x-post-verify.mjs --post "hello world"');
  process.exit(1);
}

console.log(`publishing ONE test post as @${body.data.username}…`);
const outcome = await postToX(credentials, text);
if (outcome.ok) {
  console.log(`POSTED — https://x.com/${body.data.username}/status/${outcome.id}`);
  console.log(`text as published: ${outcome.text}`);
} else {
  console.error(`post FAILED — ${outcome.status ? `HTTP ${outcome.status}: ` : ''}${outcome.detail}`);
  process.exit(1);
}
