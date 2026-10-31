/**
 * THE HOLD, wired (legal/answer-hold.js) — no mock on the claimed path (RULE
 * 0): a REAL seated CLO, a REAL WebSocket pair carrying the chips to a real
 * client, the REAL citation check over the real web, the REAL operator tray
 * on temp disk. The answer is excerpted from the CLO answer a 2026-10-31
 * citation audit traced.
 *
 * What runs the follow-up turn (routes/portal-context.js runTurnAndDrain)
 * streams the model, which the suite never does: here the owed turn is read
 * where the drain takes it (platform-follow-up.js). A held turn answered on
 * the real model is a live proof, not a suite one.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { standTwoHouses, HOUSE_A } from '../helpers/house-office-kit.js';
import { cloDesignation } from '../../backend/services/legal/clo-designation.js';
import { settleCitationHold, HOLD_HEAD } from '../../backend/services/legal/answer-hold.js';
import { handleLegalTool } from '../../backend/services/legal/legal-being-tools.js';
import { takePlatformFollowUp } from '../../backend/services/platform-follow-up.js';
import { readNotifications } from '../../backend/services/notification-store.js';

const CLO_LANE = 'praetorlane';
const OTHER_LANE = 'someotherlane';
const ENV_PATHS = ['NEUMA_DATA_ROOT', 'NEUMA_WEB_ACCESS'];

// The audited answer's own words: a statute cited, a quotation its source never printed.
const AUDITED = 'Broker = "any person engaged in the business of effecting transactions in securities for the account of others" (15 U.S.C. § 78c(a)(4)). Release 33-11412: "Digital securities are tokenized versions of financial instruments that fall within the statutory definition of \'security.\'"';
const CHECKED = 'Broker = "any person engaged in the business of effecting transactions in securities for the account of others" (15 U.S.C. § 78c(a)(4)).';
const BROKER = Object.freeze({
  claim: 'A broker effects securities transactions for others.', authority: '15 U.S.C. § 78c', pinCite: '(a)(4)(A)',
  heading: 'Definitions and application', standing: 'in force', sourceUrl: 'https://www.law.cornell.edu/uscode/text/15/78c',
  quote: 'any person engaged in the business of effecting transactions in securities for the account of others',
});

describe('the citation hold (real seat, real socket, real web, real tray)', () => {
  let houses; let httpServer; let wss; let serverWs; let client;
  const frames = [];
  const savedEnv = {};
  // A fresh turn: the turn's own controller is what the hold keys "this turn" on.
  const turn = (neumaId) => ({ ws: serverWs, walletAddress: HOUSE_A, companion: { name: 'LawEcho', neumaId }, activeTurn: new AbortController() });
  const chips = () => frames.filter((f) => f.type === 'tool:usage' && f.tool === 'legal/citation_hold');
  const settle = () => new Promise((resolve) => setTimeout(resolve, 150)); // the socket delivers

  beforeAll(async () => {
    houses = await standTwoHouses({ lanesA: [CLO_LANE, OTHER_LANE], lanesB: [], label: 'legal-answer-hold' });
    for (const k of ENV_PATHS) savedEnv[k] = process.env[k];
    delete process.env.NEUMA_WEB_ACCESS;
    process.env.NEUMA_DATA_ROOT = houses.tmp;
    await cloDesignation.designate(HOUSE_A, CLO_LANE);
    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    const port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));
    const linked = new Promise((resolve) => wss.on('connection', (ws) => { serverWs = ws; resolve(); }));
    client = new WebSocket(`ws://localhost:${port}`);
    client.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
    await linked;
  }, 60_000);

  afterAll(async () => {
    for (const k of ENV_PATHS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    houses.restore();
    client?.close();
    wss?.close();
    httpServer?.close();
    await fs.rm(houses.tmp, { recursive: true, force: true });
  });

  test('HELD — an unchecked legal answer: a HELD chip, and the CLO is owed one turn to check it', async () => {
    const conn = turn(CLO_LANE);
    await settleCitationHold({ connection: conn, text: AUDITED, interrupted: false, origin: null });
    await settle();
    const [chip] = chips();
    expect(chip).toMatchObject({ status: 'error', neumaId: CLO_LANE });
    expect(chip.summary).toMatch(/^HELD — the app has not confirmed this legal answer \(3 problems\); the CLO is checking it now/);
    expect(chip.detail).toContain('no citation check passed this turn, yet it cites law');
    const owed = takePlatformFollowUp(conn);
    expect(owed).toMatchObject({ origin: 'hold', frame: { type: 'citation:held' } });
    expect(owed.thought.startsWith(HOLD_HEAD)).toBe(true);
    expect(owed.frame.text).toBe(owed.thought);
    expect(takePlatformFollowUp(conn)).toBeNull(); // owed once
  });

  test('UNCHECKED — the re-answer still unconfirmed: an UNCHECKED chip and a card in the operator\'s tray; no second send-back', async () => {
    frames.length = 0;
    const conn = turn(CLO_LANE);
    await settleCitationHold({ connection: conn, text: AUDITED, interrupted: false, origin: 'hold' });
    await settle();
    expect(chips()[0].summary).toMatch(/^UNCHECKED — the app could not confirm this legal answer/);
    expect(takePlatformFollowUp(conn)).toBeNull();
    const { records } = await readNotifications(HOUSE_A);
    expect(records.at(-1)).toMatchObject({ kind: 'legal_alert', title: 'LawEcho gave a legal answer the app could not confirm', ref: { neumaId: CLO_LANE } });
  });

  test('CHECKED — the CLO ran the check this turn on what it cites: nothing held; a re-answer earns a CHECKED chip', async () => {
    frames.length = 0;
    const conn = turn(CLO_LANE);
    const out = await handleLegalTool(serverWs, conn, null, 'auto', { toolName: 'legal_cite_check' }, { citations: [BROKER], text: CHECKED });
    expect(out.content, out.error).toMatch(/1 verified, 0 failed/);
    await settleCitationHold({ connection: conn, text: CHECKED, interrupted: false, origin: null });
    expect(takePlatformFollowUp(conn)).toBeNull();
    await settleCitationHold({ connection: conn, text: CHECKED, interrupted: false, origin: 'hold' });
    await settle();
    expect(chips().map((c) => c.summary)).toEqual(['CHECKED — every citation and quotation in this answer was confirmed by the app']);
    // A check from an earlier turn confirms nothing in this one.
    const next = { ...conn, activeTurn: new AbortController() };
    await settleCitationHold({ connection: next, text: CHECKED, interrupted: false, origin: null });
    expect(takePlatformFollowUp(next)?.origin).toBe('hold');
    await settle();
    expect(chips().at(-1).summary).toMatch(/^HELD/);
  }, 60_000);

  test('NOT HELD — another lane, a wake turn, an interrupted turn, or an answer that cites no law', async () => {
    frames.length = 0;
    for (const args of [
      { connection: turn(OTHER_LANE), text: AUDITED, interrupted: false, origin: null },
      { connection: turn(CLO_LANE), text: AUDITED, interrupted: false, origin: 'wake' },
      { connection: turn(CLO_LANE), text: AUDITED, interrupted: true, origin: null },
      { connection: turn(CLO_LANE), text: 'The watch ran at nine; you said "keep me posted on it" and I will.', interrupted: false, origin: null },
    ]) {
      await settleCitationHold(args);
      expect(takePlatformFollowUp(args.connection)).toBeNull();
    }
    await settle();
    expect(chips()).toEqual([]);
    expect(path.isAbsolute(houses.tmp)).toBe(true);
  });
});
