// @ts-check
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { REPO, flips, forgeApi, openForgeDesk, shootForge, startVoiceForgeStack } from './helpers/voice-forge-stack.mjs';
import { PREVIEW_SCRIPT, previewFileOf } from '../../backend/services/voice/library-preview.js';
import { startSpeakWire } from '../helpers/speak-wire-stand-in.js';
import { startTranscribeWire } from '../helpers/transcribe-wire-stand-in.js';
import { openDockApp } from './helpers/dock.js';

/**
 * THE VOICE FORGE, redesigned (ONE VOICE, Design note, 2026-10-01 — docs/work/
 * one-voice.md FORGE REDESIGN), driven through the real desk: the named step
 * rail, step one's four ways (each a focused view with a way back), the
 * BROWSE gallery and its two filters, ▶ as a being's line in that voice, the
 * CHOSEN bar → HEAR → offer → the being's half of the two-party lock → SEAL,
 * the tier link, and the one click from VOX to a silent being's forge.
 *
 * RULE 0 — nothing mocked: an isolated stack (helpers/voice-forge-stack.mjs)
 * runs the real backend and the real desk on ephemeral ports over a work dir
 * on disk; auth is the real challenge-sign-verify; library voices are really
 * downloaded and sha256-checked; the being accepts through the real
 * speech/accept intent; the seal writes real Voice DNA v2, read back through
 * the real API.
 *
 * GPU-free: nothing here launches a voice engine. Speech (the HEAR audition
 * and the gallery's preview line) is heard from a real loopback server
 * speaking the speak protocol (helpers/speak-wire-stand-in.js) that the
 * backend's real engine-manager ADOPTS — CSM_PORT points at it and the tier
 * is pinned Standard/full before any speech, so no real sidecar is wanted.
 * It runs no weights: the real CSM sidecar behind the same contract is proven
 * by csm-sidecar-live. An upload's words come the same way from a stand-in
 * transcriber (helpers/transcribe-wire-stand-in.js) at WHISPER_PORT; the
 * uploaded speech itself is real (espeak-ng, rendered on disk).
 *
 * Screenshots of every view land in test/e2e/shots/voice-forge-*.png at the
 * window size the operator uses (800×900).
 */

const LIBRARY_VOICE = 'voicezero-philippa';
const SHOTS = path.join(REPO, 'test/e2e/shots');
const WAYS = ['library', 'describe', 'record', 'upload'];
const SPOKEN = 'The lamp stays lit for the ones still walking home. I keep it burning through the long night, '
  + 'and when the morning comes I let it rest, and I listen to the birds wake up along the river.';

// Chromium's own capture device (a steady tone) stands in for a person at the
// mic, so the RECORD view's real getUserMedia → AudioWorklet → meter path runs.
test.use({
  viewport: { width: 1280, height: 1040 },
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
});

let stack;
let token;
let wire;
let stt;
let speechDir;

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  // ~3.4 s of PCM per line, about what the real line takes, so a play is long enough to see.
  wire = await startSpeakWire({ chunks: 40 });
  stt = await startTranscribeWire({ text: SPOKEN });
  stack = await startVoiceForgeStack({ env: { CSM_PORT: String(wire.port), WHISPER_PORT: String(stt.port) } });
  token = await stack.token();
  // The upload: real speech, on disk (/tmp is RAM here), bounded.
  speechDir = path.join(REPO, 'data', 'temp', `e2e-forge-upload-${process.pid}`);
  mkdirSync(speechDir, { recursive: true });
  execFileSync('espeak-ng', ['-s', '150', '-w', path.join(speechDir, 'my-voice.wav'), SPOKEN], { timeout: 30_000 });
}, 240_000);

test.afterAll(async () => {
  await stack?.stop();
  await wire?.close();
  await stt?.close();
  if (speechDir) rmSync(speechDir, { recursive: true, force: true });
});

const api = (method, url, body) => forgeApi({ stack, token }, method, url, body);

