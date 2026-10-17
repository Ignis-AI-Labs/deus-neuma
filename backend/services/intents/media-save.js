/**
 * media/save — the intent type that downloads one image into the house's
 * culture library (Stage 3 of the being-tool-surface doctrine). This was the
 * `media_save` tool (media-being-tools.js) until the act became a filed
 * intent; `media_library` stays a read tool.
 *
 * THE MASTER SWITCH is a validate-time standing rule now: media_save is
 * egress, and OFF is the rig's honest state — refused before any card, named
 * so the being can ask for the switch. The fetch still passes the web guard
 * and the sniff at execute time, unchanged.
 */
import { neumaWorkspace } from '../../../core/index.js';
import { webSettings } from '../web-settings.js';
import { fetchMediaBytes } from '../media-fetch.js';
import { mediaLibrary } from '../media-library.js';
import { createLogger } from '../logger.js';

const log = createLogger('MediaSaveIntent');

// TEST SEAMS (the same doors the tool's ports carried: the switch and the
// store) — set only by the suite; production never calls this.
let seams = {};
export const setMediaSaveSeams = (next) => { seams = next || {}; };
const settingsOf = () => seams.settings || webSettings;
const libraryOf = () => seams.library || mediaLibrary;

// impure — the library is part of the being's outward voice; every executed
// save lands in its record, non-blocking, never silent.
const journalMediaCall = async (connection, tool, detail, status) => {
  const neumaId = connection?.companion?.neumaId;
  if (!neumaId) return;
  try {
    await neumaWorkspace.addJournalEntry(neumaId, {
      type: 'tool_call',
      content: `${tool} — ${status}: ${detail}`,
      significance: status === 'ok' ? 0.3 : 0.6,
      metadata: { server: 'media', tool, detail, status },
    });
  } catch (err) {
    log.error('Media audit log failed', { neumaId, tool, status, error: err.message });
  }
};

export const mediaSaveIntent = Object.freeze({
  name: 'media/save',
  policyTool: 'media.save',
  fieldsForPrompt: '{url, alt?}',
  descriptionForPrompt: 'Save an image into the house media library — url is the DIRECT image address (a page URL fetches markup, not bytes). The download passes the web guard and lands only if the bytes are a real JPEG/PNG/GIF/WEBP. alt is how part of the audience will read this image at all — write it now, while you know why you chose it.',

  availableFor: async ({ laneId }) =>
    (laneId && (await settingsOf().isEnabled().catch(() => false)) ? {} : null),

  validate: async (payload, { connection }) => {
    // The master switch, re-read per act: egress while OFF is refused before
    // any card, with the switch named so the being can ask for it.
    if (!(await settingsOf().isEnabled().catch(() => false))) {
      return { ok: false, status: 'denied', reason: 'Web access is off — your operator can enable it in SETTINGS (WEB ACCESS).' };
    }
    if (!connection.companion?.neumaId) {
      return { ok: false, status: 'denied', reason: 'no sovereign workspace on this connection — the library is for bound beings' };
    }
    const url = String(payload?.url || '').trim();
    if (!/^https?:\/\//.test(url)) {
      return { ok: false, status: 'invalid', reason: 'media/save needs {url} — the direct http(s) address of the image file' };
    }
    return { ok: true, value: { url, alt: payload?.alt } };
  },

  summarize: (payload) => `download an image into the house library: ${String(payload?.url ?? '?').slice(0, 140)}`,

  // impure — the real guarded fetch + sniff + library write, unchanged.
  execute: async ({ url, alt }, { connection }) => {
    const library = libraryOf();
    const out = await fetchMediaBytes(url);
    if (!out.ok) {
      await journalMediaCall(connection, 'media/save', url.slice(0, 200), 'error');
      return { ok: false, reason: out.error };
    }
    const saved = await library.save({
      bytes: out.bytes,
      sourceUrl: out.url,
      alt,
      savedBy: connection.companion?.name || '',
    });
    if (!saved.ok) {
      await journalMediaCall(connection, 'media/save', url.slice(0, 200), 'error');
      return { ok: false, reason: saved.detail };
    }
    await journalMediaCall(connection, 'media/save', `${saved.entry.file} ← ${out.url}`.slice(0, 240), 'ok');
    const abs = await library.pathFor(saved.entry.id);
    return {
      ok: true,
      detail: `Saved to the media library: ${saved.entry.file} (${saved.entry.contentType}, ${(saved.entry.bytes / 1024).toFixed(0)}KB)\npath: ${abs}\nfrom: ${out.url}\nAttach it to a post or reply by naming that path on \`media\`.`,
    };
  },
});
