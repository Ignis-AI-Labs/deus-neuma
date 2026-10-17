// Real Chromium + React + WebSocketService + HTTP workspace router + portal
// navigation dispatcher. No provider, mocked response, spy, or fake transport.
// Claims stop at outgoing turn frames: the fixture never runs inference.
/* global window, document, localStorage */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDeskBrowserKit, A, B, until, wait } from '../helpers/desk-navigation-browser-kit.js';
import { encodeStreamTransfer } from '../../frontend/app/RelinkShell/stream-tab-transfer.js';

let kit;
beforeEach(async () => { kit = await createDeskBrowserKit(); }, 60000);
afterEach(async () => { await kit?.close(); kit = null; }, 30000);
const turns = () => kit.frames.filter((f) => ['consciousness:stream', 'consciousness:retry'].includes(f.type));

describe('H11 navigation owns deferred sends', () => {
  it('reconnect restores real browser preferences and the selected session', async () => {
    const page = await kit.page();
    await page.waitForFunction(() => document.getElementById('transcript').textContent.includes('hr-desk-a second history'));
    await page.evaluate(() => window.desk.stream.setChatMode('auto'));
    await page.waitForFunction(() => window.desk.stream.chatMode === 'auto' && window.desk.stream.toolMode === 'auto');
    expect(await page.evaluate(() => localStorage.getItem('neuma.chat.mode:hr-desk-a'))).toBe('auto');
    const before = await page.evaluate(() => window.desk.stream.wsService.getSessionState());
    expect(before).toMatchObject({ neumaId: A, sessionId: 'session-two' });
    const start = kit.frames.length;
    kit.disconnectClients();
    await page.waitForFunction(() => !window.desk.stream.state.connected);
    await page.waitForFunction(() => window.desk.stream.state.connected);
    await until(() => kit.frames.slice(start).some((frame) => frame.type === 'chat:mode' && frame.mode === 'auto'));
    const reconnect = kit.frames.slice(start);
    expect(reconnect.find((frame) => frame.type === 'portal:resume')).toMatchObject({ neumaId: A, sessionId: 'session-two' });
    const toolAt = reconnect.findIndex((frame) => frame.type === 'tool:mode');
    const chatAt = reconnect.findIndex((frame) => frame.type === 'chat:mode');
    expect(toolAt).toBeGreaterThanOrEqual(0);
    expect(chatAt).toBeGreaterThan(toolAt);
    expect(reconnect[chatAt].mode).toBe('auto');
    await page.waitForFunction(() => window.desk.stream.chatMode === 'auto' && window.desk.stream.toolMode === 'auto');
    expect(await page.evaluate(() => window.desk.stream.wsService.getSessionState())).toEqual(before);
    expect(await page.locator('#transcript').textContent()).toContain('hr-desk-a second history');
    expect(turns()).toEqual([]);
    expect(kit.errors).toEqual([]);
  }, 30000);

  it.each(['new', 'resume', 'switch'])('cancels thought/attachment/retry/revision on %s while real history is delayed', async (navigation) => {
    const paused = kit.pause(`/${A}/sessions`);
    const page = await kit.page();
    await until(() => paused.used);
    await page.evaluate(() => {
      const stream = window.desk.stream;
      window.pendingSends = Promise.all([
        stream.sendThought('only for A', 'balanced', { ids: ['attachment-a'], previews: [] }),
        stream.sendRetry('turn-a'),
        stream.sendRevision('turn-a', 'revision for A', 'balanced', { ids: ['attachment-a'] }),
      ]);
    });
    expect(turns()).toEqual([]);
    await page.evaluate(({ navigation, B }) => {
      const stream = window.desk.stream;
      if (navigation === 'new') stream.newSession();
      if (navigation === 'resume') void stream.resumeSession({ neumaId: 'hr-desk-a', companionName: 'HR Desk A', sessionId: 'session-one' });
      if (navigation === 'switch') void stream.switchCompanion({ neumaId: B, name: 'HR Desk B' });
    }, { navigation, B });
    await page.waitForFunction(() => document.querySelectorAll('.notification-error').length === 3);
    paused.release();
    expect(await page.evaluate(() => window.pendingSends)).toEqual([false, false, false]);
    await wait(100);
    expect(turns()).toEqual([]);
    expect(await page.locator('.notification-error').allTextContents()).toEqual(expect.arrayContaining([
      expect.stringContaining('only for A (1 attachments)'),
      expect.stringContaining('Retry turn-a'),
      expect.stringContaining('revision for A (1 attachments)'),
    ]));
    expect(kit.errors).toEqual([]);
  }, 30000);

  it('an old real HTTP failure cannot block or overwrite a newer successful history', async () => {
    const paused = kit.pause(`/${A}/sessions`);
    const page = await kit.page();
    await until(() => paused.used);
    await page.evaluate((B) => window.desk.stream.switchCompanion({ neumaId: B, name: 'HR Desk B' }), B);
    await page.waitForFunction(() => document.getElementById('transcript').textContent.includes('hr-desk-b second history'));
    await kit.corruptOwner(A); // REAL router ownership failure, not a fabricated HTTP response.
    paused.release();
    await wait(1800); // includes the old retry window; stale failure must not enter it
    await page.getByText('Send', { exact: true }).click();
    await until(() => turns().length === 1);
    expect(turns()[0]).toMatchObject({ companion: 'HR Desk B', thought: 'fresh wire thought' });
    expect(await page.locator('#transcript').textContent()).not.toContain('history unavailable');
    expect(kit.requests.filter((url) => url === `/${A}/sessions`)).toHaveLength(1);
    expect(kit.errors).toEqual([]);
  }, 30000);

  it('valid gated send waits for the real resume, preserving the captured focus', async () => {
    const paused = kit.pause(`/${A}/sessions`);
    const page = await kit.page();
    await until(() => paused.used);
    await page.evaluate(() => { window.sent = window.desk.stream.sendThought('same navigation'); });
    paused.release();
    expect(await page.evaluate(() => window.sent)).toBe(true);
    await until(() => turns().length === 1);
    const resumeAt = kit.frames.findIndex((f) => f.type === 'portal:resume');
    const sendAt = kit.frames.findIndex((f) => f.type === 'consciousness:stream');
    expect(resumeAt).toBeGreaterThanOrEqual(0);
    expect(sendAt).toBeGreaterThan(resumeAt);
    expect(turns()[0]).toMatchObject({ companion: 'HR Desk A', toolWorkspace: kit.folderB });
    expect(kit.errors).toEqual([]);
  }, 30000);

  it('a stale retry failure cannot poison a newer navigation; deliberate fresh send remains inline', async () => {
    const first = kit.pause(`/${A}/sessions`);
    const page = await kit.page();
    await until(() => first.used);
    await kit.corruptOwner(A);
    const retry = kit.pause(`/${A}/sessions`);
    first.release();
    await until(() => retry.used);
    await page.evaluate((B) => window.desk.stream.switchCompanion({ neumaId: B, name: 'HR Desk B' }), B);
    retry.release();
    await wait(200);
    const sentInline = await page.evaluate(() => {
      window.desk.stream.newSession();
      return window.desk.stream.sendThought('fresh explicit sitting');
    });
    expect(sentInline).toBe(true);
    await until(() => turns().length === 1);
    expect(turns()[0]).toMatchObject({ companion: 'HR Desk B', thought: 'fresh explicit sitting' });
    expect(await page.locator('#transcript').textContent()).not.toContain('history unavailable');
    expect(kit.errors).toEqual([]);
  }, 30000);
});

