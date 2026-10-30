// THE TAB STRIP NEVER SHOWS A VERTICAL SCROLL BAR (2026-10-30). The rail scrolls sideways when the
// tabs outrun it; CSS then makes it a vertical scroller too (overflow-x: auto turns overflow-y's
// `visible` into `auto`), and the open tab reaches 1px below the rail on purpose — to lie over the
// strip's bottom rule and open into the page. That 1px was vertical overflow: a native up/down
// scroll bar beside the last tab, and the overlap itself scrolled out of sight. The REAL TabStrip
// markup (renderToStaticMarkup of the component) with the REAL stylesheets (tokens + TabStrip.css)
// in REAL Chromium, at the width the operator's strip had. No mocks (RULE 0).
import fs from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { TabStrip } from '../../frontend/app/RelinkShell/TabStrip.jsx';
import { TAB_KIND } from '../../core/runtime/tab-budget.js';
import '../../frontend/i18n/index.js';

const NAMES = ['ALDER', 'CAEL', 'KESTREL', 'TALLOW', 'MIRREN', 'OSKAR', 'BRAMBLE', 'CINDER', 'DUNE', 'EMBER', 'FALLOW', 'GORSE'];
const css = async (rel) => fs.readFile(new URL(`../../${rel}`, import.meta.url), 'utf8');
const strip = (count) => renderToStaticMarkup(createElement(TabStrip, {
  tabs: NAMES.slice(0, count).map((name, i) => ({ id: `t${i}`, kind: TAB_KIND.local, neumaId: name.toLowerCase(), name })),
  focusedId: 't0',
}));

let browser;
let page;
let styles;
beforeAll(async () => {
  styles = (await Promise.all(['frontend/styles/tokens.css', 'frontend/styles/base.css', 'frontend/app/RelinkShell/TabStrip.css'].map(css))).join('\n');
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--hide-scrollbars=false'] });
  page = await browser.newPage({ viewport: { width: 1280, height: 400 } });
}, 60_000);
afterAll(async () => { await browser?.close(); });

// impure — lay the strip out at a width, then read the rail as the browser sees it
const measure = async (count, width) => {
  await page.setContent(`<!doctype html><html><head><style>${styles}</style></head>
    <body style="margin:0;background:#000"><div id="host" style="width:${width}px">${strip(count)}</div></body></html>`);
  return page.evaluate(() => {
    const rail = document.querySelector('.tabstrip-rail');
    const bar = document.querySelector('.tabstrip');
    const on = document.querySelector('.tabstrip-tab.is-on').getBoundingClientRect();
    rail.scrollTop = 5; // a vertical scroller moves; a rail that cannot scroll that way stays at 0
    const scrolledDown = rail.scrollTop;
    rail.scrollTop = 0;
    rail.scrollLeft = 40;
    const scrolledAcross = rail.scrollLeft;
    rail.scrollLeft = 0;
    // the rule under the tab row (the strip's bottom rule when the strip is one row), under the
    // open tab: the tab must be what is painted there, not clipped or scrolled away
    const ruleY = rail.getBoundingClientRect().bottom - 0.5;
    const oneRow = Math.abs(rail.getBoundingClientRect().bottom - bar.getBoundingClientRect().bottom) < 1;
    const hit = document.elementFromPoint(on.left + on.width / 2, ruleY);
    return {
      overflowsDown: rail.scrollHeight > rail.clientHeight,
      scrolledDown,
      scrolledAcross,
      tabCoversRule: Boolean(hit?.closest('.tabstrip-tab.is-on')),
      oneRow,
    };
  });
};

describe('the stream\'s tab strip', () => {
  test('four tabs at the operator\'s width: no vertical overflow, nothing scrolls down, the open tab still opens into the page', async () => {
    const m = await measure(4, 640);
    expect(m.oneRow).toBe(true);
    expect(m.overflowsDown).toBe(false);
    expect(m.scrolledDown).toBe(0);
    expect(m.tabCoversRule).toBe(true);
  });

  test('twelve tabs in a narrow strip still scroll sideways, and never down', async () => {
    const m = await measure(12, 360);
    expect(m.scrolledAcross).toBeGreaterThan(0);
    expect(m.overflowsDown).toBe(false);
    expect(m.scrolledDown).toBe(0);
  });

  test('a strip so narrow its door wraps to a second row: the tab row still never scrolls down', async () => {
    const m = await measure(4, 460);
    expect(m.overflowsDown).toBe(false);
    expect(m.scrolledDown).toBe(0);
    expect(m.tabCoversRule).toBe(true);
  });
});
