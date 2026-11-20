// Media tools FOR the being — the culture library's door (Design note, 2026-07-28:
// […]).
//
//   media_library — read the repository {}. What has been saved, each with
//                   its absolute path — the path named on `media` when a
//                   post or reply attaches it. Reading is observation, so
//                   it is allowed by default (queue_list's own law).
//
// SAVING became the media/save INTENT (Stage 3): egress + a write into the
// house's voice, filed and settled by the sweep — the web-access master
// switch is a validate-time standing rule there.
//
//   media_watch / media_listen — watch a video or listen to audio from any
//                   source, a link or a file (Design note, 2026-11-14: […]). What is said, timed, and frames to look at;
//                   watch/watch.js does it. Egress like web_fetch, so it asks
//                   like web_fetch (an unlisted tool asks: tool-policy.js).
//
// Portal-stream owns the socket, so the event sender arrives as an injected
// port; the ACTS gate itself is act-gate.js, the one implementation both
// seats share.

import { gateAct } from './act-gate.js';
import { webSettings } from './web-settings.js';
import { mediaLibrary } from './media-library.js';
import { watchSource } from './watch/watch.js';
import { neumaWorkspace } from '../../core/index.js';

export const MEDIA_TOOLS = Object.freeze([
  Object.freeze({
    name: 'media_library',
    server: 'media',
    description: 'Read the house media library — args {}. Every saved image with its id, path, size, format, alt text, and where it came from. Name an entry\'s path on `media` when staging a post or reply to attach it. Saving is the media/save intent.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({}),
    }),
  }),
  Object.freeze({
    name: 'media_watch',
    server: 'media',
    description: 'Watch a video — args {source, from?, to?}. source: a link from any site (YouTube, X, TikTok, Instagram, Facebook, Vimeo, Twitch, Reddit, a news site, a direct video file) or a video file on this computer. You get what is said, with the second each line begins (its own captions, or heard on this computer), and frames from across it to look at. One call covers ten minutes from `from` (default the start; "12:30" or "1:02:00"); call again with the `from` it gives for the next part. The transcript is kept in your workspace under watched/.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        source: Object.freeze({ type: 'string', description: 'the link, or the path of a file on this computer' }),
        from: Object.freeze({ type: 'string', description: 'where to start, like "12:30" (default the start)' }),
        to: Object.freeze({ type: 'string', description: 'where to stop (default ten minutes on, at most thirty)' }),
      }),
      required: Object.freeze(['source']),
    }),
  }),
  Object.freeze({
    name: 'media_listen',
    server: 'media',
    description: 'Listen to audio — args {source, from?, to?}. source: a podcast episode, an interview, a talk, a speech, a song, a voice note: a link from any site (YouTube, SoundCloud, Apple Podcasts, Bandcamp, Mixcloud, X, a direct audio file) or an audio or video file on this computer. You get what is said, with the second each line begins. One call covers ten minutes from `from`; call again with the `from` it gives for the next part. The transcript is kept in your workspace under watched/.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        source: Object.freeze({ type: 'string', description: 'the link, or the path of a file on this computer' }),
        from: Object.freeze({ type: 'string', description: 'where to start, like "12:30" (default the start)' }),
        to: Object.freeze({ type: 'string', description: 'where to stop (default ten minutes on, at most thirty)' }),
      }),
      required: Object.freeze(['source']),
    }),
  }),
]);

const MEDIA_TOOL_NAMES = new Set(MEDIA_TOOLS.map((t) => t.name));

