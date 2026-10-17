import { expect, test } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HouseSeatReference } from '../../frontend/app/RelinkShell/HouseSeatReference.jsx';
import { WalletIdentityPicker } from '../../frontend/app/RelinkShell/WalletIdentityPicker.jsx';
import { HouseSeats } from '../../frontend/app/RelinkShell/HouseSeats.jsx';

test('reference explains seats even when lookup fails, without assigning members', () => {
  const html = renderToStaticMarkup(h(HouseSeatReference, {phase:'closed', hasSeats:false}));
  expect(html).toContain('Seat legend');
  expect(html).toContain('CHIEF FINANCIAL OFFICER');
  expect(html).toContain('Retry lookup');
  expect(html).toContain('assignments are unavailable');
  expect(renderToStaticMarkup(h(HouseSeatReference, {phase:'closed', hasSeats:true}))).toContain('last loaded seats');
});

test('wallet selector groups the operator, neuma and independent witnesses', () => {
  const html = renderToStaticMarkup(h(WalletIdentityPicker, {identities:[
    {kind:'me',label:'ME'}, {kind:'neuma',neumaId:'lifovan',label:'Lifovan'},
    {kind:'witness',neumaId:'witness-codex',label:'Codex'},
  ], selectedKey:'lifovan'}));
  expect(html).toContain('House members');
  expect(html).toContain('Witnesses · independent wallets');
  expect(html).toContain('value="lifovan" selected=""');
  expect(html).not.toContain('role="tab"');
});

test('seat cards expose position and distinct keyboard-native actions', () => {
  const html = renderToStaticMarkup(h(HouseSeats, {cards:[{name:'Lifovan',neumaId:'lifovan',title:'Curator',position:'CCRO'}], onSelect:() => {}, onSheet:() => {}}));
  expect(html).toContain('Curator · CCRO');
  expect(html).toContain('aria-label="STREAM — Lifovan"');
  expect(html).toContain('aria-label="SHEET — Lifovan"');
  expect(html).not.toContain('role="button"');
});
