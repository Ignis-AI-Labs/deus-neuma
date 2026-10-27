// The opened notification tray with a decision owed AND a long record: the
// WAITING ON YOU section keeps its whole height and the list beneath it is
// what scrolls. It used to shrink with the list, squeezed to a sliver the
// head drew over (Design note, 2026-10-27, […]). The tray's real
// stylesheets in a real browser; no mock.
/* global document */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';

const CSS = ['frontend/app/RelinkShell/NotificationTray/NotificationTray.css', 'frontend/app/RelinkShell/NotificationTray/TrayWaiting.css'];
const card = (i) => `<div class="ntray-card"><div>NOTICE</div><div>A queued post FAILED — x ${i}</div><div>the house's keys file can't be opened</div></div>`;
const page = (rows, cards) => `
  <div class="ntray"><div class="ntray-panel">
    <section class="ntray-wait-sec is-owed"><p class="ntray-wait-h"><b>${rows}</b> WAITING ON YOU <span class="ntray-wait-old">OLDEST 40.9H</span></p>
      <ul class="ntray-wait-rows">${Array.from({ length: rows }, (_, i) => `<li>decide post ${i}</li>`).join('')}</ul></section>
    <div class="ntray-panel-head"><span class="ntray-panel-title">NOTIFICATIONS</span><button class="ntray-panel-action">MARK ALL READ</button></div>
    <div class="ntray-panel-list">${Array.from({ length: cards }, (_, i) => card(i)).join('')}</div>
  </div></div>`;

let browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] }); });
afterAll(async () => { await browser?.close(); });

const measure = async (rows, cards) => {
  const p = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const styles = (await Promise.all(CSS.map((f) => fs.readFile(f, 'utf8')))).join('\n');
  await p.setContent(`<style>${styles}</style>${page(rows, cards)}`);
  const m = await p.evaluate(() => {
    const box = (s) => document.querySelector(s).getBoundingClientRect();
    const sec = document.querySelector('.ntray-wait-sec');
    const list = document.querySelector('.ntray-panel-list');
    return { sec: box('.ntray-wait-sec'), head: box('.ntray-panel-head'), secScrolls: sec.scrollHeight > sec.clientHeight + 1, listScrolls: list.scrollHeight > list.clientHeight + 1 };
  });
  await p.close();
  return m;
};

describe('the opened tray — WAITING ON YOU is never squeezed by a long record', () => {
  it('one decision owed, forty notifications: the section shows whole, the head sits below it, the list scrolls', async () => {
    const m = await measure(1, 40);
    expect(m.secScrolls).toBe(false);
    expect(m.head.top).toBeGreaterThanOrEqual(m.sec.bottom - 1);
    expect(m.listScrolls).toBe(true);
  });

  it('many decisions owed: the section stops at its own cap and scrolls itself; the head and list still stand', async () => {
    const m = await measure(40, 40);
    expect(m.sec.height).toBeLessThanOrEqual(240 + 1);
    expect(m.secScrolls).toBe(true);
    expect(m.head.top).toBeGreaterThanOrEqual(m.sec.bottom - 1);
  });
});
