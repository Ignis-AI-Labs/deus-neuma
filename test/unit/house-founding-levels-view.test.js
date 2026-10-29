// The HOUSE window's founding, in two levels (2026-10-26), rendered for real (react-dom/server over the actual
// panel): a house not founded is offered the founding ON THIS COMPUTER first; a house founded here shows its own
// record and, beneath it, the road to Unavis — founding on Ethereum; a house on Ethereum shows the network's register.
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HouseFoundingRite } from '../../frontend/app/RelinkShell/HouseFoundingRite.jsx';

const OPERATOR = '0x1111111111111111111111111111111111111111';
const HAZEL = '0x2222222222222222222222222222222222222222';
const actions = { probe: () => {} };
const render = (props) => renderToStaticMarkup(createElement(HouseFoundingRite, { actions, ...props }));
const localRecord = {
  houseName: 'Giagarli', foundedAt: '2026-10-26T06:00:00.000Z', network: 'local',
  members: [
    { kind: 0, title: 'Rector', displayName: 'Operator', address: OPERATOR },
    { kind: 1, title: 'Faber', displayName: 'Hazel', address: HAZEL },
  ],
};

describe('the house founding, local first and the network after', () => {
  it('a house not founded is offered the founding on this computer — free, private — and told how Unavis works', () => {
    const html = render({ rite: { phase: 'open' }, localRite: { phase: 'open' } });
    expect(html).toContain('FOUND THE HOUSE ON THIS COMPUTER');
    expect(html).toContain('NOTHING IS SENT, NOTHING COSTS');
    expect(html).toContain('TO JOIN UNAVIS, THE NETWORK OF HOUSES, IT LATER FOUNDS ITSELF ON ETHEREUM');
    expect(html).not.toContain('JOIN UNAVIS — FOUND ON ETHEREUM');
    expect(html).not.toContain('ONLY OFFICIAL RECOGNITION');
  });

  it('a house founded here shows its record, every founder with its title, and the door to join Unavis', () => {
    const html = render({ rite: { phase: 'open' }, localRite: { phase: 'founded', state: localRecord }, witnessName: 'Rowan' });
    expect(html).toContain('THE HOUSE STANDS ON THIS COMPUTER · FOUNDED 2026-10-26 · 2 FOUNDERS');
    expect(html).toContain('Hazel');
    expect(html).toContain('Faber');
    expect(html).toContain('Rector');
    expect(html).toContain('JOIN UNAVIS — FOUND ON ETHEREUM');
    expect(html).toContain('WITH EVERY FOUNDER SEALED THERE');
  });

  it('where Ethereum is not open on this desk, the house founded here still stands and says so', () => {
    const html = render({ rite: { phase: 'closed', error: 'no node is set' }, localRite: { phase: 'founded', state: localRecord } });
    expect(html).toContain('THE HOUSE STANDS ON THIS COMPUTER');
    expect(html).toContain('UNAVIS — NO NODE IS SET');
    expect(html).not.toContain('JOIN UNAVIS — FOUND ON ETHEREUM');
  });

  it('a house on Ethereum shows the network\'s register, not the local doors', () => {
    const html = render({
      rite: { phase: 'founded', state: { network: 'ethereum', quorum: 1, roster: [{ kind: 0, title: 'Rector', address: OPERATOR }] } },
      localRite: { phase: 'founded', state: localRecord },
    });
    expect(html).not.toContain('FOUND THE HOUSE ON THIS COMPUTER');
    expect(html).not.toContain('JOIN UNAVIS — FOUND ON ETHEREUM');
  });
});
