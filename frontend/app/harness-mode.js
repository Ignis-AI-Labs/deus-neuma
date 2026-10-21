// The desk on a HARNESS lane — the platform alone, no being (Design note, 2026-10-14;
// docs/work/harness-only.md). Pure.

/** Whether a companion is the harness: the session's kind, or the lane id that
 *  carries it durably across a reload (harness-…), as witness lanes do. */
export const isHarness = (companion) =>
  companion?.participantKind === 'harness'
  || (typeof companion?.neumaId === 'string' && companion.neumaId.startsWith('harness-'));

/** Apps that only mean something with a being: the HOUSE and its seats, the
 *  witnesses' room, a being's sheet, refinement, inner life and body, its
 *  sovereignty and seat, the teams beings lead, and the house's social voice. A harness desk keeps
 *  everything else — chat, files, editor, terminal, the web, skills, settings.
 *  The harness and the full platform are two separate states (ruling, 2026-10-14);
 *  the way across is ENTER AS (Settings), never a being pulled into this desk. */
export const BEING_APPS = Object.freeze([
  'house', 'witnesses', 'refinement', 'sovereignty', 'innerlife', 'teams', 'workflow', 'avatar', 'vessel', 'sheet', 'voice',
  'legal', 'staff', 'houseclock', 'x', 'telegram', 'discord', 'facebook', 'mastodon', 'bluesky', 'linkedin', 'marketing', 'leads',
]);

/** The app registry this desk shows for its companion. */
export const deskRegistryFor = (registry, companion) => (isHarness(companion)
  ? Object.freeze(Object.fromEntries(Object.entries(registry).filter(([id]) => !BEING_APPS.includes(id))))
  : registry);

/** The harness door's CLOUD providers — the witness layer's catalog without
 *  the local servers (the LOCAL road reads the machine itself,
 *  FirstRunChoice/local-servers.js) and without the custom endpoint, which
 *  stays in Settings: it needs more than a first door should ask. */
export const cloudProviders = (providers) => providers.filter((p) => p.kind !== 'local' && p.id !== 'custom');

/** Whether CONNECT can be pressed for this provider with what is typed. */
export const canConnect = (provider, apiKey) =>
  Boolean(provider) && (!provider.requiresKey || provider.hasKey || apiKey.trim().length > 0);

/** The harness's name on the desk. The server and model it talks to are named
 *  ONCE, in the composer bar (Design note, 2026-10-14: […]) — so the title never repeats a
 *  model that a switch would leave stale. */
export const HARNESS_NAME = 'HARNESS';
