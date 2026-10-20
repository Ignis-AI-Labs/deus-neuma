// ContractLine — the exact contract a signature binds, stated in FULL and
// REVIEWABLE: the address is a live road to the network's explorer, so
// anyone can read the contract before they sign anything against it.
// Platform doctrine (ruling, 2026-07-16): wherever this platform touches an
// on-chain contract, the user SEES its full address — never shortened,
// never implied — and can click through to the chain's own record. Verify
// any address against docs/contracts/deployments/.
// Renders nothing when there is no address — never an empty frame.
// Shared: every surface that names a contract uses this one line.

import { explorerAddressUrl } from './wallet-receipt.js';

export const ContractLine = ({ label = 'REGISTRY', address, network }) => (
  address ? (
    <p className="house-anchor-contract label-data">
      {label}{' '}
      <a
        className="house-anchor-contract-addr"
        href={explorerAddressUrl(network, address)}
        target="_blank"
        rel="noreferrer"
        title="Review this contract on the network's explorer"
      >
        {address}
        <svg className="house-anchor-contract-out" width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
          <path d="M2.5 7.5 L7.5 2.5" />
          <path d="M4 2.5 H7.5 V6" />
        </svg>
      </a>
    </p>
  ) : null
);
