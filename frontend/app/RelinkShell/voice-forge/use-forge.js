// use-forge.js — the voice forge's state machine for one being.
//
// impure hook: opens a forge for the bound being (POST /start answers the
// session, the being's voice standing and any candidate already on offer),
// carries the three steps — FIND → HEAR → SEAL — and keeps the screen on the
// server's truth: every act answers the new forge state, and while the being
// is still answering an offered voice the state is re-read on a beat, so its
// acceptance (or its wish for another) appears without a click.
//
// Every take a door finds is at once heard as the being (GET …/preview): the
// clip and its words are the voice, nothing trains, so the forge shows the
// being speaking in it — the line plays by itself once when it is the take
// just chosen. `previews` holds each take's making · ready · failed, by ref.
//
// The forge ends (DELETE) when the window closes or the being changes: a
// forge with a pinned take makes the being's chat turns AUDITIONS, which must
// never outlive the sitting that asked for them.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  endForge, findVoice, offerTake, pickTake, readForge, reopenVoice, sealVoice, startForge, takePreviewUrl, uploadVoice, withdrawVoice,
} from './forge-client.js';
import { openingStep, refsToPreview, sealStandingOf } from './forge-model.js';
import { playUrl, takeKeyOf } from './forge-player.js';

// How often the seal step re-reads the being's answer while it is waiting.
export const ANSWER_POLL_MS = 4000;

// `errorAt` names the act that failed (record · upload · describe ·
// library:<id> · offer · seal · reopen · …) so a view shows its own error in
// place; `foundBy` keeps each door's last find, so a view shows only its own takes.
const BLANK = Object.freeze({
  forge: null, sessionId: null, step: 'find', foundBy: {}, previews: {}, busy: null, busyAt: null, error: null, errorAt: null, sealed: null,
});

/**
 * @param {string|null} neumaId - the bound being
 */
