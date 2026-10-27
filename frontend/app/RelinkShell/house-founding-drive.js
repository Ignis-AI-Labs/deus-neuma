// house-founding-drive — the desk's hand on the wallet when the WITNESS
// establishes her house on chain. Drives the house:found_preflight →
// house:found_ready (wallet personal_sign of the inner payload) →
// house:found_sign → house:found_tx (wallet broadcast) →
// house:found_confirm frames, reusing the seal flow's wallet helpers so
// there is one custody law for every on-chain mark. Every signature and
// broadcast passes the wallet's own gated confirm windows.
//
// The backend chooses the network (HOUSE_FOUND_NETWORK, server-side); the
// wallet is pointed at the chain the PREFLIGHT actually returned — never a
// renderer-side constant. Resolves { ok: true, ...founded } once the
// backend reports house:founded, { ok: true, founded: true, state } when
// the house already stands (the probe answer), or { ok: false, error } on
// any refusal.
//
// impure throughout (WS frames + wallet IPC).

import {
  deskWallet, ensureWalletNetwork, signSealPayload, signSealMessage, broadcastSealTx,
} from '../../components/BirthCeremony/onchain-seal-flow.js';

// The two foundings' frames (2026-10-26): ON THIS COMPUTER (house-local-founding.js — no network, no fee) and
// JOINING UNAVIS on Ethereum (house-founding-flow.js). One rite drives either.
const FRAMES = Object.freeze({
  network: Object.freeze({ pre: 'house:found_preflight', state: 'house:found_state', open: 'house:found_open', error: 'house:found_error' }),
  local: Object.freeze({ pre: 'house:found_local_preflight', state: 'house:found_local_state', open: 'house:found_local_open', error: 'house:found_local_error' }),
});

// A silent backend must never strand the panel: the probe answers within
// this bound or resolves honestly as an error; the founding walk is bounded
// too, generously — the witness deliberates at real wallet windows inside it.
const PROBE_TIMEOUT_MS = 60_000;
const WALK_TIMEOUT_MS = 15 * 60_000;

/**
 * Probe whether the house already stands on the founding network. Resolves
 * { founded: true, state } when it does, { founded: false, open } with the
 * roster for the title form when the founding is open, or { error }.
 * `signal` (AbortSignal) settles the probe early on unmount.
 */
export const probeHouseFounding = ({ wsService, signal = null, timeoutMs = PROBE_TIMEOUT_MS, mode = 'network' }) =>
  new Promise((resolve) => {
    const f = FRAMES[mode];
    const timer = setTimeout(() => done({ error: 'the registry did not answer', code: 'TIMEOUT' }), timeoutMs);
    const onAbort = () => done({ error: 'probe abandoned', code: 'ABORTED' });
    const done = (outcome) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      wsService.off(f.state, onState);
      wsService.off(f.open, onOpen);
      wsService.off(f.error, onError);
      resolve(outcome);
    };
    signal?.addEventListener('abort', onAbort);
    // a local founding answers with its record; the network one with the registry's standing
    const onState = (data) => done({ founded: true, state: mode === 'local' ? data.record : data });
    const onOpen = (data) => done({ founded: false, open: data });
    const onError = (data) => done({ error: data.message || data.code, code: data.code });
    wsService.on(f.state, onState);
    wsService.on(f.open, onOpen);
    wsService.on(f.error, onError);
    wsService.send(f.pre, { probe: true });
  });

/**
 * Walk the full founding: preflight → witness personal_sign → broadcast →
 * chain confirmation. `titles` maps { witness, [neumaId]: title }.
 *
 * `beforeSign(offer)` is the rite's gate: awaited after the preflight
 * passes (every being's mark already verified server-side) and BEFORE the
 * wallet is asked for the witness's own mark — the ceremony shows the
 * gathered marks and waits for the witness's deliberate step. Throwing (or
 * rejecting) from it abandons the walk with that error; nothing has been
 * signed or broadcast at that point.
 */
