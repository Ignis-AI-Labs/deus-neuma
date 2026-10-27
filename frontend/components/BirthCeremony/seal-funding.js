// seal-funding.js — sealing on Ethereum, for a person who may never have heard of it: what Ethereum is,
// what the seal costs right now (the node's own fee, the wallet's own balance — never a guess), and, when
// the wallet is short, the way to fund it: where to buy, the address to send to on the right network, and a
// watch that goes on by itself once the ETH arrives. "Finish without Ethereum" is always one press away:
// the seal on this computer already secures the birth.
//
// One module, two hosts: the ceremony's seal step and the desk's setup gate (BirthSetupGate). Framework-
// free DOM, built by element (no data reaches innerHTML).
//
// impure — reads the cost and the price over REST, writes the DOM, polls while open.

import QRCode from 'qrcode';
import { apiCall } from '../../utils/http.js';
import { loadCredentialLinks, linksFor } from '../../services/credential-links.js';
import './BirthCeremony-seal.css';

const WATCH_MS = 15000;
const WEI = 10n ** 18n;

/** Wei (decimal string) as ETH, 4 places. Pure. */
export const ethText = (wei) => (Number(BigInt(wei) * 10000n / WEI) / 10000).toFixed(4);

/** Wei as dollars at a price, or '' with no price. Pure. */
export const usdText = (wei, usd) => (typeof usd === 'number' && usd > 0
  ? ` (≈ $${(Number(BigInt(wei)) / 1e18 * usd).toFixed(2)})`
  : '');

/** How full the wallet is against what the seal needs, 0..1 — a true gauge. Pure. */
export const fillOf = ({ balanceWei, needWei }) => {
  const need = BigInt(needWei);
  if (need === 0n) return 1;
  const fill = Number(BigInt(balanceWei) * 1000n / need) / 1000;
  return Math.min(1, fill);
};

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

// What the walkthrough is for: a birth's seal (the default) or a house's founding (the same road, its own cost).
const SEAL = Object.freeze({ title: 'SEALING ON ETHEREUM', subject: (name) => `${name}'s seal`, costPath: '/api/v1/preflight/seal-cost' });
export const FOUNDING = Object.freeze({ title: 'FOUNDING ON ETHEREUM', subject: () => 'the house\'s founding', costPath: '/api/v1/preflight/found-cost' });

// impure — the facts and the price, read together; the price is optional
const readFacts = async (costPath) => {
  const [cost, price] = await Promise.all([
    apiCall('GET', costPath, { strictJson: true, errorPrefix: 'The cost could not be read' }),
    apiCall('GET', '/api/v1/prices/eth', { strictJson: true }).catch(() => ({ usd: null })),
  ]);
  return { cost, usd: price?.usd ?? null };
};