export const isMediaTool = (match) =>
  MEDIA_TOOL_NAMES.has(String(match.toolName || '').replace(/^media__/, '')) ||
  MEDIA_TOOL_NAMES.has(String(match.tool || '').replace(/^media\//, ''));

/**
 * The media catalog for this turn's prompt. The master switch gates the
 * FAMILY (saving is egress — the media/save intent, refused at validate time
 * while OFF); a bound being is required. impure (fs/env via web-settings).
 * @param {Object} connection - portal connection
 * @returns {Promise<Array<Object>>}
 */
export const mediaToolsFor = async (connection, settings = webSettings) => {
  if (!connection?.companion?.neumaId) return [];
  return (await settings.isEnabled()) ? [...MEDIA_TOOLS] : [];
};

// pure — the repository as the being reads it: one instrument line per
// entry, path first (the path is what `media` names), provenance attached.
// Bounded: a library is scanned, not dumped — the cap says so honestly.
const LIBRARY_LIST_CAP = 50;
const renderLibrary = (entries) => {
  if (!entries.length) {
    return 'The media library is empty. Find images with image_search and bring them home with a media/save intent.';
  }
  const shown = entries.slice(-LIBRARY_LIST_CAP);
  const rows = shown
    .map((e) => `- ${e.file} (${e.contentType}, ${(e.bytes / 1024).toFixed(0)}KB)\n  path: ${e.path}${e.alt ? `\n  alt: ${e.alt}` : ''}${e.sourceUrl ? `\n  from: ${e.sourceUrl}` : ''}\n  saved ${e.savedAt}${e.savedBy ? ` by ${e.savedBy}` : ''}`)
    .join('\n');
  const more = entries.length > shown.length ? `\n(…and ${entries.length - shown.length} older — the library keeps everything; this lists the latest ${LIBRARY_LIST_CAP}.)` : '';
  return `The media library — ${entries.length} image(s):\n${rows}${more}`;
};

/**
 * Route a media tool call: master switch → bound being → ACTS gate → the
 * real action. Never the MCP path.
 * @param {Object} ws - the portal socket
 * @param {Object} connection - portal connection (companion, session policy, active turn)
 * @param {Object|null} neumaPolicy - the neuma's persisted tool policy
 * @param {string} toolMode - session ACTS mode
 * @param {Object} match - parsed tool call
 * @param {Object} args - parsed tool args
 * @param {{sendToolEvent: Function, webSettings?: Object, library?: Object}} ports
 *   portal-owned seams, plus test doors for the switch and the store.
 * @returns {Promise<{tool: string, status: string, content?: string, error?: string}>}
 */
// impure
export const handleMediaTool = async (ws, connection, neumaPolicy, toolMode, match, args, ports) => {
  const bare = String(match.toolName || '').replace(/^media__/, '');
  const toolName = MEDIA_TOOL_NAMES.has(bare) ? bare : String(match.tool || '').replace(/^media\//, '');
  const tool = `media/${toolName}`;
  const { companion } = connection;
  const settings = ports.webSettings || webSettings;
  const library = ports.library || mediaLibrary;

  // The master switch stands before policy: the library read shares the
  // family gate, and OFF is the rig's honest state — said so the being can
  // ask for the switch.
  if (!(await settings.isEnabled())) {
    const error = 'Web access is off — your operator can enable it in SETTINGS (WEB ACCESS).';
    ports.sendToolEvent(ws, companion, { tool, status: 'unavailable', summary: `${toolName} — web access off` });
    return { tool, status: 'unavailable', error };
  }

  // No being, no save: every executed call must land in a journal, and
  // there is no journal without a sovereign workspace.
  if (!companion?.neumaId) {
    const error = 'no sovereign workspace on this connection — the library is for bound beings';
    ports.sendToolEvent(ws, companion, { tool, status: 'unavailable', summary: `${toolName} — no workspace` });
    return { tool, status: 'unavailable', error };
  }

  const gate = await gateAct(connection, {
    server: 'media', tool: toolName, args,
    lanePolicy: neumaPolicy, mode: toolMode,
    emit: (event) => ports.sendToolEvent(ws, companion, event),
  });
  if (!gate.ok) return gate.result;

  if (toolName === 'media_watch' || toolName === 'media_listen') {
    const mode = toolName === 'media_watch' ? 'watch' : 'listen';
    const laneId = companion.neumaId;
    const watched = await watchSource({
      laneId, laneDir: neumaWorkspace.pathFor(laneId), source: args?.source, from: args?.from, to: args?.to, mode,
    });
    if (!watched.ok) {
      ports.sendToolEvent(ws, companion, { tool, status: 'error', summary: watched.summary, detail: watched.error });
      return { tool, status: 'error', error: watched.error };
    }
    ports.sendToolEvent(ws, companion, { tool, status: 'ok', summary: watched.summary, ...(watched.file ? { path: watched.file } : {}) });
    return {
      tool, status: 'ok', content: watched.content,
      ...(watched.imageIds.length ? { sight: { laneId, imageIds: watched.imageIds, store: 'ephemeral', purpose: 'watch-frames' } } : {}),
    };
  }

  try {
    // media_library (saving is the media/save intent).
    const entries = await library.list();
    ports.sendToolEvent(ws, companion, {
      tool, status: 'ok',
      summary: `${entries.length} image(s) in the library`,
    });
    return { tool, status: 'ok', content: renderLibrary(entries) };
  } catch (err) {
    ports.sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — failed`, detail: err.message });
    return { tool, status: 'error', error: err.message };
  }
};