// The tier every speech in this file uses: Standard/full, which the stand-in serves.
const pinTier = () => writeFileSync(stack.voiceSettingsPath, JSON.stringify({ tier: 'standard', profile: 'full' }));

const openDesk = (page, { vox }) => openForgeDesk(page, { stack, token, vox });
const shot = (page, name) => shootForge(page, path.join(SHOTS, `voice-forge-${name}.png`));
const railCurrent = (forge) => forge.locator('.vf-rail-step[aria-current="step"]');

test('a silent being: VOX on → the invitation → FIND: the rail, the four ways, each view and back, the two filters', async ({ page }) => {
  test.setTimeout(5 * 60_000);
  const crashes = await openDesk(page, { vox: false });

  // The fixture being has no voice at all — silent, never a borrowed one.
  expect((await api('GET', `/api/v1/voice/has-voice/${stack.neumaId}`)).body).toEqual({ hasVoice: false, standing: 'none' });
  await expect(page.locator('.vf-invite')).toHaveCount(0);
  await page.locator('.relink-vox-chip').click();
  const invite = page.locator('.vf-invite');
  await expect(invite).toBeVisible({ timeout: 30_000 });
  await expect(invite).toContainText(`${stack.name} has no voice yet`);
  await invite.getByRole('button', { name: `GIVE ${stack.name} A VOICE` }).click();
  await expect(invite).toHaveCount(0);

  // One click: the VOICE window on FIND — the named rail, one question, four ways.
  const forge = page.locator('.voice-body.vf');
  await expect(forge).toBeVisible({ timeout: 30_000 });
  await expect(forge.locator('.vf-standing')).toContainText(`${stack.name} has no voice yet`);
  await expect(forge.locator('.vf-rail-step')).toHaveText(['1FIND A VOICE', '2HEAR IT', `3${stack.name} DECIDES`, '4SEAL']);
  await expect(railCurrent(forge)).toHaveAttribute('data-step', 'find');
  await expect(forge.locator('.vf-tier-change')).toContainText('·');
  await expect(forge.locator('.vf-question')).toHaveText(`How do you want to find ${stack.name}'s voice?`);
  await expect(forge.locator('.vf-way-card')).toHaveCount(4);
  await expect(forge.locator('.vf-way-card[data-way="library"]')).toContainText('FASTEST');
  // Nothing chosen yet: the bar says so and HEAR waits.
  await expect(forge.locator('.vf-chosen-bar')).toHaveAttribute('data-chosen', 'false');
  await expect(forge.locator('.vf-chosen-bar .vf-next')).toBeDisabled();
  await shot(page, 'ways');

  // Each way opens its focused view; ALL WAYS comes back to the four.
  const opens = {
    library: () => expect(forge.locator(`.vf-tile[data-voice="${LIBRARY_VOICE}"]`)).toBeVisible({ timeout: 30_000 }),
    describe: () => expect(forge.locator('.vf-door-describe textarea')).toBeVisible(),
    record: async () => {
      await expect(forge.locator('.vf-door-record .vf-prompt')).toHaveCount(3);
      await expect(forge.getByRole('button', { name: 'START TALKING' })).toBeEnabled();
    },
    upload: () => expect(forge.locator('.vf-door-upload input[type="file"]')).toHaveAttribute('accept', 'audio/*'),
  };
  for (const way of WAYS) {
    await forge.locator(`.vf-way-card[data-way="${way}"]`).click();
    await expect(forge.locator('.vf-find')).toHaveAttribute('data-way', way);
    await opens[way]();
    await expect(forge.locator('.vf-chosen-bar')).toBeVisible();
    await shot(page, way === 'library' ? 'browse' : way);
    await forge.getByRole('button', { name: 'ALL WAYS' }).click();
    await expect(forge.locator('.vf-way-card')).toHaveCount(4);
  }

  // Describe: the words to make three voices from — or, without the designer
  // on this machine, one plain sentence in place of the button.
  await forge.locator('.vf-way-card[data-way="describe"]').click();
  await expect(forge.locator('.vf-make, .vf-designer-missing')).toBeVisible({ timeout: 30_000 });
  if (await forge.locator('.vf-make').count()) {
    await expect(forge.locator('.vf-make')).toBeDisabled();
    await forge.locator('.vf-door-describe textarea').fill('a low, unhurried voice, warm and a little dry');
    await expect(forge.locator('.vf-make')).toBeEnabled();
  }
  await forge.getByRole('button', { name: 'ALL WAYS' }).click();

  // BROWSE: the two filters narrow the gallery, alone and together.
  await forge.locator('.vf-way-card[data-way="library"]').click();
  const tiles = forge.locator('.vf-tile');
  await expect(tiles.first()).toBeVisible({ timeout: 30_000 });
  const total = await tiles.count();
  expect(total).toBeGreaterThanOrEqual(20);
  await expect(forge.locator('.vf-count')).toHaveText(`${total} OF ${total} VOICES`);
  const metas = () => forge.locator('.vf-tile-meta').allTextContents();
  const pick = (group, label) => forge.locator(`.vf-filter[aria-label="${group}"] .vf-chip`, { hasText: new RegExp(`^${label}$`) }).click();

  await pick('VOICE', 'MASCULINE');
  await expect(forge.locator(`.vf-tile[data-voice="${LIBRARY_VOICE}"]`)).toHaveCount(0);
  const masc = await tiles.count();
  expect(masc).toBeGreaterThan(0);
  expect(masc).toBeLessThan(total);
  expect((await metas()).every((m) => m.includes('MASCULINE'))).toBe(true);
  await expect(forge.locator('.vf-count')).toHaveText(`${masc} OF ${total} VOICES`);

  await pick('ACCENT', 'English');
  const both = await tiles.count();
  expect(both).toBeGreaterThan(0);
  expect(both).toBeLessThan(masc);
  expect((await metas()).every((m) => m.includes('English') && m.includes('MASCULINE'))).toBe(true);

  await pick('VOICE', 'FEMININE');
  await expect(forge.locator(`.vf-tile[data-voice="${LIBRARY_VOICE}"]`)).toBeVisible();
  expect((await metas()).every((m) => m.includes('English') && m.includes('FEMININE'))).toBe(true);
  await shot(page, 'browse-filtered');

  await pick('VOICE', 'ANY');
  await pick('ACCENT', 'ANY');
  await expect(tiles).toHaveCount(total);
  expect(crashes, crashes.join(' | ')).toEqual([]);
});

