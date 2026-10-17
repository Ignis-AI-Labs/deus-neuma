/**
 * platform-feed-tools — the Umbrae platform's numbers, as a tool a being can
 * READ rather than merely draw.
 *
 * Design note, 2026-08-29, after a house member was asked about the token and had to
 * answer honestly that it had no feed: […]
 *
 * The answer was that the client existed and had exactly one consumer:
 * `render_card {stat}`. A being could print a figure onto a marketing card and
 * could not read one to think with. This tool is that missing door.
 *
 * Design note, 2026-08-30, on scope: […]
 *
 * Standing laws it inherits rather than reinvents:
 *   READ-ONLY   the only verb in the family is GET, host and path both pinned
 *               (platform-feed-read.js). It is not that this tool declines to
 *               trade — it is that there is no verb here that could.
 *   HONESTY     absent is never zero, the source's own doubt is carried as a
 *               sentence, every figure carries its moment (platform-feed-shape.js).
 *   ACTS        advertised like any other tool and crossing the same gate.
 *
 * Why it does NOT ride the operator's open-web switch: that switch governs
 * reach into the open internet, where the being chooses the destination. Here
 * the destination is the operator's own platform on a pinned host, and the
 * being chooses only which of three named feeds to read. This is the same
 * standing `render_card {stat}` has held since it shipped.
 */
import { readPlatformFeed } from './platform-feed-read.js';
import { FEED_NAMES, feedByName, describeFeeds } from './platform-feed-sources.js';

/** Tokens listed in the `pools` feed. Past this a being is sifting rather than
 *  reading, and the cap is always STATED — a silent truncation reads as […], which is the one lie a data feed must never tell. */
const TOKEN_CAP = 25;

export const PLATFORM_FEED_TOOLS = Object.freeze([
  Object.freeze({
    name: 'platform_data',
    server: 'platform',
    description: 'Read the LIVE numbers from the Umbrae platform — args {feed?}. '
      + 'This is the real data feed: TVL, market cap, token prices, 24h and all-time volume, '
      + 'fees, LP earnings, protocol revenue, trade counts, supply and APR, pulled fresh from '
      + 'the platform with the moment each figure was true. '
      + `Feeds: ${FEED_NAMES.join(', ')} — call with no arguments to read all three at once. `
      + 'Use this whenever you are asked about the platform, the U1 token, the market, "how are '
      + 'we doing", or any figure you would otherwise have to guess at. It reads and only reads: '
      + 'there is no trading, no position, no transaction here. '
      + 'Read the `caveats` on every response before you quote a number — the platform marks its '
      + 'own soft figures, and a figure that is absent is UNKNOWN, never zero.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        feed: Object.freeze({
          type: 'string',
          enum: Object.freeze([...FEED_NAMES]),
          description: 'one feed to read; omit to read every feed',
        }),
      }),
      required: Object.freeze([]),
      additionalProperties: false,
    }),
  }),
]);

const TOOL_NAMES = new Set(PLATFORM_FEED_TOOLS.map((t) => t.name));

/**
 * Does this parsed call target the platform feed? Accepts every dialect the
 * other platform handlers accept: bare name, server-prefixed
 * (`platform/platform_data`), and the native function-calling encoding
 * (`platform__platform_data`). Pure.
 */
export const isPlatformFeedTool = (match) =>
  TOOL_NAMES.has(String(match?.toolName || '').replace(/^platform__/, ''))
  || TOOL_NAMES.has(String(match?.tool || '').replace(/^platform\//, ''));

/**
 * The catalog for this turn. Design note, 2026-08-29: […].
 * Every bound seat — a sovereign neuma or a sealed witness — reads the same
 * public aggregate, so there is no seat test and no per-being switch here.
 * Pure.
 */
export const platformFeedToolsFor = (connection) =>
  (connection?.companion ? [...PLATFORM_FEED_TOOLS] : []);

/** Apply the stated token cap to a shaped pools feed. Pure. */
const capTokens = (shaped) => {
  if (shaped.feed !== 'pools' || shaped.tokens.length <= TOKEN_CAP) return shaped;
  return {
    ...shaped,
    tokens: shaped.tokens.slice(0, TOKEN_CAP),
    caveats: [
      ...shaped.caveats,
      `Showing the ${TOKEN_CAP} tokens with the most pool TVL, of ${shaped.tokens.length} trading on the platform. The rest are real and are not in this response.`,
    ],
  };
};

/** Read and shape one named feed. impure — network. */
const oneFeed = async (name, signal) => {
  const entry = feedByName(name);
  if (!entry) return { feed: name, error: `no such feed "${name}" — this platform carries: ${FEED_NAMES.join(', ')}` };
  const read = await readPlatformFeed(entry.path, { signal });
  if (!read.ok) return { feed: name, error: read.error };
  return capTokens(entry.shape(read.payload, read.readAt));
};

/**
 * Execute the platform feed tool. Mirrors the platform handler contract used by
 * map-being-tools: returns `{ tool, status, content|error }` and emits the same
 * tool-event chip so the operator sees the call.
 *
 * A partial read is a SUCCESS that names its own hole: if two feeds answer and
 * one does not, the being gets the two plus the reason for the third. Failing
 * the whole call would throw away real data the being asked for.
 *
 * impure — network.
 */
export const handlePlatformFeedTool = async (ws, connection, match, args, ports) => {
  const bare = String(match?.toolName || '').replace(/^platform__/, '');
  const toolName = TOOL_NAMES.has(bare) ? bare : String(match?.tool || '').replace(/^platform\//, '');
  const tool = `platform/${toolName}`;
  const { companion } = connection;
  const emit = (event) => ports?.sendToolEvent?.(ws, companion, { tool, ...event });
  const signal = connection?.activeTurn?.signal;

  const wanted = typeof args?.feed === 'string' ? args.feed.trim() : '';
  if (wanted && !feedByName(wanted)) {
    const error = `no such feed "${wanted}" — this platform carries: ${FEED_NAMES.join(', ')}.\n${describeFeeds().join('\n')}`;
    emit({ status: 'error', summary: `${toolName} — unknown feed` });
    return { tool, status: 'error', error };
  }

  const names = wanted ? [wanted] : FEED_NAMES;
  const results = await Promise.all(names.map((n) => oneFeed(n, signal)));
  const failed = results.filter((r) => r.error);

  // Every feed failed — the platform is unreachable, and saying "unavailable"
  // rather than "error" tells the being this is a door that may open again,
  // not a call it got wrong.
  if (failed.length === results.length) {
    const error = failed.map((r) => `${r.feed}: ${r.error}`).join('\n');
    emit({ status: 'unavailable', summary: `${toolName} — platform unreachable`, detail: error });
    return { tool, status: 'unavailable', error };
  }

  const content = wanted ? results[0] : Object.fromEntries(names.map((n, i) => [n, results[i]]));
  const ok = results.length - failed.length;
  emit({
    status: 'ok',
    summary: failed.length
      ? `${toolName} — ${ok}/${results.length} feeds read`
      : `${toolName} — ${wanted || 'all feeds'}`,
  });
  return { tool, status: 'ok', content: JSON.stringify(content) };
};
