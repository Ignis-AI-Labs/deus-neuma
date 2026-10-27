// update-notes.cjs — what the desk's update bar and WHAT'S NEW panel say, as data. Pure.
//
// The notes for a version are its release notes file (docs/operations/release-notes-<v>.md),
// which the release flow copies to build/release-notes.md before electron-builder runs.
// electron-builder writes that file into the signed feed as
// `releaseNotes` and the app carries it too, so the same text reaches two readers:
//   - an install that is OFFERED the version (the feed, checked against the release key first)
//   - the new version itself, the first time it starts (the copy inside the app)
// A notes file is cumulative: one […] section per version, newest first,
// then the standing description. A reader is shown only the sections newer than what it ran.

const VERSION_SHAPE = /^\d+\.\d+\.\d+$/;
const SECTION_HEADING = /^## New in (\d+\.\d+\.\d+)[ \t]*$/gm;

/** A plain x.y.z version, or null. Pure. */
const plainVersion = (value) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return VERSION_SHAPE.test(text) ? text : null;
};

/**
 * Compare two x.y.z versions: negative when a is older, 0 when equal, positive when newer.
 * Anything that is not x.y.z sorts as older than every version. Pure.
 */
const compareVersions = (a, b) => {
  const pa = plainVersion(a);
  const pb = plainVersion(b);
  if (!pa || !pb) return (pa ? 1 : 0) - (pb ? 1 : 0);
  const na = pa.split('.').map(Number);
  const nb = pb.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (na[i] !== nb[i]) return na[i] - nb[i];
  }
  return 0;
};

/**
 * The feed's releaseNotes as one text, or null. electron-updater gives a string for a generic
 * feed and a list of { version, note } for some providers; both are accepted. Pure.
 */
const notesText = (releaseNotes) => {
  const text = Array.isArray(releaseNotes)
    ? releaseNotes.map((n) => (typeof n?.note === 'string' ? n.note : '')).join('\n\n')
    : (typeof releaseNotes === 'string' ? releaseNotes : '');
  return text.trim() === '' ? null : text.trim();
};

/**
 * The "New in" sections a reader has not seen: newer than `after` (exclusive; null = only the
 * newest section) and no newer than `upTo`. A notes text with no "New in" sections is one
 * section under `upTo`. Returns [] when nothing applies. Pure.
 * @param {string|null} text
 * @param {{ after: string|null, upTo: string }} range
 * @returns {{ version: string, body: string }[]}
 */
const selectNotes = (text, { after, upTo }) => {
  if (typeof text !== 'string' || text.trim() === '') return [];
  const marks = [...text.matchAll(SECTION_HEADING)];
  if (marks.length === 0) return [{ version: upTo, body: text.trim() }];
  const sections = marks.map((mark, i) => {
    const start = mark.index + mark[0].length;
    const next = text.slice(start).search(/^## /m);
    const end = next === -1 ? text.length : start + next;
    return { version: mark[1], body: text.slice(start, end).trim() };
  });
  const within = sections.filter((s) => compareVersions(s.version, upTo) <= 0 && s.body !== '');
  if (after == null) return within.length ? [within.reduce((a, b) => (compareVersions(b.version, a.version) > 0 ? b : a))] : [];
  return within.filter((s) => compareVersions(s.version, after) > 0);
};

/**
 * Whether WHAT'S NEW opens on its own at this launch: the app runs a newer version than the
 * one last seen, or the record is new but the install is not (it asked the feed before — the
 * versions from before the record existed). A fresh install opens nothing. Pure.
 */
const whatsNewDue = ({ current, lastSeen, installedBefore }) => {
  if (!plainVersion(current)) return false;
  if (plainVersion(lastSeen)) return compareVersions(current, lastSeen) > 0;
  return installedBefore === true;
};

/**
 * The bar, or null. A downloaded update (self installs) asks for a restart; an available one on
 * a system-package install asks for the downloads page. Nothing shows for a version the person
 * set aside this run, or for one that is not newer than the running app. Pure.
 * @param {{ form: string, ready: boolean, availableVersion: string|null, notes: string|null }} offer
 * @param {{ current: string, dismissed: string|null }} seen
 */
const barFor = (offer, { current, dismissed }) => {
  const version = plainVersion(offer?.availableVersion);
  if (!version || compareVersions(version, current) <= 0 || version === dismissed) return null;
  let action = null;
  if (offer.ready) action = 'restart';
  else if (offer.form === 'notify') action = 'download';
  if (!action) return null;
  return Object.freeze({
    version,
    action,
    notes: selectNotes(offer.notes, { after: current, upTo: version }),
  });
};

module.exports = {
  plainVersion,
  compareVersions,
  notesText,
  selectNotes,
  whatsNewDue,
  barFor,
};