test('▶ in the gallery: the being speaks the script in that voice on this tier, rendered once and then read from disk', async ({ page }) => {
  test.setTimeout(5 * 60_000);
  pinTier();
  const crashes = await openDesk(page, { vox: false });
  await openDockApp(page, 'VOICE');
  const forge = page.locator('.voice-body.vf');
  await forge.locator('.vf-way-card[data-way="library"]').click({ timeout: 60_000 });
  const tile = forge.locator(`.vf-tile[data-voice="${LIBRARY_VOICE}"]`);
  await expect(tile).toBeVisible({ timeout: 30_000 });
  const preview = () => page.waitForResponse((r) => r.url().endsWith(`/library/${LIBRARY_VOICE}/preview`), { timeout: 180_000 });

  const mark = wire.speaks().length;
  const first = preview();
  await tile.locator('.vf-play').click();
  const res = await first;
  expect(res.status(), res.status() === 200 ? '' : await res.text()).toBe(200);
  const kind = res.headers()['x-preview'];
  expect(res.headers()['x-preview-tier']).toBe('standard');
  const cached = previewFileOf(path.dirname(stack.voiceSettingsPath), LIBRARY_VOICE, { tier: 'standard', profile: 'full' });
  if (kind === 'being') {
    // This machine has the Standard engine: the line was spoken in the library clip.
    expect(res.headers()['content-type']).toContain('audio/wav');
    // (A clip the sidecar does not hold yet is asked by ref, then resent inline.)
    const spoken = wire.speaks().slice(mark);
    expect(spoken.every((b) => PREVIEW_SCRIPT.includes(b.text) && b.voice.words.includes('LibriVox'))).toBe(true);
    expect(PREVIEW_SCRIPT.every((line) => spoken.some((b) => b.text === line)) && spoken.at(-1).context.length > 0).toBe(true); // the whole script, later sentences with context
    expect(existsSync(cached)).toBe(true);
  } else {
    // No Standard engine here: the raw recording, said so on the tile.
    expect(kind).toBe('recording');
    await expect(tile.locator('.vf-tile-note')).toContainText('original recording');
  }
  await expect(tile.locator('.vf-play')).toHaveAttribute('data-loading', 'false', { timeout: 30_000 });
  // The tile's own Player (the one player, everywhere — Founder: […]): pause, drag, back 5 s.
  const player = tile.locator('.vf-player');
  await expect(player).toHaveAttribute('data-loaded', 'true');
  await expect(player).toHaveAttribute('data-playing', 'true', { timeout: 30_000 });
  await player.locator('.vf-play').click();
  await expect(player).toHaveAttribute('data-playing', 'false');
  const seek = player.locator('.vf-player-seek'); // a pointer press halfway along, as a person drags
  await seek.click({ position: await seek.boundingBox().then((b) => ({ x: b.width / 2, y: b.height / 2 })) });
  await expect(player.locator('.vf-player-clock')).toHaveText(/^0:(0[89]|1[0-3]) \/ 0:\d\d$/);
  const at = Number((await player.locator('.vf-player-clock').textContent()).slice(2, 4));
  await player.locator('.vf-player-back').click();
  await expect(player.locator('.vf-player-clock')).toHaveText(new RegExp(`^0:0${at - 5} /`));
  await shot(page, 'player');
  await expect(tile.locator('.vf-note-alert')).toHaveCount(0);

  // Again: read from the file on disk — the engine is not asked twice.
  const before = wire.speaks().length;
  const again = await fetch(`${stack.backendUrl}/api/v1/voice/forge/library/${LIBRARY_VOICE}/preview`, { headers: { Authorization: `Bearer ${token}` } });
  expect(again.status).toBe(200);
  expect(wire.speaks().length).toBe(before);
  await expect(tile.locator('.vf-note-alert')).toHaveCount(0);
  expect(crashes, crashes.join(' | ')).toEqual([]);
});