describe('H12 full initial tab adoption', () => {
  it('the real window/strip/anchor keeps transferred id, session, persisted focus and outgoing folder A', async () => {
    const tab = {
      id: 'torn-original', kind: 'local', neumaId: A, name: 'HR Desk A',
      sessionId: 'session-one', createdAt: '2026-09-05T00:00:00Z',
      focus: { kind: 'folder', path: kit.folderA },
    };
    const page = await kit.page(encodeStreamTransfer(tab));
    await kit.step(page, 'initial transferred session adoption', () => page.waitForFunction(() => window.desk?.tabs?.anchorTabId === 'torn-original'
      && window.desk.stream.wsService.getSessionState()?.sessionId === 'session-one'));
    expect(await page.evaluate(() => window.desk.tabs.tabs)).toEqual([tab]);
    expect(await page.evaluate(() => window.desk.persisted().tabs)).toEqual([tab]);
    expect(await page.locator('#explorer-ground').textContent()).toBe(kit.folderA);
    await kit.step(page, 'send from transferred ground', async () => {
      await page.getByText('Send', { exact: true }).click();
      await until(() => turns().length === 1);
    });
    expect(turns()[0].toolWorkspace).toBe(kit.folderA);
    expect(await page.evaluate(() => window.desk.tabs.tabs[0].focus.path)).toBe(kit.folderA);
    await page.evaluate(() => window.desk.tabs.open({ kind: 'local', neumaId: 'hr-desk-a', name: 'New' }, { focus: false }));
    await kit.step(page, 'ordinary tab opens', () => page.waitForFunction(() => window.desk.tabs.tabs.length === 2));
    expect(await page.evaluate(() => window.desk.tabs.tabs[1])).toMatchObject({ sessionId: null, focus: null });
    await page.evaluate(async (folderB) => {
      window.desk.tabs.setTabGround('torn-original', { kind: 'folder', path: folderB });
      await window.desk.stream.resumeSession({ neumaId: 'hr-desk-a', companionName: 'HR Desk A', sessionId: 'session-two' });
    }, kit.folderB);
    await kit.step(page, 'newer session persists', () => page.waitForFunction(() => window.desk.persisted().tabs[0].sessionId === 'session-two'));
    expect(await page.evaluate(() => window.desk.persisted().tabs[0].focus.path)).toBe(kit.folderB);
    await page.reload();
    await kit.step(page, 'reload resumes newer sitting', () => page.waitForFunction(() => window.desk?.tabs?.anchorTabId === 'torn-original'
      && window.desk.stream.wsService.getSessionState()?.sessionId === 'session-two'));
    expect(await page.evaluate(() => window.desk.tabs.tabs[0].focus.path)).toBe(kit.folderB);
    expect(kit.errors).toEqual([]);
  }, 30000);
});