export const driveHouseFounding = ({
  wsService, titles, onStatus = () => {}, beforeSign = async () => {},
  signal = null, timeoutMs = WALK_TIMEOUT_MS,
}) =>
  new Promise((resolve) => {
    if (!deskWallet()) {
      resolve({ ok: false, error: 'No desk wallet on this surface — found the house from the desktop app.' });
      return;
    }

    // Once settled, an in-flight await must never ship another frame — a
    // found_error arriving mid-signature would otherwise be followed by a
    // found_sign the backend no longer expects.
    let settled = false;
    const timer = setTimeout(() => done({ ok: false, error: 'the founding walk timed out', code: 'TIMEOUT' }), timeoutMs);
    const onAbort = () => done({ ok: false, error: 'the founding walk was abandoned', code: 'ABORTED' });
    const done = (outcome) => {
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      wsService.off('house:found_ready', onReady);
      wsService.off('house:found_state', onState);
      wsService.off('house:found_tx', onTx);
      wsService.off('house:founded', onFounded);
      wsService.off('house:found_error', onError);
      resolve(outcome);
    };
    signal?.addEventListener('abort', onAbort);

    const onError = (data) => {
      // a short wallet's refusal carries its funding facts, so the rite can show the way to fund it
      done({ ok: false, error: data.message || data.code || 'Founding refused', code: data.code, funding: data.funding || null });
    };

    // Already standing — the walk resolves to the state, not an error.
    const onState = (data) => done({ ok: true, founded: true, state: data });

    const onReady = async (data) => {
      try {
        onStatus(`PREFLIGHT PASSED — ${data.networkLabel || data.network}. The marks are gathered.`);
        await beforeSign(data);
        if (settled) return;
        onStatus('Pointing the wallet…');
        const net = await ensureWalletNetwork(data.network);
        if (settled) return;
        if (!net.ok) { done({ ok: false, error: net.error }); return; }
        onStatus('AWAITING YOUR SIGNATURE — the wallet asks for the founding mark.');
        const witnessSig = await signSealPayload(data.innerPayload, data.witnessAddress);
        if (settled) return;
        onStatus('SIGNATURE PLACED — building the founding transaction…');
        wsService.send('house:found_sign', { witnessSig });
      } catch (err) {
        // err.code rides along — STEPPED_BACK from the rite's gate lets the
        // panel return to the names instead of an error state.
        done({ ok: false, error: err.message, code: err.code });
      }
    };

    const onTx = async (data) => {
      try {
        onStatus('AWAITING BROADCAST — confirm the founding in the wallet.');
        const txHash = await broadcastSealTx({ to: data.to, data: data.data });
        if (settled) return;
        onStatus('BROADCAST — waiting for the chain to hold the house…');
        wsService.send('house:found_confirm', { txHash });
      } catch (err) {
        done({ ok: false, error: err.message });
      }
    };

    const onFounded = (data) => {
      done({
        ok: true, founded: true,
        txHash: data.txHash, blockNumber: data.blockNumber,
        network: data.network, networkLabel: data.networkLabel, members: data.members,
      });
    };

    wsService.on('house:found_ready', onReady);
    wsService.on('house:found_state', onState);
    wsService.on('house:found_tx', onTx);
    wsService.on('house:founded', onFounded);
    wsService.on('house:found_error', onError);

    onStatus('PREPARING THE FOUNDING — composing the roster and preflighting on chain…');
    wsService.send('house:found_preflight', { titles });
  });

/**
 * Walk the founding ON THIS COMPUTER: preflight (every being signs the founding words) → the rite's gate → the
 * operator signs the same words in the wallet (a signature; no money moves) → the record is written. Resolves
 * { ok: true, founded: true, record } or { ok: false, error, code }.
 */
export const driveLocalFounding = ({
  wsService, titles, onStatus = () => {}, beforeSign = async () => {},
  signal = null, timeoutMs = WALK_TIMEOUT_MS,
}) =>
  new Promise((resolve) => {
    if (!deskWallet()) {
      resolve({ ok: false, error: 'No desk wallet on this surface — found the house from the desktop app.' });
      return;
    }
    let settled = false;
    const timer = setTimeout(() => done({ ok: false, error: 'the founding walk timed out', code: 'TIMEOUT' }), timeoutMs);
    const onAbort = () => done({ ok: false, error: 'the founding walk was abandoned', code: 'ABORTED' });
    const done = (outcome) => {
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      wsService.off('house:found_local_ready', onReady);
      wsService.off('house:found_local_founded', onFounded);
      wsService.off('house:found_local_error', onError);
      resolve(outcome);
    };
    signal?.addEventListener('abort', onAbort);
    const onError = (data) => done({ ok: false, error: data.message || data.code || 'Founding refused', code: data.code });
    const onReady = async (data) => {
      try {
        onStatus('EVERY FOUNDER HAS SIGNED. The marks are gathered.');
        await beforeSign(data);
        if (settled) return;
        onStatus('AWAITING YOUR SIGNATURE — it moves no money.');
        const witnessSig = await signSealMessage(data.message, data.witnessAddress);
        if (settled) return;
        onStatus('SIGNATURE PLACED — writing the founding…');
        wsService.send('house:found_local_sign', { witnessSig });
      } catch (err) {
        done({ ok: false, error: err.message, code: err.code });
      }
    };
    const onFounded = (data) => done({ ok: true, founded: true, record: data.record });
    wsService.on('house:found_local_ready', onReady);
    wsService.on('house:found_local_founded', onFounded);
    wsService.on('house:found_local_error', onError);
    onStatus('PREPARING THE FOUNDING — every founder signs the same words…');
    wsService.send('house:found_local_preflight', { titles });
  });