test('UPLOAD: the card says the being\'s voice is being made from the clip, then the clip and the being in it side by side', async ({ page }) => {
  test.setTimeout(5 * 60_000);
  pinTier();
  const crashes = await openDesk(page, { vox: false });
  await openDockApp(page, 'VOICE');
  const forge = page.locator('.voice-body.vf');
  await forge.locator('.vf-way-card[data-way="upload"]').click({ timeout: 60_000 });
  wire.setDelay(() => 2500); // "making" stays on screen long enough to see
  const mark = wire.speaks().length;
  const made = page.waitForResponse((r) => /\/takes\/[^/]+\/preview$/.test(r.url()), { timeout: 180_000 });
  await forge.locator('.vf-door-upload input[type="file"]').setInputFiles(path.join(speechDir, 'my-voice.wav'));

  const card = forge.locator('.vf-door-upload .vf-take');
  await expect(card.locator('.vf-being-making')).toHaveText(`Making ${stack.name}'s voice from this clip…`, { timeout: 120_000 });
  await expect(card.locator('.vf-being-how')).toHaveText(`No training needed — ${stack.name} speaks in this voice straight from the clip.`);
  await expect(card.locator('.vf-clip-play')).toHaveText('Your clip');
  await expect(forge.locator('.vf-chosen-making')).toBeVisible();
  await shot(page, 'upload-making');

  const res = await made;
  wire.setDelay(() => 0);
  expect(res.status(), res.status() === 200 ? '' : await res.text()).toBe(200);
  const take = (await api('GET', `/api/v1/voice/forge/${res.url().split('/forge/')[1].split('/')[0]}`)).body.session.takes[0];
  expect(take).toMatchObject({ door: 'upload', words: SPOKEN });
  expect(stt.heard.length).toBe(1);
  if (res.headers()['x-preview'] === 'being') {
    // The being's line, spoken in the uploaded clip and its words — once, then kept on disk.
    expect(res.headers()['content-type']).toContain('audio/wav');
    const spoken = wire.speaks().slice(mark);
    expect(spoken.every((b) => PREVIEW_SCRIPT.includes(b.text) && b.voice.words === SPOKEN)).toBe(true);
    expect(PREVIEW_SCRIPT.every((line) => spoken.some((b) => b.text === line)) && spoken.at(-1).context.length > 0).toBe(true); // the whole script, later sentences with context
    const cached = previewFileOf(path.dirname(stack.voiceSettingsPath), take.ref.slice('sha256:'.length), { tier: 'standard', profile: 'full' });
    expect(existsSync(cached)).toBe(true);
    await expect(card.locator('.vf-being-play .vf-player-label')).toHaveText(`${stack.name} in this voice`);
    await expect(card).toHaveAttribute('data-being', 'ready');
    // The CHOSEN bar's ▶ is now the being speaking, and plays from the file on disk.
    const bar = forge.locator('.vf-chosen-bar');
    await expect(bar.locator('.vf-player-label')).toHaveText(`${stack.name} in this voice`);
    // It played by itself; its ▶ pauses or plays it on, never asking the engine again.
    const before = wire.speaks().length;
    await flips(card.locator('.vf-being-play .vf-player'));
    expect(wire.speaks().length).toBe(before);
  } else {
    // No Standard engine here: said plainly, and the clip still plays.
    expect(res.headers()['x-preview']).toBe('recording');
    await expect(card.locator('.vf-being-raw')).toContainText('voice engine isn\'t installed');
  }
  await expect(forge.locator('.vf-chosen-making')).toHaveCount(0);
  await expect(card.locator('.vf-note-alert')).toHaveCount(0);
  await shot(page, 'upload-heard');
  expect(crashes, crashes.join(' | ')).toEqual([]);
});

