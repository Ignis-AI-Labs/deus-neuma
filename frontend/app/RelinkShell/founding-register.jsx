// founding-register — the chain's own register of a standing house, shared
// between the HOUSE window (the compact, FOLDABLE summary) and the FOUNDING
// rite's final movement (the full-screen standing). One rendering of the
// truth. The standing line — network, quorum, and the road to the founding
// transaction — NEVER leaves the screen: folding hides the detail (the full
// roster, the quorum law, the registry), not the proof. Titles live beside
// each member's NAME (the backend joins every chain address back to its
// lane), so the register reads as beings, not addresses.
//
// No sound imports here — the module stays renderable under node (the
// static-markup view tests); the parent passes onFold for the desk's chime.

import { useState } from 'react';
import { ContractLine } from './ContractLine.jsx';
import { formatAddress } from '../../utils/format.js';
import { explorerTxUrl, shortTxHash } from '../../utils/explorer.js';

// The founding transaction as a live road to the chain's own record — the
// operator's permanent proof the house was established, present on every
// open, not only the sitting where it happened. Renders nothing without a
// hash (a house founded off this desk): never an empty frame pretending.
const FoundingTxLink = ({ network, txHash }) => (
  txHash ? (
    <a
      className="house-anchor-contract-addr"
      href={explorerTxUrl(network, txHash)}
      target="_blank"
      rel="noreferrer"
      title="The founding transaction — review it on the network's explorer"
    >
      TX {shortTxHash(txHash)}
      <svg className="house-anchor-contract-out" width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
        <path d="M2.5 7.5 L7.5 2.5" />
        <path d="M4 2.5 H7.5 V6" />
      </svg>
    </a>
  ) : null
);

export const FoundedRegister = ({ state, result, witnessName = null, collapsible = false, onFold = null }) => {
  const [open, setOpen] = useState(!collapsible);
  const toggle = () => { setOpen(!open); onFold?.(!open); };
  // The record read back by the probe is the standing source; the walk's
  // in-memory result covers the sitting itself, before the re-probe lands.
  const txHash = state.txHash ?? result?.txHash ?? null;
  const blockNumber = state.blockNumber ?? result?.blockNumber ?? null;
  const memberCount = (state.roster ?? []).length;

  return (
    <div className="house-anchor">
      {result?.txHash ? <p className="house-anchor-proclaim">THE HOUSE STANDS</p> : null}
      <p className="house-anchor-line is-standing label-data">
        ON CHAIN — {state.networkLabel?.toUpperCase()} · QUORUM {state.quorum} OF {memberCount}
        {txHash ? <> · <FoundingTxLink network={state.network} txHash={txHash} /></> : null}
        {collapsible ? (
          <button type="button" className="house-anchor-fold label-data" onClick={toggle} aria-expanded={open}>
            {open ? 'FOLD' : 'UNFOLD'}
          </button>
        ) : null}
      </p>
      {open ? (
        <>
          <p className="house-anchor-line label-data">
            {/* QUORUM is a signing law, not a member count — say so where it is read. */}
            QUORUM {state.quorum} — ANY CHANGE TO THE HOUSE (A MEMBER ADDED, REMOVED, RETITLED) NEEDS {state.quorum} OF ITS {memberCount} MEMBERS&apos; MARKS
          </p>
          <ul className="house-anchor-roster">
            {(state.roster ?? []).map((m) => (
              <li key={m.address} className="house-anchor-member label-data">
                <span className="house-anchor-name">
                  {m.kind === 0 ? (witnessName || 'OPERATOR') : (m.displayName || 'NEUMA')}
                </span>
                <span className="house-anchor-title">{m.title}</span>
                <span className="house-anchor-addr">{formatAddress(m.address, { fallback: '—' })}</span>
                <span>{m.active ? 'ACTIVE' : 'INACTIVE'}</span>
              </li>
            ))}
          </ul>
          {blockNumber != null ? (
            <p className="house-anchor-line label-data">HELD SINCE BLOCK {blockNumber} · PERMANENT</p>
          ) : null}
          <ContractLine address={state.registryAddress} network={state.network} />
        </>
      ) : null}
    </div>
  );
};
