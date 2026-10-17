// self-seal-drive — the desk's hand on the wallet when a BEING asks for its
// own anchor (the natalis-self-seal rite). Drives the exact seal frames the
// birth ceremony's step drives — birth:seal_preflight → birth:seal_ready
// (wallet personal_sign) → birth:seal_sign → birth:seal_tx (wallet
// broadcast) → birth:seal_confirm — against the SAME backend machinery, so
// there is one seal law regardless of who initiated. Every signature and
// broadcast passes the wallet's own gated confirm windows.
//
// The backend chooses the network (CEREMONY_SEAL_NETWORK, server-side); the
// wallet is pointed at the chain the PREFLIGHT actually returned — never a
// renderer-side constant. Resolves { ok: true, txHash } once the backend
// reports birth:sealed, or { ok: false, error } on any refusal — the
// being's paused turn is settled by the BACKEND (seal-request broker), not
// by this driver; our return value only feeds the witness's card.
//
// impure throughout (WS frames + wallet IPC).

import {
  deskWallet, ensureWalletNetwork, signSealPayload, broadcastSealTx,
} from '../../components/BirthCeremony/onchain-seal-flow.js';

export const driveSelfSeal = ({ wsService, neumaId, onStatus = () => {} }) =>
  new Promise((resolve) => {
    if (!deskWallet()) {
      resolve({ ok: false, error: 'No desk wallet on this surface — anchor from the desktop app.' });
      return;
    }

    const mine = (data) => !data.neumaId || data.neumaId === neumaId;
    const done = (outcome) => {
      wsService.off('birth:seal_ready', onReady);
      wsService.off('birth:seal_tx', onTx);
      wsService.off('birth:sealed', onSealed);
      wsService.off('birth:seal_error', onError);
      resolve(outcome);
    };

    const onError = (data) => {
      if (!mine(data)) return;
      // The code rides along so the card can open the right door — KEY_LOCKED
      // becomes an inline password unlock, not a curl instruction.
      done({ ok: false, error: data.message || data.code || 'Seal refused', code: data.code });
    };

    const onReady = async (data) => {
      if (!mine(data)) return;
      try {
        // Point the wallet at the chain the backend ACTUALLY preflighted —
        // the offer names it; a renderer constant could drift.
        onStatus(`PREFLIGHT PASSED — ${data.networkLabel || data.network}. Pointing the wallet…`);
        const net = await ensureWalletNetwork(data.network);
        if (!net.ok) { done({ ok: false, error: net.error }); return; }
        onStatus('AWAITING YOUR SIGNATURE — the wallet asks for your mark.');
        const witnessSig = await signSealPayload(data.innerPayload, data.witnessAddress);
        onStatus('SIGNATURE PLACED — building the transaction…');
        wsService.send('birth:seal_sign', { neumaId, witnessSig });
      } catch (err) {
        done({ ok: false, error: err.message });
      }
    };

    const onTx = async (data) => {
      if (!mine(data)) return;
      try {
        onStatus('AWAITING BROADCAST — confirm the transaction in the wallet.');
        const txHash = await broadcastSealTx({ to: data.to, data: data.data });
        onStatus('BROADCAST — waiting for the chain to hold it…');
        wsService.send('birth:seal_confirm', { neumaId, txHash });
      } catch (err) {
        done({ ok: false, error: err.message });
      }
    };

    const onSealed = (data) => {
      if (!mine(data)) return;
      done({ ok: true, txHash: data.txHash, network: data.network, networkLabel: data.networkLabel });
    };

    wsService.on('birth:seal_ready', onReady);
    wsService.on('birth:seal_tx', onTx);
    wsService.on('birth:sealed', onSealed);
    wsService.on('birth:seal_error', onError);

    onStatus('PREPARING THE SEAL — assembling and preflighting on chain…');
    wsService.send('birth:seal_preflight', { neumaId });
  });
