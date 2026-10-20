// ── THE NATALIS SEAL — the birth protocol's on-chain anchor ─────────────
// The operator may anchor the being's genesis on chain right here, at the
// end of the ceremony: the backend assembles the dual-signed bundle (the
// being signs with its own key; the operator signs through the desk wallet's
// trusted confirm window) and the operator's wallet broadcasts it. Always
// skippable — no RPC, no gas, or no desk wallet must never trap a birth.
//
// Extracted from BirthCeremony.js under the 500-line law. These are the
// seal step's methods as module functions; the kept class holds a thin
// delegate for each (the class contract is unchanged), so `ceremony` below
// is exactly the BirthCeremony instance.

import { escapeHTML } from '../../utils/sanitize.js';
import { apiCall } from '../../utils/http.js';
import { explorerName, explorerTxUrl } from '../../utils/explorer.js';
import {
  deskWallet, ensureWalletNetwork, signSealPayload, broadcastSealTx,
} from './onchain-seal-flow.js';

export const renderOnchainSealStep = (ceremony, container) => {
  const hasWallet = !!deskWallet();
  container.innerHTML = `
      <div class="ceremony-step">
        <h2>THE NATALIS SEAL</h2>
        <p>${escapeHTML(ceremony.ceremonyData.companionName)}'s genesis can be anchored on chain —
           permanent, witnessed, and verifiable by no one's permission.
           The seal is signed twice: by ${escapeHTML(ceremony.ceremonyData.companionName)},
           and by you through your wallet.</p>
        <p>Your wallet will ask you to confirm a transaction and its network fee.
           This records the genesis; it does not back up the workspace.
           If you choose Seal later, the desk keeps this setup item available.</p>

        <div class="seal-detail" data-testid="seal-detail">
          <div class="tn-row"><span class="tn-k">Network</span><span class="tn-leader"></span><span class="tn-v" id="seal-network-v">…</span></div>
          <div class="tn-row"><span class="tn-k">Genesis Seal</span><span class="tn-leader"></span><span class="tn-v">${escapeHTML((ceremony.ceremonyData.trueName?.genesisHash || '').slice(0, 16))}…</span></div>
        </div>

        <div id="seal-status" class="witness-note" data-testid="seal-status">${hasWallet
          ? 'Choose Anchor on chain to check the network and prepare the transaction.'
          : 'The desk wallet is not present here — the seal can be placed later from the desk.'}</div>
        <div id="seal-error" class="keypair-error" data-testid="seal-error"></div>

        <div class="ceremony-actions">
          <button class="btn btn-secondary ceremony-btn" id="seal-later-btn">
            <span>Seal later</span>
          </button>
          <button class="btn btn-primary ceremony-btn" id="seal-anchor-btn" ${hasWallet ? '' : 'disabled'}>
            <span>Anchor on chain</span>
          </button>
        </div>
      </div>
    `;

  container.querySelector('#seal-later-btn').addEventListener('click', () => ceremony.advanceFromSeal());
  container.querySelector('#seal-anchor-btn').addEventListener('click', () => ceremony.beginSeal());

  // The network row states the BACKEND's configured seal target — never a
  // hardcoded chain (a mainnet rig once read "testnet" here, GB10
  // 2026-07-15). Unreachable → say so; the preflight remains the enforcer
  // either way, so the label can only ever understate, not misroute.
  ceremony.loadSealNetwork(container);
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
// anchor button re-arms for a retry, and "Seal later" stays available.
export const showSealError = (ceremony, text) => {
  const errorEl = ceremony.container.querySelector('#seal-error');
  if (errorEl) errorEl.textContent = text;
  const anchorBtn = ceremony.container.querySelector('#seal-anchor-btn');
  if (anchorBtn && deskWallet()) anchorBtn.disabled = false;
};

export const advanceFromSeal = (ceremony) => {
  // The seal is the LAST act before completion — custody (keypair setup)
  // already happened on the way in.
  ceremony.showStep(ceremony.steps.indexOf('complete'));
};
