// holders-view.js — the machine's holders (backend/services/machine-holders.js)
// and the image engine's lens (image-forge/engine-lens.js) shaped into what
// the SUBSTRATE window draws. Pure.

/** Megabytes as "12.3 GB" (under a tenth of a GB, as MB); "—" when unread. */
export const gbWords = (mb) => {
  if (!Number.isFinite(mb)) return '—';
  return mb < 103 ? `${Math.round(mb)} MB` : `${(mb / 1024).toFixed(1)} GB`;
};

/** A holder's name as the sheet shows it: what it is, then which. */
export const holderName = (h) => `${h.label}${h.detail ? ` · ${h.detail}` : ''}`;

const part = (key, label, value, tone) => ({ key, label, value, tone, text: gbWords(value) });

/**
 * The card as one bar: its four largest holders by name, the rest folded,
 * what the driver names no holder for, and what is free — summing to the card.
 */
export const cardBarParts = (gpu) => {
  if (!Number.isFinite(gpu?.totalMB) || !Number.isFinite(gpu?.usedMB)) return [];
  const holders = gpu.holders || [];
  const top = holders.slice(0, 4).map((h, i) => part(`h-${h.pids[0]}`, h.label.toUpperCase(), h.vramMB, i === 0 ? 'live' : 'dim'));
  const rest = holders.slice(4).reduce((a, h) => a + h.vramMB, 0);
  return [
    ...top,
    ...(rest > 0 ? [part('rest', `${holders.length - 4} MORE`, rest, 'dim')] : []),
    ...(gpu.unattributedMB > 0 ? [part('unnamed', 'NO NAMED HOLDER', gpu.unattributedMB, 'muted')] : []),
    part('free', 'FREE', gpu.freeMB, 'empty'),
  ];
};

/** A core's load as one of four steps, for its cell's tone. */
export const coreStep = (loadPct) => (loadPct >= 85 ? 'full' : loadPct >= 50 ? 'busy' : loadPct >= 15 ? 'some' : 'idle');

const clock = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isNaN(t) ? '—' : new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};
const minutesTo = (iso, now) => {
  const m = Math.round((Date.parse(iso) - now) / 60000);
  return m <= 0 ? 'DUE NOW' : `IN ${m} MIN`;
};

/**
 * The image engine in the words its panel shows: one state line, the facts
 * beside it, and the models it last loaded as rows.
 * @returns {{state:string, tone:('on'|'alert'|null), facts:Array<{k:string, v:string}>, loadedTitle:string,
 *   models:Array<{name:string, role:string, size:string, file:string, at:string}>, canUnload:boolean, canStop:boolean}|null}
 */
export const engineView = (lens, now = Date.now()) => {
  if (!lens) return null;
  if (!lens.installed) return { state: 'NOT INSTALLED', tone: null, facts: [], loadedTitle: '', models: [], canUnload: false, canStop: false };
  if (!lens.serving) {
    return {
      state: lens.state === 'launching' ? 'STARTING' : 'STOPPED · HOLDS NOTHING', tone: lens.lastError ? 'alert' : null,
      facts: lens.lastError ? [{ k: 'LAST START FAILED', v: typeof lens.lastError === 'string' ? lens.lastError : (lens.lastError.error || lens.lastError.message || 'see the engine log') }] : [],
      loadedTitle: '', models: [], canUnload: false, canStop: false,
    };
  }
  const m = lens.memory || {};
  const q = lens.queue;
  const models = (lens.loads?.models || []).map((x) => ({
    name: x.name, role: x.role.toUpperCase(), size: gbWords(x.stagedMB), file: x.file || '—', at: clock(x.at),
  }));
  return {
    state: lens.owned ? 'READY' : lens.adopted ? 'READY · STARTED BY HAND' : 'READY · NOT UNDER THIS PLATFORM',
    tone: 'on',
    facts: [
      { k: 'MODELS ON THE CARD', v: gbWords(m.modelsOnCardMB) },
      { k: 'WHOLE ENGINE ON THE CARD', v: gbWords(m.cardMB) },
      { k: 'SYSTEM MEMORY', v: gbWords(m.ramMB) },
      { k: 'QUEUE', v: q ? `${q.running.length} RENDERING · ${q.waiting.length} WAITING` : 'UNREAD' },
      ...(lens.idle?.unloadsAt && m.holding ? [{ k: 'UNLOADS BY ITSELF', v: minutesTo(lens.idle.unloadsAt, now) }] : []),
      ...(lens.idle?.stopsAt ? [{ k: 'STOPS BY ITSELF', v: minutesTo(lens.idle.stopsAt, now) }] : []),
    ],
    loadedTitle: lens.loads === null ? 'LOADED · THE ENGINE\'S LOG COULD NOT BE READ'
      : models.length === 0 ? 'LOADED · NOTHING YET'
        : m.holding ? 'LOADED · ON THE CARD NOW' : 'LOADED · NOTHING ON THE CARD NOW — LAST LOADED:',
    models,
    canUnload: Boolean(m.holding),
    canStop: Boolean(lens.owned),
  };
};