export const useForge = (neumaId) => {
  const [s, setS] = useState(BLANK);
  const sessionRef = useRef(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const patch = useCallback((next) => { if (alive.current) setS((prev) => ({ ...prev, ...next })); }, []);

  // The previews, mirrored in a ref so a find reads them as they stand.
  const previewsRef = useRef({});
  const setPreview = useCallback((ref, preview) => {
    previewsRef.current = { ...previewsRef.current, [ref]: Object.freeze(preview) };
    patch({ previews: previewsRef.current });
  }, [patch]);

  // impure — run one forge act: busy (with where) while it runs, the server's refusal kept with where it failed.
  const act = useCallback(async (busy, fn, at = busy) => {
    patch({ busy, busyAt: at, error: null, errorAt: null });
    try {
      const out = await fn();
      patch({ busy: null, busyAt: null });
      return out;
    } catch (err) {
      patch({ busy: null, busyAt: null, error: err?.message || String(err), errorAt: at });
      return null;
    }
  }, [patch]);

  // Each opening is an epoch: a start that answers after the being changed
  // (or after StrictMode's double mount) ends its own forge and is dropped.
  const epoch = useRef(0);

  const start = useCallback(() => {
    const mine = epoch.current;
    return act('starting', async () => {
      if (!neumaId) return null;
      const state = await startForge(neumaId);
      if (mine !== epoch.current || !alive.current) {
        endForge(state.session.id);
        return null;
      }
      sessionRef.current = state.session.id;
      previewsRef.current = {};
      patch({ forge: state, sessionId: state.session.id, step: openingStep(state), foundBy: {}, previews: {}, sealed: null });
      return state;
    });
  }, [act, neumaId, patch]);

  // One forge per bound being; it ends when the being changes or the window closes.
  useEffect(() => {
    epoch.current += 1;
    setS(BLANK);
    if (neumaId) start();
    return () => {
      epoch.current += 1;
      if (sessionRef.current) endForge(sessionRef.current);
      sessionRef.current = null;
    };
  }, [neumaId, start]);

  const sid = () => sessionRef.current;

  // impure — ask for one take's being-preview; play it once when asked to.
  // A preview that answers after the forge changed is dropped.
  const preparePreview = useCallback(async (ref, { autoplay = false } = {}) => {
    const id = sid();
    if (!id) return;
    setPreview(ref, { state: 'making', kind: null, error: null });
    try {
      const { url, kind } = await takePreviewUrl(id, ref);
      if (id !== sid() || !alive.current) { URL.revokeObjectURL(url); return; }
      setPreview(ref, { state: 'ready', kind, error: null });
      // The raw clip is not the being speaking: it waits for its own ▶.
      if (!autoplay || kind !== 'being') { URL.revokeObjectURL(url); return; }
      // A browser that refuses to play unasked leaves the ▶ beside it to press.
      playUrl(url, { key: takeKeyOf(ref, true) }).started.catch(() => {});
    } catch (err) {
      if (id === sid()) setPreview(ref, { state: 'failed', kind: null, error: err?.message || String(err) });
    }
  }, [setPreview]);

  // impure — keep what a door found under that door, and start hearing each new take as the being.
  const found = useCallback((door, state) => {
    if (alive.current) setS((prev) => ({ ...prev, forge: state, foundBy: { ...prev.foundBy, [door]: state.found ?? [] } }));
    for (const ref of refsToPreview(state.found, previewsRef.current)) preparePreview(ref, { autoplay: ref === state.session?.pinned });
  }, [preparePreview]);

  const find = useCallback((body) => act('finding', async () => {
    const state = await findVoice(sid(), body);
    found(body.door, state);
    return state;
  }, body.door === 'library' ? `library:${body.libraryId}` : body.door), [act, found]);

  const upload = useCallback((file) => act('finding', async () => {
    const state = await uploadVoice(sid(), file);
    found('upload', state);
    return state;
  }, 'upload'), [act, found]);

  const pick = useCallback((ref) => act('picking', async () => {
    const state = await pickTake(sid(), ref);
    patch({ forge: state });
    return state;
  }), [act, patch]);

  const offer = useCallback((body) => act('offering', async () => {
    const state = await offerTake(sid(), body);
    patch({ forge: state, step: 'seal' });
    return state;
  }, 'offer'), [act, patch]);

  const seal = useCallback(() => act('sealing', async () => {
    const { candidateRef } = sealStandingOf(s.forge);
    const out = await sealVoice(sid(), candidateRef);
    // The seal ends the forge on the server; nothing is left to end here.
    sessionRef.current = null;
    patch({ sealed: out.dna ?? null, sessionId: null, forge: { ...s.forge, ...out }, step: 'sealed' });
    return out;
  }, 'seal'), [act, patch, s.forge]);

  const reopen = useCallback(() => act('reopening', async () => {
    const state = await reopenVoice(sid());
    patch({ forge: state, step: 'seal' });
    return state;
  }, 'reopen'), [act, patch]);

  // The voice in force is withdrawn (kept in the being's history, never
  // deleted); the forge re-opens on the being's new standing — silent.
  const withdraw = useCallback(async () => {
    const out = await act('withdrawing', () => withdrawVoice(neumaId));
    if (out) await start();
    return out;
  }, [act, neumaId, start]);

  const refresh = useCallback(async () => {
    if (!sid()) return;
    try {
      patch({ forge: await readForge(sid()) });
    } catch (err) {
      patch({ error: err?.message || String(err), errorAt: 'refresh' });
    }
  }, [patch]);

  const goTo = useCallback((step) => patch({ step, error: null, errorAt: null }), [patch]);

  const clearError = useCallback(() => patch({ error: null, errorAt: null }), [patch]);

  // The being answers in its own turn; re-read on a beat while it has not.
  const waiting = s.step === 'seal' && sealStandingOf(s.forge).standing === 'waiting';
  useEffect(() => {
    if (!waiting) return undefined;
    const iv = setInterval(refresh, ANSWER_POLL_MS);
    return () => clearInterval(iv);
  }, [waiting, refresh]);

  return { ...s, start, find, upload, preparePreview, pick, offer, seal, reopen, withdraw, refresh, goTo, clearError };
};
