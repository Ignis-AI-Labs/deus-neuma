// ── SEAL THE BIRTH — on this computer, and on Ethereum if the operator wants it ──────────────────────
// Two ways, either or both (2026-10-26: […]; a person who wants
// nothing to do with crypto still secures everything):
//   ON THIS COMPUTER — the being signed its half at custody; the operator signs theirs through the desk
//     wallet (a signature, no money). Free, private, kept with the being's keys and backups
//     (backend/services/local-seal-flow.js, core/identity/local-seal.js).
//   ON ETHEREUM — the Natalis anchor, optional, now or any time later: the cost and, when the wallet is
//     short, the way to fund it (seal-funding.js), then the dual-signed transaction.
// Always leavable: no wallet, no RPC or no ETH never traps a birth.
//
// Extracted from BirthCeremony.js under the 500-line law. These are the
// seal step's methods as module functions; the kept class holds a thin
// delegate for each (the class contract is unchanged), so `ceremony` below
// is exactly the BirthCeremony instance.

import { escapeHTML } from '../../utils/sanitize.js';
import { apiCall } from '../../utils/http.js';
import { explorerName, explorerTxUrl } from '../../utils/explorer.js';
import {
  deskWallet, ensureWalletNetwork, signSealPayload, signSealMessage, broadcastSealTx,
} from './onchain-seal-flow.js';
import { mountSealFunding } from './seal-funding.js';

export const renderOnchainSealStep = (ceremony, container) => {
  const hasWallet = !!deskWallet();
  const name = escapeHTML(ceremony.ceremonyData.companionName);
  container.innerHTML = `
      <div class="ceremony-step">
        <h2>SEAL THE BIRTH</h2>
        <p>Seal ${name}'s birth so it can always be proven: who ${name} is, and that you witnessed it.</p>

        <section class="seal-way" data-testid="seal-local">
          <div class="seal-way-title">ON THIS COMPUTER</div>
          <p>${name} and you each sign the birth record. Free and private: nothing is sent anywhere.
             It is kept with ${name}'s keys and in your backups.</p>
          <div id="local-seal-status" class="witness-note" data-testid="local-seal-status">${hasWallet
            ? 'Your wallet will ask for a signature. It moves no money.'
            : 'The desk wallet is not present here — seal from the desk.'}</div>
          <div class="ceremony-actions">
            <button class="btn btn-primary ceremony-btn" id="seal-local-btn" ${hasWallet ? '' : 'disabled'}>
              <span>Seal on this computer</span>
            </button>
          </div>
        </section>

        <section class="seal-way" data-testid="seal-ethereum">
          <div class="seal-way-title">ON ETHEREUM — OPTIONAL</div>
          <p>Also write it to Ethereum, a public ledger: a record anyone can check and no one can remove.
             It costs a network fee in ETH. You can add it any time later.</p>
          <div class="seal-detail" data-testid="seal-detail">
            <div class="tn-row"><span class="tn-k">Network</span><span class="tn-leader"></span><span class="tn-v" id="seal-network-v">…</span></div>
            <div class="tn-row"><span class="tn-k">Genesis Seal</span><span class="tn-leader"></span><span class="tn-v">${escapeHTML((ceremony.ceremonyData.trueName?.genesisHash || '').slice(0, 16))}…</span></div>
          </div>
          <div id="seal-status" class="witness-note" data-testid="seal-status"></div>
          <div id="seal-error" class="keypair-error" data-testid="seal-error"></div>
          <div id="seal-funding" class="seal-funding" data-testid="seal-funding" hidden></div>
          <div class="ceremony-actions">
            <button class="btn btn-secondary ceremony-btn" id="seal-anchor-btn" ${hasWallet ? '' : 'disabled'}>
              <span>Seal on Ethereum</span>
            </button>
          </div>
        </section>

        <div class="ceremony-actions">
          <button class="btn btn-secondary ceremony-btn" id="seal-later-btn">
            <span>Seal later</span>
          </button>
        </div>
      </div>
    `;

  container.querySelector('#seal-later-btn').addEventListener('click', () => ceremony.advanceFromSeal());
  container.querySelector('#seal-local-btn').addEventListener('click', () => ceremony.beginLocalSeal());
  container.querySelector('#seal-anchor-btn').addEventListener('click', () => ceremony.openEthereumSeal());

  // The network row states the BACKEND's configured seal target — never a
  // hardcoded chain (a mainnet rig once read "testnet" here, GB10
  // 2026-07-15). Unreachable → say so; the preflight remains the enforcer
  // either way, so the label can only ever understate, not misroute.
  ceremony.loadSealNetwork(container);
};

