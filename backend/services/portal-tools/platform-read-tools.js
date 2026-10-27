/**
 * read_<platform> — one read per marketing platform, the same for each, so
 * every agent can pull what it needs from any platform the house works: the
 * house's own account on that platform, its counts and its newest posts with
 * their numbers. read_x (social-read-tools.js) and
 * read_tiktok (tiktok-read-tool.js) were the first two; YouTube, Facebook,
 * Bluesky and Mastodon join them here. LinkedIn, Telegram and Discord give the
 * house no account read worth having (stats-metrics.js CAPABILITY says why).
 *
 * Reading is every lane's in the house (read-account.js): advertised to each
 * lane of a house where the platform is connected (social-queue-tools.js
 * channelToolsFor). Posting stays the holder's, behind the operator. A read
 * leaves the machine on the house's credentials, so it asks like read_x
 * (tool-policy-defaults.js, `social` row). The handler is social-read-tools.js.
 */
import { createLogger } from '../logger.js';
import { neumaWorkspace } from '../../../core/index.js';
import { houseOfLane } from '../social/house-positions.js';
import { readYouTubeAccount } from '../social/account-reads/youtube-read.js';
import { readFacebookAccount } from '../social/account-reads/facebook-read.js';
import { readBlueskyAccount } from '../social/account-reads/bluesky-read.js';
import { readMastodonAccount } from '../social/account-reads/mastodon-read.js';
import { renderAccountRead } from '../social/account-reads/account-read-render.js';
import { READ_TIKTOK_TOOL, readTikTokForBeing } from './tiktok-read-tool.js';
import { readAccountFor } from './read-account.js';

const log = createLogger('Portal');

const READING_ONLY = 'Every agent of the house may read it; posting stays with the account\'s holder and your operator\'s approval. Reading only: nothing is posted or changed.';

const readTool = (id, name, description) => Object.freeze({
  name: `read_${id}`,
  server: 'social',
  description: `${description} ${READING_ONLY}`,
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      account: Object.freeze({ type: 'string', description: `Which ${name} account (${id}-1, ${id}-2…) — only needed when the house has more than one; the one you hold, else the first, by default` }),
    }),
  }),
});

const READERS = Object.freeze({
  youtube: Object.freeze({
    name: 'YouTube',
    read: readYouTubeAccount,
    tool: readTool('youtube', 'YouTube', 'Read a YouTube channel of the house — args {account?}. You get the channel (title, @handle, link, about), its counts (subscribers, views, videos) and the newest uploads (up to 20, newest first), each with its date, length, privacy, views, likes, comments and link — the measure of what works. One read spends 3 of the house\'s daily YouTube quota units (10,000 a day, shared with uploads).'),
  }),
  facebook: Object.freeze({
    name: 'Facebook',
    read: readFacebookAccount,
    tool: readTool('facebook', 'Facebook', 'Read a Facebook Page of the house — args {account?}. You get the Page (name, link, about), its followers and likes, and the newest posts (up to 20, newest first), each with its date, reactions, comments, shares and link. Reach and insights are not readable with the house\'s access.'),
  }),
  bluesky: Object.freeze({
    name: 'Bluesky',
    read: readBlueskyAccount,
    tool: readTool('bluesky', 'Bluesky', 'Read a Bluesky account of the house — args {account?}. You get the profile (name, @handle, link, description), its counts (followers, following, posts) and the newest posts, replies left out (up to 20, newest first), each with its date, likes, reposts, replies, quotes and link. Bluesky counts no views.'),
  }),
  mastodon: Object.freeze({
    name: 'Mastodon',
    read: readMastodonAccount,
    tool: readTool('mastodon', 'Mastodon', 'Read a Mastodon account of the house — args {account?}. You get the profile (name, @handle, link, bio), its counts (followers, following, posts) and the newest posts, replies left out (up to 20, newest first), each with its date, favourites, boosts, replies and link. Mastodon counts no views.'),
  }),
});

/** Every platform's account read, by channel id — what channelToolsFor advertises. */
export const PLATFORM_READ_TOOLS = Object.freeze({
  ...Object.fromEntries(Object.entries(READERS).map(([id, r]) => [id, r.tool])),
  tiktok: READ_TIKTOK_TOOL,
});

/** The names of every platform account read. */
export const PLATFORM_READ_NAMES = Object.freeze(new Set(Object.values(PLATFORM_READ_TOOLS).map((t) => t.name)));

const channelOfTool = (toolName) => String(toolName || '').replace(/^read_/, '');

/**
 * Read a platform account of the lane's own house, for that lane. impure —
 * stores, network, the being's journal.
 * @param {string} toolName - read_youtube, read_facebook, read_bluesky, read_mastodon, read_tiktok
 * @param {string} neumaId
 * @param {{signal?: AbortSignal, budget?: number, account?: string}} [opts]
 * @returns {Promise<{ok: true, text: string, summary: string}|{ok: false, error: string}>}
 */
export const readPlatformForBeing = async (toolName, neumaId, { signal, budget, account } = {}) => {
  if (toolName === READ_TIKTOK_TOOL.name) {
    const read = await readTikTokForBeing(neumaId, { signal, budget, account });
    return read.ok ? { ok: true, text: read.text, summary: `read the TikTok account and ${read.shown} video(s)` } : read;
  }
  const id = channelOfTool(toolName);
  const reader = READERS[id];
  if (!reader) return { ok: false, error: `${toolName} is not a platform read` };
  const house = await houseOfLane(neumaId);
  if (!house) return { ok: false, error: `${toolName} reads your own house's account, and your lane has no house` };
  const picked = await readAccountFor(house, neumaId, account, { id, name: reader.name });
  if (!picked.ok) return { ok: false, error: picked.error };
  const read = await reader.read(house, { accountId: picked.accountId, signal }).catch((err) => ({ ok: false, detail: err.message }));
  if (!read.ok) return { ok: false, error: `The ${reader.name} read did not land: ${read.detail}.` };
  const drawn = renderAccountRead(reader.name, read, { budget });
  // What the being received is on its own record (the egress audit read_x keeps).
  neumaWorkspace.addJournalEntry(neumaId, {
    type: 'tool_call',
    content: `${toolName} — read the house's ${reader.name} account ${picked.accountId} and ${drawn.shown} ${read.noun}(s)`,
    significance: 0.3,
    metadata: { server: 'social', tool: toolName, account: picked.accountId, consumed: drawn.shown, status: 'ok' },
  }).catch((err) => log.warn(`${toolName} not journaled`, { neumaId, error: err.message }));
  return { ok: true, text: drawn.text, summary: `read the ${reader.name} account and ${drawn.shown} ${read.noun}(s)` };
};
