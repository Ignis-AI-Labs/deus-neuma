/**
 * The seal chip's receipt names the explorer it links (audit W4, 2026-10-19):
 * an Ethereum seal links Etherscan and says so; a Base seal says Basescan.
 * Real server render of the real SealChip (renderToStaticMarkup); no mocks.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

let SealChip;
beforeAll(async () => {
  // The import graph's module-level browser facts (the sound engine's
  // listener and its idle warm-up's storage read) — provisioned, never
  // exercised: no sound plays in a static render.
  globalThis.window = globalThis.window ?? { addEventListener: () => {}, dispatchEvent: () => true, requestIdleCallback: () => {} };
  globalThis.localStorage = globalThis.localStorage ?? {
    getItem: () => null, setItem: () => {}, removeItem: () => {},
  };
  ({ SealChip } = await import('../../frontend/app/RelinkShell/SealChip.jsx'));
});

const TX = `0x${'ab'.repeat(32)}`;
const sealed = (network) => ({
  kind: 'seal', id: 's1', phase: 'resolved', status: 'sealed', neumaId: 'n1', beingName: 'B', txHash: TX, network, blockNumber: 7,
});
const render = (network) => renderToStaticMarkup(createElement(SealChip, { segment: sealed(network), onRespond: () => {} }));

describe('SealChip — the receipt names the explorer it opens', () => {
  it('an Ethereum seal links Etherscan and says ETHERSCAN', () => {
    const html = render('ethereum');
    expect(html).toContain(`href="https://etherscan.io/tx/${TX}"`);
    expect(html).toContain('VIEW ON ETHERSCAN');
    expect(html).not.toContain('BASESCAN');
  });

  it('a Base seal links Basescan and says BASESCAN', () => {
    const html = render('base');
    expect(html).toContain(`href="https://basescan.org/tx/${TX}"`);
    expect(html).toContain('VIEW ON BASESCAN');
  });

  it('an unknown network shows the hash as text, no link', () => {
    const html = render('polygon');
    expect(html).not.toContain('href=');
    expect(html).toContain(TX);
  });
});