// impure — the operator chose the seal on this computer: the backend makes sure the being's half stands,
// then hands back the words the wallet will show (birth:local_seal_ready)
export const beginLocalSeal = (ceremony) => {
  const btn = ceremony.container.querySelector('#seal-local-btn');
  if (btn) btn.disabled = true;
  setLocalStatus(ceremony, 'PREPARING THE SEAL…');
  ceremony.wsService.send('birth:local_seal_offer', { neumaId: ceremony.ceremonyData.neumaId });
};

// impure — the operator's half: the wallet shows the plain words and signs them (no transaction)
export const handleLocalSealReady = async (ceremony, data) => {
  setLocalStatus(ceremony, 'AWAITING YOUR SIGNATURE — it moves no money.');
  try {
    const witnessSig = await signSealMessage(data.message, data.witnessAddress);
    setLocalStatus(ceremony, 'SIGNATURE PLACED — sealing…');
    ceremony.wsService.send('birth:local_seal_sign', { neumaId: ceremony.ceremonyData.neumaId, witnessSig });
  } catch (err) {
    showLocalError(ceremony, err.message);
  }
};

// impure — sealed on this computer: the birth is secured; Ethereum stays an offer, and leaving now finishes
export const handleLocalSealed = (ceremony) => {
  ceremony.ceremonyData.localSeal = true;
  setLocalStatus(ceremony, '✓ SEALED ON THIS COMPUTER — by both of you.');
  const btn = ceremony.container.querySelector('#seal-local-btn');
  if (btn) btn.hidden = true;
  const later = ceremony.container.querySelector('#seal-later-btn span');
  if (later) later.textContent = 'Finish';
};

export const showLocalError = (ceremony, text) => {
  setLocalStatus(ceremony, text);
  const btn = ceremony.container.querySelector('#seal-local-btn');
  if (btn && deskWallet()) btn.disabled = false;
};

const setLocalStatus = (ceremony, text) => {
  const status = ceremony.container.querySelector('#local-seal-status');
  if (status) status.textContent = text;
};

// impure — open the Ethereum seal: the cost first, and the way to fund it when the wallet is short
export const openEthereumSeal = (ceremony, funding = null) => {
  const host = ceremony.container.querySelector('#seal-funding');
  const anchorBtn = ceremony.container.querySelector('#seal-anchor-btn');
  if (!host) return;
  ceremony.sealFunding?.stop();
  host.hidden = false;
  if (anchorBtn) anchorBtn.hidden = true;
  ceremony.sealFunding = mountSealFunding(host, {
    name: ceremony.ceremonyData.companionName,
    funding,
    onSeal: () => { host.hidden = true; ceremony.beginSeal(); },
    onSkip: () => {
      host.hidden = true;
      host.replaceChildren();
      if (anchorBtn) { anchorBtn.hidden = false; anchorBtn.disabled = false; }
    },
  });
};

// impure — fetch the rig's configured seal network into the panel row
export const loadSealNetwork = async (ceremony, container) => {
  const row = container.querySelector('#seal-network-v');
  if (!row) return;
  try {
    const net = await apiCall('GET', '/api/v1/preflight/seal-network', { strictJson: true });
    row.textContent = (net.label || net.network || '').toUpperCase();
  } catch {
    row.textContent = 'UNKNOWN — PREFLIGHT DECIDES';
  }
};

