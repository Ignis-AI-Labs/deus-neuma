// x-read-verify.mjs — prove the X READ lane end-to-end before a being rides it.
//
//   node scripts/x-read-verify.mjs              → who is the house on X?
//                                                 (the me-read, nothing more)
//   node scripts/x-read-verify.mjs --mentions   → the 5 latest mentions
//   node scripts/x-read-verify.mjs --recent     → the 5 latest house posts
//
// Rides the SAME credential door the read_x tool uses — resolveChannelCredential
// (house, 'x'), store > env (.env at the repo root) — and the same signing core the
// poster is proven against (uniform-architecture law: one OAuth 1.0a path).
// Read is research, not speech: this script publishes nothing, ever.

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(REPO, '.env') });

const { readXMe, readXListings, formatXReadForBeing } = await import(
  path.join(REPO, 'backend/services/social/x-reader.js')
);

// Keys are per HOUSE (backend/services/social/house-positions.js): name the
// house whose keys this proves.
const HOUSE = process.env.NEUMA_HOUSE_WALLET;
if (!/^0x[0-9a-fA-F]{40}$/.test(HOUSE || '')) {
  console.error('set NEUMA_HOUSE_WALLET=<your house wallet 0x…> — account keys are kept per house');
  process.exit(1);
}
const me = await readXMe({ wallet: HOUSE });
if (!me.ok || !me.data?.username) {
  console.error(`me-read FAILED — ${me.status ? `HTTP ${me.status}: ` : ''}${me.detail}`);
  if (me.status === 401) console.error('401 usually means a key was mispasted, or the access token predates Read+Write.');
  if (me.status === 403) console.error('403 usually means the app lacks Read access, or the project has no v2 access attached.');
  console.error('fill X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET in .env (or the encrypted channel store)');
  process.exit(1);
}
console.log(`READ LANE VERIFIED — ${formatXReadForBeing('me', me.data)}`);

const flag = process.argv.includes('--mentions') ? 'mentions'
  : process.argv.includes('--recent') ? 'recent'
    : null;
if (!flag) {
  console.log('no listing flag given — nothing further was read. To pull a real listing:');
  console.log('  node scripts/x-read-verify.mjs --mentions');
  console.log('  node scripts/x-read-verify.mjs --recent');
  process.exit(0);
}

const listing = await readXListings({ kind: flag, limit: 5, wallet: HOUSE });
if (!listing.ok) {
  console.error(`${flag} read FAILED — ${listing.status ? `HTTP ${listing.status}: ` : ''}${listing.detail}`);
  process.exit(1);
}
console.log(formatXReadForBeing(flag, listing.data));
// The reply lane's eyes, on the real field: which mentions are replies to
// OUR posts, and whose authors carry a verification the house answers.
if (flag === 'mentions') {
  const { isReplyToUs, isVerifiedAuthor } = await import(
    path.join(REPO, 'backend/services/social/x-reader.js')
  );
  const myId = listing.data.me?.id;
  const userById = Object.fromEntries((listing.data.users || []).map((u) => [u.id, u]));
  console.log('\nreply-lane view (read-only — nothing was answered):');
  for (const t of listing.data.tweets) {
    const author = userById[t.author_id] || null;
    const reply = isReplyToUs(t, myId);
    const verified = isVerifiedAuthor(author);
    console.log(`  ${t.id} @${author?.username || '?'} — reply-to-us: ${reply ? 'YES' : 'no'} · verified: ${verified ? (author?.verified_type || 'blue (legacy)') : 'no'}`);
  }
}
console.log('read only — the no-auto-engagement doctrine stands; nothing was replied to, liked, or followed.');