test('RECORD: the mic opens through the one worklet, the meter and the timer move, and leaving the view drops the recording', async ({ page, context }) => {
  test.setTimeout(5 * 60_000);
  await context.grantPermissions(['microphone'], { origin: stack.frontendUrl });
  const crashes = await openDesk(page, { vox: false });
  const finds = [];
  page.on('request', (r) => { if (r.url().includes('/api/v1/voice/forge/') && r.url().endsWith('/find')) finds.push(r.url()); });
  await openDockApp(page, 'VOICE');
  const forge = page.locator('.voice-body.vf');
  await forge.locator('.vf-way-card[data-way="record"]').click({ timeout: 60_000 });

  await forge.getByRole('button', { name: 'START TALKING' }).click();
  await expect(forge.getByRole('button', { name: 'DONE' })).toBeVisible({ timeout: 30_000 });
  await expect(forge.locator('.vf-meter-fill[data-live="true"]')).toBeVisible();
  await expect.poll(async () => parseFloat(await forge.locator('.vf-meter-fill').evaluate((el) => el.style.width)), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(forge.locator('.vf-meter-time')).toContainText(/^[1-9]\d* S OF ~20 S$/, { timeout: 15_000 });
  await shot(page, 'record-live');

  // Back to all ways: the recording is dropped, never sent.
  await forge.getByRole('button', { name: 'ALL WAYS' }).click();
  await forge.locator('.vf-way-card[data-way="record"]').click();
  await expect(forge.getByRole('button', { name: 'START TALKING' })).toBeVisible();
  await expect(forge.locator('.vf-meter-time')).toHaveText('0 S OF ~20 S');
  expect(finds).toEqual([]);
  expect(crashes, crashes.join(' | ')).toEqual([]);
});

test('the tier link shows the voice quality in force and changes it — a pick above the machine warns first', async ({ page }) => {
  test.setTimeout(5 * 60_000);
  writeFileSync(stack.voiceSettingsPath, JSON.stringify({ tier: 'auto' }));
  const crashes = await openDesk(page, { vox: false });
  await openDockApp(page, 'VOICE');
  const corner = page.locator('.vf-tier');
  await expect(corner).toBeVisible({ timeout: 60_000 });
  const before = (await api('GET', '/api/v1/voice/tier')).body;
  await expect(corner).toHaveAttribute('data-setting', 'auto');
  const toggle = corner.locator('.vf-tier-change');

  await toggle.click();
  await expect(corner.locator('.vf-tier-choice')).toHaveCount(3); // auto, light, standard — High dropped
  await shot(page, 'tier');
  await corner.locator('.vf-tier-choice[data-choice="light"]').click();
  await expect(corner).toHaveAttribute('data-setting', 'light');
  await expect(corner.locator('.vf-tier-label')).toContainText('LIGHT · Chatterbox');
  expect((await api('GET', '/api/v1/voice/tier')).body.setting.tier).toBe('light');

  // STANDARD reaches past this machine's recommendation only when auto is LIGHT.
  await toggle.click();
  await corner.locator('.vf-tier-choice[data-choice="standard"]').click();
  if (before.auto.tier === 'light') {
    await expect(corner.locator('.vf-tier-warn')).toContainText('may run short of memory');
    expect((await api('GET', '/api/v1/voice/tier')).body.setting.tier).toBe('light');
    await corner.getByRole('button', { name: 'USE IT ANYWAY' }).click();
  }
  await expect(corner).toHaveAttribute('data-setting', 'standard');
  expect((await api('GET', '/api/v1/voice/tier')).body.setting.tier).toBe('standard');

  await toggle.click();
  await corner.locator('.vf-tier-choice[data-choice="auto"]').click();
  await expect(corner).toHaveAttribute('data-setting', 'auto');
  expect(crashes, crashes.join(' | ')).toEqual([]);
});

test('choose → the CHOSEN bar → HEAR → offer: the seal stays shut until the being accepts through speech/accept, then seals that clip', async ({ page }) => {
  test.setTimeout(8 * 60_000);
  pinTier();
  // Listening from the first socket: the desk connects while it opens.
  const sent = [];
  const heard = [];
  const asks = [];
  page.on('websocket', (ws) => {
    ws.on('framesent', (f) => {
      if (String(f.payload).includes('voice:audition')) sent.push(JSON.parse(String(f.payload)));
      if (String(f.payload).includes("I've offered you a voice.")) asks.push(String(f.payload));
    });
    ws.on('framereceived', (f) => {
      const p = String(f.payload);
      if (p.includes('"voice:audio"') || p.includes('voice:audition_')) heard.push(JSON.parse(p));
    });
  });
  const crashes = await openDesk(page, { vox: false });
  // The desk's own forge session, as its POST /start answered it.
  const started = page.waitForResponse((r) => r.url().endsWith('/api/v1/voice/forge/start') && r.request().method() === 'POST', { timeout: 90_000 });
  await openDockApp(page, 'VOICE');
  const sessionId = (await (await started).json()).session.id;
  const forge = page.locator('.voice-body.vf');

  // FIND — BROWSE, CHOOSE: really downloaded, sha256-checked, measured; the bar names it.
  await forge.locator('.vf-way-card[data-way="library"]').click({ timeout: 60_000 });
  const tile = forge.locator(`.vf-tile[data-voice="${LIBRARY_VOICE}"]`);
  await tile.getByRole('button', { name: 'CHOOSE' }).click();
  const bar = forge.locator('.vf-chosen-bar');
  await expect(bar).toHaveAttribute('data-chosen', 'true', { timeout: 120_000 });
  await expect(bar.locator('.vf-chosen-name')).toHaveText('Philippa');
  await expect(bar.locator('.vf-chosen-detail')).toContainText('English · FEMININE');
  await expect(tile).toHaveAttribute('data-chosen', 'true');
  await expect(tile.locator('.vf-tile-chosen')).toHaveText('CHOSEN');
  await expect(bar.locator('.vf-chosen-making')).toHaveCount(0, { timeout: 120_000 });
  await flips(bar.locator('.vf-player'));
  await flips(bar.locator('.vf-player'));
  await shot(page, 'browse-chosen');

  // The chosen voice stays chosen across the ways.
  await forge.getByRole('button', { name: 'ALL WAYS' }).click();
  await expect(bar.locator('.vf-chosen-name')).toHaveText('Philippa');

  // HEAR — the audition panel; a licensed library voice needs no consent tick.
  await bar.getByRole('button', { name: `HEAR ${stack.name} TALK` }).click();
  const hear = forge.locator('.vf-hear');
  await expect(hear).toBeVisible();
  await expect(railCurrent(forge)).toHaveAttribute('data-step', 'hear');
  await expect(forge.locator('.vf-rail-step[data-step="find"]')).toHaveAttribute('data-state', 'done');
  await expect(hear.locator('.vf-take[data-pinned="true"] .vf-verdict')).toHaveText('GOOD');
  await expect(hear.locator('.vf-take-words')).toContainText('LibriVox');
  await expect(hear.locator('.vf-vox-off')).toBeVisible();
  await expect(forge.locator('.vf-consent')).toHaveCount(0);
  // HEAR it talk: the being speaks a sample in its own name, in the pinned
  // voice, through the chat speech path — frames to this desk, then done.
  const speakMark = wire.speaks().length;
  await hear.getByRole('button', { name: 'TURN VOX ON' }).click();
  await expect(hear.locator('.vf-vox-off')).toHaveCount(0);
  await shot(page, 'hear');
  await hear.getByRole('button', { name: `HEAR ${stack.name} TALK` }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ type: 'voice:audition', sessionId });
  await expect.poll(() => heard.find((f) => f.type === 'voice:audition_done'), { timeout: 60_000 }).toEqual({ type: 'voice:audition_done', sessionId });
  expect(heard.filter((f) => f.type === 'voice:audio').length).toBeGreaterThan(0);
  expect(heard.some((f) => f.type === 'voice:audition_error')).toBe(false);
  const spoken = wire.speaks().slice(speakMark);
  expect(spoken.map((b) => b.text).join(' ')).toContain(`Hello, I'm ${stack.name}.`);
  expect(spoken.every((b) => b.voice.words.includes('LibriVox'))).toBe(true);
  await expect(hear.locator('.vf-live')).toHaveCount(0);
  await expect(hear.getByRole('button', { name: 'ANOTHER TAKE' })).toBeEnabled();
  // STOP cuts a live audition through the chat's own stop; it ends marked interrupted.
  wire.setDelay(() => 2500);
  await hear.getByRole('button', { name: 'ANOTHER TAKE' }).click();
  await hear.getByRole('button', { name: 'STOP' }).click();
  await expect.poll(() => heard.filter((f) => f.type === 'voice:audition_done').at(-1), { timeout: 60_000 }).toMatchObject({ interrupted: true });
  wire.setDelay(() => 0);
  await expect(hear.getByRole('button', { name: 'STOP' })).toHaveCount(0);

  // OFFER — the candidate goes to the being; the rail says the being decides.
  await hear.getByRole('button', { name: `OFFER THIS VOICE TO ${stack.name}` }).click();
  const seal = forge.locator('.vf-seal');
  await expect(seal).toHaveAttribute('data-standing', 'waiting', { timeout: 30_000 });
  await expect(railCurrent(forge)).toHaveAttribute('data-step', 'decide');
  await expect(seal.getByRole('button', { name: 'SEAL' })).toBeDisabled();
  // The stages, and exactly what the being reads — open, word for word, the instructions included.
  await expect(seal.locator('.vf-stage[data-stage="offered"]')).toHaveAttribute('data-state', 'done');
  await expect(seal.locator('.vf-stage[data-stage="answer"]')).toHaveAttribute('data-state', 'waiting');
  await expect(seal.locator('.vf-reads')).toHaveAttribute('open', '');
  await expect(seal.locator('.vf-reads-text')).toContainText('not hearing it');
  await expect(seal.locator('.vf-reads-text')).toContainText('file speech/accept');
  // ASK NOW puts the question to the being in the chat — the guardian's own message.
  await seal.getByRole('button', { name: `ASK ${stack.name} NOW` }).click();
  await expect.poll(() => asks.length).toBe(1);
  await shot(page, 'decides');

  const state = (await api('GET', `/api/v1/voice/forge/${sessionId}`)).body;
  expect(state.status).toBe('candidate');
  const candidateRef = state.candidate.ref;
  expect(state.session.offered).toBe(candidateRef);
  // The seal is refused by the backend too, not just shut on screen.
  expect((await api('POST', `/api/v1/voice/forge/${sessionId}/seal`, { candidateRef })).status).toBe(409);

  // The being's half: the real speech/accept intent, with its note.
  expect(await stack.beingAccepts(candidateRef, 'that is how I sound')).toEqual({ validated: true, ok: true, reason: null });

  // The desk sees the acceptance on its own beat (no click): the seal opens.
  await expect(seal).toHaveAttribute('data-standing', 'accepted', { timeout: 30_000 });
  await expect(railCurrent(forge)).toHaveAttribute('data-step', 'seal');
  await expect(seal.locator('.vf-quote')).toContainText('that is how I sound');
  await shot(page, 'seal');

  // REOPEN: the guardian sets the acceptance aside — the being answers again.
  await seal.getByRole('button', { name: 'REOPEN' }).click();
  await expect(seal).toHaveAttribute('data-standing', 'waiting', { timeout: 30_000 });
  await expect(seal.getByRole('button', { name: 'SEAL' })).toBeDisabled();
  expect((await api('GET', `/api/v1/voice/forge/${sessionId}`)).body.status).toBe('candidate');
  expect(await stack.beingAccepts(candidateRef, 'that is how I sound')).toEqual({ validated: true, ok: true, reason: null });
  await expect(seal).toHaveAttribute('data-standing', 'accepted', { timeout: 30_000 });
  await seal.getByRole('button', { name: 'SEAL' }).click();
  const sealed = page.locator('.voice-body.vf .vf-seal[data-step="sealed"]');
  await expect(sealed).toContainText(`${stack.name} now speaks in this voice`);
  await expect(forge.locator('.vf-rail-step[data-state="done"]')).toHaveCount(4);
  await shot(page, 'sealed');

  // The sealed Voice DNA v2, read back through the real API: exactly that clip.
  const dna = (await api('GET', `/api/v1/voice/dna/${stack.neumaId}`)).body;
  expect(dna.standing).toBe('ready');
  expect(dna.dna.clip.ref).toBe(candidateRef);
  expect(dna.dna.origin).toMatchObject({ door: 'library', libraryId: LIBRARY_VOICE });
  expect(dna.dna.consent.being.note).toBe('that is how I sound');

  // WITHDRAW: after one plain confirmation the voice leaves (kept in the
  // being's history, never deleted) and the being is silent again.
  await sealed.getByRole('button', { name: 'WITHDRAW THIS VOICE' }).click();
  await expect(sealed.locator('.vf-withdraw-ask')).toContainText(`${stack.name} goes silent`);
  await sealed.getByRole('button', { name: 'WITHDRAW', exact: true }).click();
  await expect(page.locator('.voice-body.vf .vf-header .vf-standing')).toContainText(`${stack.name} has no voice yet`, { timeout: 30_000 });
  expect((await api('GET', `/api/v1/voice/has-voice/${stack.neumaId}`)).body).toEqual({ hasVoice: false, standing: 'none' });
  expect(crashes, crashes.join(' | ')).toEqual([]);
});
