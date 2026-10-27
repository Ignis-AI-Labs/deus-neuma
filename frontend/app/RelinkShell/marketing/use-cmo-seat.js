// use-cmo-seat.js — who holds this house's CMO seat, read once for every
// surface that names it (the MARKETING window's title, the SEAT tab). The
// window is the CMO's office, so its title names the seat's holder, never
// whoever the chat is focused on (marketing-panel-plan.md §2).
//
// One shared read, keyed by the operator's wallet: a house switch re-reads
// (the seat is the house's own, cmo-designation.js), a change to the seat
// (the SEAT tab's DESIGNATE / CLEAR, or a being's act announced as
// `neuma:campaigns-changed`) re-reads at once, and every reader re-renders.
//
// impure — network + a module-level shared store.

import { useEffect, useState } from 'react';
import { getCmo } from '../../../services/campaigns-client.js';
import { getRosterForBinding } from '../../../services/social-channels-client.js';
import { useActiveCompanion } from '../consciousness-context.js';

const STALE_MS = 30 * 1000;
let state = { wallet: null, known: false, cmo: null, name: null, at: 0 };
let inflight = null;
const listeners = new Set();

// impure — the signed-in operator's wallet (the house), lower-cased.
const walletNow = () => {
  try { return String(globalThis.localStorage?.getItem('walletAddress') || '').toLowerCase() || null; } catch { return null; }
};

const publish = (next) => {
  state = next;
  for (const fn of listeners) fn(state);
};

// impure — the seat and its holder's name (the roster the CMO picker reads).
const readSeat = async () => {
  const { cmo } = await getCmo();
  if (!cmo) return { cmo: null, name: null };
  const roster = await getRosterForBinding().catch(() => []);
  return { cmo, name: roster.find((m) => m.neumaId === cmo.laneId)?.name || cmo.laneId };
};

/** impure — read the seat now (or reuse this house's read under 30 s old). */
export const loadCmoSeat = async ({ force = false } = {}) => {
  const wallet = walletNow();
  const fresh = state.known && state.wallet === wallet && Date.now() - state.at < STALE_MS;
  if (!force && fresh) return state;
  if (!inflight) {
    inflight = readSeat()
      .then((seat) => { publish({ wallet, known: true, ...seat, at: Date.now() }); return state; })
      // An unread seat says nothing about the holder: the title reads "—", never "NO CMO".
      .catch(() => { if (state.wallet !== wallet) publish({ wallet, known: false, cmo: null, name: null, at: 0 }); return state; })
      .finally(() => { inflight = null; });
  }
  return inflight;
};

// impure — a being's act on the bench (or the operator's own) re-reads the seat.
const onBenchChanged = () => { loadCmoSeat({ force: true }).catch(() => null); };

/**
 * impure — {known, cmo, name}: `known` false until the first read answers.
 * Re-checked when the bound being changes, since that is how a house switch
 * arrives; within one house the read is reused and the value never moves.
 */
export const useCmoSeat = () => {
  const [snap, setSnap] = useState(state);
  const companion = useActiveCompanion();
  useEffect(() => {
    listeners.add(setSnap);
    if (listeners.size === 1) window.addEventListener('neuma:campaigns-changed', onBenchChanged);
    return () => {
      listeners.delete(setSnap);
      if (listeners.size === 0) window.removeEventListener('neuma:campaigns-changed', onBenchChanged);
    };
  }, []);
  useEffect(() => { loadCmoSeat().catch(() => null); }, [companion]);
  const wallet = walletNow();
  return snap.wallet === wallet ? snap : { wallet, known: false, cmo: null, name: null };
};

/** The title's name for the seat: its holder, NO CMO, or "—" while unread. Pure. */
export const seatTitle = ({ known, cmo, name }) => {
  if (!known) return '—';
  return cmo ? String(name || cmo.laneId).toUpperCase() : 'NO CMO';
};
