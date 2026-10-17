// house-founding-rite-view.test.js — the rite's contract-visibility law,
// rendered for real (react-dom/server over the actual component): the FULL
// registry address reaches the DOM wherever the rite touches the chain,
// and an absent address renders nothing rather than an empty frame. The
// FoundedRegister rides the same law: beings named beside their titles, the
// founding tx a live road on EVERY open, and the fold that hides detail but
// never the proof.

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContractLine } from '../../frontend/app/RelinkShell/ContractLine.jsx';
import { FoundedRegister } from '../../frontend/app/RelinkShell/founding-register.jsx';

const REGISTRY = '0x526c6a062db774997955816c03df49b60260b883';
const render = (props) => renderToStaticMarkup(createElement(ContractLine, props));

describe('ContractLine — the signer sees the exact contract, and can review it', () => {
  it('renders the FULL address, never shortened', () => {
    const html = render({ address: REGISTRY });
    expect(html).toContain(REGISTRY);
    expect(html).toContain('REGISTRY');
    expect(html).not.toContain('…');
  });

  it('the address is a live road to the network\'s explorer', () => {
    const mainnet = render({ address: REGISTRY, network: 'base' });
    expect(mainnet).toContain(`href="https://basescan.org/address/${REGISTRY}"`);
    const testnet = render({ address: REGISTRY, network: 'base-sepolia' });
    expect(testnet).toContain(`href="https://sepolia.basescan.org/address/${REGISTRY}"`);
    // An unknown network falls to the home chain — never a dead link.
    expect(render({ address: REGISTRY })).toContain(`href="https://basescan.org/address/${REGISTRY}"`);
  });

  it('a custom label rides along (the doctrine covers every contract, not one)', () => {
    const html = render({ label: 'NATALIS', address: REGISTRY });
    expect(html).toContain('NATALIS');
    expect(html).toContain(REGISTRY);
  });

  it('no address renders NOTHING — never an empty frame pretending', () => {
    expect(render({ address: null })).toBe('');
    expect(render({ address: '' })).toBe('');
  });
});

const TX = '0x' + 'ab'.repeat(32);
const foundedState = (over = {}) => ({
  houseName: 'omberly', network: 'base', networkLabel: 'Base (mainnet)',
  registryAddress: REGISTRY, quorum: 2,
  txHash: TX, blockNumber: 7, foundedAt: '2026-07-16T00:00:00.000Z',
  roster: [
    { address: '0x' + '11'.repeat(20), kind: 0, title: 'Rector', active: true, neumaId: null, displayName: null },
    { address: '0x' + '22'.repeat(20), kind: 1, title: 'Quaestor', active: true, neumaId: 'cael', displayName: 'Cael' },
    { address: '0x' + '33'.repeat(20), kind: 1, title: 'Scriba', active: false, neumaId: null, displayName: null },
  ],
  ...over,
});
const renderRegister = (props) => renderToStaticMarkup(createElement(FoundedRegister, props));

describe('FoundedRegister — the standing house, read as beings', () => {
  it('names each member BESIDE their title, with the honest chain state', () => {
    const html = renderRegister({ state: foundedState(), witnessName: 'Orrin' });
    expect(html).toContain('Orrin');            // the witness row wears her name
    expect(html).toContain('Cael');             // the joined neuma wears theirs
    expect(html).toContain('Quaestor');
    expect(html).toContain('NEUMA');             // the unjoined row falls to its kind, never a made-up name
    expect(html).toContain('INACTIVE');          // the chain's inactive seat is named
  });

  it('the quorum reads as a signing law, of the member count', () => {
    const html = renderRegister({ state: foundedState() });
    expect(html).toContain('QUORUM 2 OF 3');
    expect(html).toContain('MEMBERS&#x27; MARKS');
  });

  it('the founding tx is a live road to the chain — on EVERY open, from the persisted state', () => {
    const html = renderRegister({ state: foundedState() });
    expect(html).toContain(`href="https://basescan.org/tx/${TX}"`);
    expect(html).toContain('HELD SINCE BLOCK 7');
    expect(html).toContain(REGISTRY); // the registry stays FULL, per the contract doctrine
  });

  it('a house founded off this desk (no record) shows no TX frame pretending', () => {
    const html = renderRegister({ state: foundedState({ txHash: null, blockNumber: null }) });
    expect(html).not.toContain('/tx/');
    expect(html).not.toContain('HELD SINCE BLOCK');
    expect(html).toContain('QUORUM 2 OF 3'); // the chain state alone still stands
  });

  it('the walk\'s in-memory result carries the tx before the re-probe lands', () => {
    const html = renderRegister({
      state: foundedState({ txHash: null, blockNumber: null }),
      result: { txHash: TX, blockNumber: 9 },
    });
    expect(html).toContain(`href="https://basescan.org/tx/${TX}"`);
    expect(html).toContain('THE HOUSE STANDS');
  });

  it('folded (the HOUSE window default) hides the detail but NEVER the proof', () => {
    const html = renderRegister({ state: foundedState(), collapsible: true });
    expect(html).toContain('QUORUM 2 OF 3');                       // the standing line stays
    expect(html).toContain(`href="https://basescan.org/tx/${TX}"`); // the tx road stays
    expect(html).toContain('UNFOLD');                               // the door is offered
    expect(html).not.toContain('Quaestor');                         // the roster waits behind it
    expect(html).not.toContain(REGISTRY);
  });

  it('the rite\'s full-screen standing stays unfolded — no fold button, all detail', () => {
    const html = renderRegister({ state: foundedState() });
    expect(html).not.toContain('UNFOLD');
    expect(html).toContain('Quaestor');
  });
});