const render = (host, { cost, usd, links, checkedAt }, { onSeal, onSkip, name, kind }) => {
  host.replaceChildren();
  host.append(el('h3', 'seal-funding-title', kind.title));
  host.append(el('p', 'seal-funding-what',
    `Ethereum is a public ledger: what is written there can't be changed or removed, by anyone, including us. `
    + `Writing ${kind.subject(name)} there costs a network fee, paid in ETH from your wallet.`));

  // the overview first: what the wallet holds against what the seal needs
  const gauge = el('div', 'seal-funding-gauge');
  gauge.dataset.testid = 'seal-funding-gauge';
  const bar = el('div', 'seal-funding-bar');
  const fill = el('div', `seal-funding-fill${cost.enough ? ' is-enough' : ''}`);
  fill.style.width = `${Math.round(fillOf(cost) * 100)}%`;
  bar.append(fill);
  gauge.append(
    el('span', 'seal-funding-k label-data', `YOUR WALLET ${ethText(cost.balanceWei)} ETH`),
    bar,
    el('span', 'seal-funding-k label-data', `NEEDS ABOUT ${ethText(cost.needWei)} ETH${usdText(cost.needWei, usd)}`),
  );
  host.append(gauge);
  host.append(el('p', 'seal-funding-note',
    `You will most likely pay about ${ethText(cost.likelyWei)} ETH${usdText(cost.likelyWei, usd)}; the rest stays in your wallet. `
    + `On ${cost.networkLabel}.`));

  if (!cost.enough) {
    host.append(el('p', 'seal-funding-short label-data', `YOU NEED ABOUT ${ethText(cost.shortWei)} ETH MORE`));
    const steps = el('ol', 'seal-funding-steps');
    const buy = el('li');
    buy.append(el('span', null, 'Buy ETH on an exchange you trust: '));
    for (const link of links) {
      const a = el('a', 'seal-funding-link', link.label);
      a.href = link.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      if (link.note) a.title = link.note;
      buy.append(a, ' ');
    }
    const send = el('li');
    send.append(el('span', null,
      `Send it to your wallet below, on the ${cost.networkLabel} network. Not Base or another network: ETH sent there would not arrive here.`));
    const where = el('div', 'seal-funding-address');
    const qr = el('img', 'seal-funding-qr');
    qr.alt = 'Your wallet address as a QR code';
    QRCode.toDataURL(cost.payer, { margin: 1, width: 132 }).then((url) => { qr.src = url; }).catch(() => qr.remove());
    const address = el('code', 'seal-funding-addr', cost.payer);
    address.dataset.testid = 'seal-funding-address';
    const copy = el('button', 'btn btn-secondary ceremony-btn', 'COPY ADDRESS');
    copy.type = 'button';
    copy.addEventListener('click', () => navigator.clipboard?.writeText(cost.payer).then(() => { copy.textContent = 'COPIED'; }));
    where.append(qr, address, copy);
    send.append(where);
    const wait = el('li', null, 'Keep this open: it checks every 15 seconds and goes on when the ETH arrives.');
    steps.append(buy, send, wait);
    host.append(steps);
    host.append(el('p', 'seal-funding-checked label-data', `CHECKED ${checkedAt} — NOT ARRIVED YET`));
  }

  const actions = el('div', 'ceremony-actions');
  const skip = el('button', 'btn btn-secondary ceremony-btn', 'FINISH WITHOUT ETHEREUM');
  skip.type = 'button';
  skip.addEventListener('click', onSkip);
  const seal = el('button', 'btn btn-primary ceremony-btn', cost.enough ? kind.go : 'WAITING FOR ETH…');
  seal.type = 'button';
  seal.disabled = !cost.enough;
  seal.dataset.testid = 'seal-funding-go';
  seal.addEventListener('click', onSeal);
  actions.append(skip, seal);
  host.append(actions);
};

/**
 * Open the Ethereum seal in `host`: read the cost, show it, and while the wallet is short show the way to
 * fund it and watch for the ETH. `funding` seeds the first view (a GAS_FLOOR refusal carries it).
 * @param {HTMLElement} host
 * @param {{name: string, onSeal: () => void, onSkip: () => void, funding?: object, kind?: object, go?: string}} opts
 * @returns {{stop: () => void}}
 */
// impure
export const mountSealFunding = (host, { name, onSeal, onSkip, funding = null, kind = SEAL, go = 'SEAL ON ETHEREUM' }) => {
  let timer = null;
  let stopped = false;
  const stop = () => { stopped = true; if (timer) clearTimeout(timer); };
  const hand = { onSeal: () => { stop(); onSeal(); }, onSkip: () => { stop(); onSkip(); }, name, kind: { ...kind, go } };

  const tick = async (seed = null) => {
    try {
      const [{ cost, usd }, map] = await Promise.all([
        seed ? Promise.resolve({ cost: seed, usd: null }) : readFacts(kind.costPath),
        loadCredentialLinks(),
      ]);
      if (stopped) return;
      render(host, { cost, usd, links: linksFor(map, { family: 'chain', id: 'eth' }), checkedAt: new Date().toLocaleTimeString() }, hand);
      if (!cost.enough) timer = setTimeout(() => tick(), WATCH_MS);
    } catch (err) {
      if (stopped) return;
      host.replaceChildren(el('p', 'keypair-error', `${err.message} — the seal on this computer already secures the birth.`));
      const skip = el('button', 'btn btn-secondary ceremony-btn', 'FINISH WITHOUT ETHEREUM');
      skip.type = 'button';
      skip.addEventListener('click', hand.onSkip);
      host.append(skip);
    }
  };
  host.replaceChildren(el('p', 'witness-note', 'Reading the cost on Ethereum…'));
  tick(funding);
  return { stop };
};