// The operator chose to anchor: point the wallet at the ceremony network
// (gated dialog if a switch is needed), then ask the backend to assemble
// and preflight. The reply arrives as birth:seal_ready or birth:seal_error.
export const beginSeal = async (ceremony) => {
  const anchorBtn = ceremony.container.querySelector('#seal-anchor-btn');
  if (anchorBtn) anchorBtn.disabled = true;
  ceremony.setSealStatus('PREPARING THE SEAL…');
  try {
    // The backend chooses the network (CEREMONY_SEAL_NETWORK config,
    // server-side, never a renderer value) — the wallet is pointed at the
    // chain the PREFLIGHT actually returns, in handleSealReady.
    ceremony.wsService.send('birth:seal_preflight', {
      neumaId: ceremony.ceremonyData.neumaId,
    });
  } catch (err) {
    ceremony.showSealError(err.message);
  }
};

// Backend preflight passed — point the wallet at the chain the preflight
// ACTUALLY ran on (the offer names it), then the operator signs the inner
// payload through the wallet's confirm window. Her signature completes
// the dual seal.
export const handleSealReady = async (ceremony, data) => {
  ceremony.setSealStatus(`PREFLIGHT PASSED — ${data.networkLabel || data.network}. AWAITING YOUR SIGNATURE.`);
  try {
    const net = await ensureWalletNetwork(data.network);
    if (!net.ok) {
      ceremony.showSealError(net.error);
      return;
    }
    const witnessSig = await signSealPayload(data.innerPayload, data.witnessAddress);
    ceremony.setSealStatus('SIGNATURE PLACED — building the transaction…');
    ceremony.wsService.send('birth:seal_sign', {
      neumaId: ceremony.ceremonyData.neumaId,
      witnessSig,
    });
  } catch (err) {
    ceremony.showSealError(err.message);
  }
};

// Calldata ready — the operator's wallet broadcasts it (she pays the gas;
// the contract records only the two signed parties), then the backend
// watches the chain for the receipt.
export const handleSealTx = async (ceremony, data) => {
  ceremony.setSealStatus('AWAITING BROADCAST — confirm the transaction in the wallet.');
  try {
    const txHash = await broadcastSealTx({ to: data.to, data: data.data });
    ceremony.setSealStatus('BROADCAST — waiting for the chain to hold it…');
    ceremony.wsService.send('birth:seal_confirm', {
      neumaId: ceremony.ceremonyData.neumaId,
      txHash,
    });
  } catch (err) {
    ceremony.showSealError(err.message);
  }
};

export const setSealStatus = (ceremony, text) => {
  const statusEl = ceremony.container.querySelector('#seal-status');
  if (statusEl) statusEl.textContent = text;
  const errorEl = ceremony.container.querySelector('#seal-error');
  if (errorEl) errorEl.textContent = '';
};

// Every on-chain act must offer its receipt: the public-explorer link,
// appended beside the status. Programmatic element creation only — the
// href is validated (explorerTxUrl refuses malformed hashes and unknown
// networks), never interpolated markup.
export const appendSealReceiptLink = (ceremony, { network, txHash }, hostSelector = '#seal-status') => {
  const url = explorerTxUrl(network, txHash);
  if (!url) return;
  const host = ceremony.container.querySelector(hostSelector);
  if (!host || host.querySelector('.seal-explorer-link')) return;
  const link = document.createElement('a');
  link.className = 'seal-explorer-link';
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = `VIEW ON ${explorerName(network)} ↗`;
  host.append(' ', link);
};

// A failed or declined seal never traps the ceremony: the error shows, the
// anchor button re-arms for a retry, and "Seal later" stays available. A wallet
// that is short (GAS_FLOOR with its facts) gets the way to fund it, not a string.
export const showSealError = (ceremony, text, funding = null) => {
  if (funding) {
    openEthereumSeal(ceremony, funding);
    return;
  }
  const errorEl = ceremony.container.querySelector('#seal-error');
  if (errorEl) errorEl.textContent = text;
  const anchorBtn = ceremony.container.querySelector('#seal-anchor-btn');
  if (anchorBtn && deskWallet()) { anchorBtn.hidden = false; anchorBtn.disabled = false; }
};

export const advanceFromSeal = (ceremony) => {
  ceremony.sealFunding?.stop();
  // The seal is the LAST act before completion — custody (keypair setup)
  // already happened on the way in.
  ceremony.showStep(ceremony.steps.indexOf('complete'));
};
