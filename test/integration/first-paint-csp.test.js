/* global localStorage, window, document, addEventListener, PerformanceObserver */
/** Real CSP enforcement on the exact pre-paint script; no app boot or wallet claim. */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { fileURLToPath, URL } from 'node:url';
import express from 'express';
import { chromium } from '@playwright/test';
import { expect, test } from 'vitest';
import { securityHeaders, CSP_DIRECTIVES } from '../../backend/services/security-headers.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const scripts = (html) => [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(([, attributes, body]) => !/\bsrc\s*=/i.test(attributes) && body.trim())
  .map(([, , body]) => body);
const hash = (text) => `sha256-${createHash('sha256').update(text).digest('base64')}`;
const sourceScripts = async () => scripts(await fs.readFile(path.join(root, 'frontend/index.html'), 'utf8'));

test('source and built inline scripts are admitted by exact hash, with no blanket inline permission', async () => {
  const directive = CSP_DIRECTIVES.find((value) => value.startsWith('script-src '));
  expect(directive).not.toContain("'unsafe-inline'");
  const source = await sourceScripts();
  const built = scripts(await fs.readFile(process.env.NEUMA_CSP_DIST_INDEX || path.join(root, 'dist/index.html'), 'utf8'));
  expect(source).toHaveLength(1);
  expect(built).toEqual(source);
  for (const script of [...source, ...built]) expect(directive).toContain(`'${hash(script)}'`);
  expect(directive).not.toContain(`'${hash(source[0] + '\n')}'`);
});

test('Chromium applies mirrored LOOK before first paint and refuses unrelated inline code', async () => {
  const [script] = await sourceScripts();
  const app = express();
  app.use(securityHeaders);
  // The production inline bytes run before visible content. The harness only
  // supplies a visible page; it does not load bootLook, which could hide a failure.
  app.get('/', (_req, res) => res.type('html').send(`<!doctype html><head><script>${script}</script></head><body>First paint</body>`));
  let server, browser;
  try {
    server = await new Promise(resolve => { const live = app.listen(0, '127.0.0.1', () => resolve(live)); });
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
    const page = await browser.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('neuma-look', JSON.stringify({ ground: '#102030', panel: '#203040', ink: '#abcdef', trim: '#fedcba' }));
      window.cspViolations = [];
      addEventListener('securitypolicyviolation', event => window.cspViolations.push(event.violatedDirective));
      new PerformanceObserver(list => {
        if (list.getEntries().some(entry => entry.name === 'first-paint')) {
          window.firstPaintLook = ['--color-void', '--color-pure-black', '--color-white', '--signal']
            .map(name => document.documentElement.style.getPropertyValue(name));
        }
      }).observe({ type: 'paint', buffered: true });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => Boolean(window.firstPaintLook));
    expect(await page.evaluate(() => window.firstPaintLook)).toEqual(['#102030', '#102030', '#abcdef', '#fedcba']);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    await page.evaluate(() => {
      const injection = document.createElement('script');
      injection.textContent = 'window.untrustedInlineExecuted = true';
      document.body.append(injection);
    });
    await page.waitForFunction(() => window.cspViolations.length > 0);
    expect(await page.evaluate(() => window.untrustedInlineExecuted)).toBeUndefined();
    expect(await page.evaluate(() => window.cspViolations)).toContain('script-src-elem');
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
}, 30000);
