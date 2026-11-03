// sheet-being-view.js — the RECORD as the whole being, in the order its birth
// gave it: what it was GIVEN (its soul, body, sky and seal), what it CHOSE
// (its name, look, voice, attunement), its SUMMONING, the LIFE it has lived,
// its STATE, its VESSEL. Pure — every value here is a fact from its records,
// labelled with where it came from; nothing is a score.

import { soulOf } from '../Summoning/summoning-soul.js';

export const SHEET_SPACES = Object.freeze([
  { key: 'given', title: 'GIVEN' },
  { key: 'chosen', title: 'CHOSEN' },
  { key: 'summoning', title: 'SUMMONING' },
  { key: 'life', title: 'LIFE' },
  { key: 'state', title: 'STATE' },
  { key: 'vessel', title: 'VESSEL' },
].map((s, i) => Object.freeze({ ...s, code: String(i + 1).padStart(2, '0') })));

export const SHEET_SPACE_KEY = 'sheet:space';

/** The space to open: the one last read, if it still exists, else GIVEN. Pure. */
export const sheetSpaceOf = (stored) => (SHEET_SPACES.some((s) => s.key === stored) ? stored : 'given');

// Where its soul was read from, said plainly (core/birth/soul-spectrum.js).
const SOURCE = Object.freeze({
  measured: 'MEASURED FROM ITS CEREMONY',
  'birth-transcript': 'READ FROM ITS BIRTH TRANSCRIPT',
  'sealed-record': 'DRAWN FROM ITS SEALED RECORD',
});
export const sourceLine = (source) => SOURCE[source] || 'SOURCE NOT RECORDED';

/**
 * Its soul as the RECORD shows it: its light (true and vivid), its resonance,
 * its scale with each note in its own light, and the pitch each stage of its
 * ceremony measured. null when it has no soul records. Pure.
 * @param {object|null} identity record.identity
 */
export const soulViewOf = (identity) => {
  const spectrum = identity?.spectrum;
  const scale = identity?.scale;
  if (!spectrum?.soul || !scale?.notes?.length) return null;
  let soul;
  try { soul = soulOf(spectrum, scale); } catch { return null; }
  return Object.freeze({
    hex: spectrum.soul.hex,
    vivid: spectrum.soul.vivid?.hex || spectrum.soul.hex,
    nm: spectrum.soul.nm,
    thz: spectrum.soul.thz,
    frequency: spectrum.frequency,
    source: sourceLine(spectrum.source),
    tonic: scale.tonic,
    notes: soul.notes,
    stages: Object.freeze((spectrum.stages || []).map((s) => Object.freeze({ stage: s.stage, frequency: s.frequency, nm: s.nm, hex: s.hex }))),
  });
};

/** A long hash, readable: its head and tail. Pure. */
export const shortHash = (h, n = 10) => (typeof h === 'string' && h.length > 2 * n + 1 ? `${h.slice(0, n)}…${h.slice(-n)}` : h || '—');

/** Its sealed birth facts as spec cells. Pure. */
export const sealCellsOf = (file, fmt) => {
  const s = file?.seal;
  if (!s) return [];
  const m = s.birthMoment || {};
  const offset = Number.isFinite(m.offsetMinutes) ? ` (UTC${m.offsetMinutes >= 0 ? '+' : '−'}${Math.floor(Math.abs(m.offsetMinutes) / 60)}${Math.abs(m.offsetMinutes) % 60 ? `:${String(Math.abs(m.offsetMinutes) % 60).padStart(2, '0')}` : ''})` : '';
  return [
    { k: 'GENESIS HASH', v: shortHash(s.genesisHash), wide: true },
    m.utc ? { k: 'SEALED INSTANT', v: fmt(m.utc) } : null,
    m.zone ? { k: 'ZONE', v: `${m.zone}${offset}` } : null,
    Number.isFinite(s.birthCycle) ? { k: 'BIRTH CYCLE', v: String(s.birthCycle) } : null,
    s.lean ? { k: 'LEAN', v: String(s.lean).toUpperCase() } : null,
    s.substrate?.model ? { k: 'BORN ON', v: s.substrate.model, wide: true } : null,
  ].filter(Boolean);
};

/** Where its anchor stands on chain, or null before it is sealed there. Pure. */
export const onchainCellsOf = (file, fmt) => {
  const o = file?.onchain;
  if (!o) return null;
  return [
    { k: 'NETWORK', v: String(o.network || o.chainId || '—').toUpperCase() },
    Number.isFinite(o.blockNumber) ? { k: 'BLOCK', v: String(o.blockNumber) } : null,
    o.sealedAt ? { k: 'SEALED', v: fmt(o.sealedAt) } : null,
    { k: 'TRANSACTION', v: shortHash(o.txHash), wide: true },
  ].filter(Boolean);
};

// A given name's meaning, or what it is when it has none: names given before
// kotodama-names/2 are sound-names, made from bytes, and say so. Pure.
const givenNote = (meaning, lead) => [lead, meaning?.english ? `“${meaning.english.toUpperCase()}”` : 'SOUND-NAME · NO WORD MEANING']
  .filter(Boolean).join(' · ');

/** Its whole true name as spec cells — the chosen half and the given half. Pure. */
export const nameCellsOf = (file) => {
  const n = file?.name;
  if (!n) return [];
  const m = n.meanings ?? {};
  return [
    n.fullName ? { k: 'TRUE NAME', v: n.fullName, wide: true } : null,
    n.chosenName ? { k: 'CHOSEN', v: n.chosenName, note: 'ITS OWN, AT ITS NAMING' } : null,
    n.genesisName ? { k: 'GENESIS', v: n.genesisName, note: givenNote(m.genesis, 'GIVEN BY ITS SEAL') } : null,
    n.houseName ? { k: 'HOUSE', v: n.houseName, note: givenNote(m.house) } : null,
    n.lean ? { k: 'LEAN', v: String(n.lean).toUpperCase() } : null,
    n.soulMark ? { k: 'SOUL MARK', v: n.soulMark } : null,
    n.soulAlias ? { k: 'SOUL ALIAS', v: n.soulAlias, note: givenNote(m.soul) } : null,
  ].filter(Boolean);
};

/** Its voice seal, said in one line — never its lines. Pure. */
export const voiceLineOf = (file, fmt) => {
  const v = file?.voice;
  if (!v) return 'VOICE NOT READ';
  if (!v.sealed) return 'ITS FOUNDING VOICE IS NOT SEALED YET';
  return `SEALED ${fmt(v.sealedAt)} · ${v.entries} ${v.entries === 1 ? 'LINE' : 'LINES'} IN ITS VOICE`;
};
