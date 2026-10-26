// local-seal-drive — the desk's hand on the wallet for the seal ON THIS COMPUTER (local-seal-flow.js):
// birth:local_seal_offer → birth:local_seal_ready (the wallet signs the plain words; no money moves) →
// birth:local_seal_sign → birth:local_sealed. The same frames the ceremony's seal step drives, so there is
// one seal law whoever starts it. Resolves { ok: true } or { ok: false, error, code } — KEY_LOCKED opens the
// unlock door, as the Ethereum seal's does.
//
// impure throughout (WS frames + wallet IPC).

import { deskWallet, signSealMessage } from '../../components/BirthCeremony/onchain-seal-flow.js';

export const driveLocalSeal = ({ wsService, neumaId, onStatus = () => {} }) =>
  new Promise((resolve) => {
    if (!deskWallet()) {
      resolve({ ok: false, error: 'No desk wallet on this surface — seal from the desktop app.' });
      return;
    }
    const mine = (data) => !data.neumaId || data.neumaId === neumaId;
    const done = (outcome) => {
      wsService.off('birth:local_seal_ready', onReady);
      wsService.off('birth:local_sealed', onSealed);
      wsService.off('birth:local_seal_error', onError);
      resolve(outcome);
    };
    const onReady = async (data) => {
      if (!mine(data)) return;
      try {
        onStatus('AWAITING YOUR SIGNATURE — it moves no money.');
        const witnessSig = await signSealMessage(data.message, data.witnessAddress);
        onStatus('SIGNATURE PLACED — sealing…');
        wsService.send('birth:local_seal_sign', { neumaId, witnessSig });
      } catch (err) {
        done({ ok: false, error: err.message });
      }
    };
    const onSealed = (data) => { if (mine(data)) done({ ok: true }); };
    const onError = (data) => { if (mine(data)) done({ ok: false, error: data.message || data.code, code: data.code }); };
    wsService.on('birth:local_seal_ready', onReady);
    wsService.on('birth:local_sealed', onSealed);
    wsService.on('birth:local_seal_error', onError);
    onStatus('PREPARING THE SEAL…');
    wsService.send('birth:local_seal_offer', { neumaId });
  });
