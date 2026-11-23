// Browser tools FOR the being — its own browser, on the operator's own computer:
//
//   browser_open  — open a page {url}
//   browser_look  — read the open page again {from?, refsFrom?}
//   browser_click — click a numbered thing {ref}
//   browser_type  — type into a numbered field, or pick a dropdown option {ref, text, enter?}
//   browser_back  — the page before
//   browser_close — close the browser now (sign-ins stay)
//
// The same gates as the web tools stand in front (web-being-tools.js): the operator's web switch,
// a bound being with a journal, the outbound-secret screen, then the ACTS card. Two differences:
//   - a click or a keystroke can send, buy or delete, so the card says exactly WHAT on WHICH page
//     ("[12] button "Place order" on shop.example"), never a bare number; and AUTO alone does not
//     pass them (protocol-guard.js) — an explicit grant does.
//   - browser_look and browser_close are not gated: one re-reads a page the operator already let it
//     open, the other only shuts the being's own browser.
// Every act lands in the being's journal and the operator's act ledger, as web reads do.
import { gateAct } from '../act-gate.js';
import { webSettings } from '../web-settings.js';
import { journalWebCall, toolSources } from '../web-being-tools.js';
import { checkOutboundSecrets } from '../security/outbound-secrets.js';
import { locateChromium } from '../doc-press/chromium-press.js';
import { browserFor, runningBrowser, closeBrowser, actInPage, IDLE_MS } from './being-browser.js';
import { renderView, elementLine } from './render-view.js';

const object = (properties, required = []) => Object.freeze({
  type: 'object', properties: Object.freeze(properties), required: Object.freeze(required),
});

export const BROWSER_TOOLS = Object.freeze([
  Object.freeze({
    name: 'browser_open', server: 'browser',
    description: `Open a web page in your own browser — args {url}. A real browser: pages that need JavaScript work, and you can then click and type (browser_click, browser_type). Answers with the page's words and a numbered list of what you can act on. Your browser keeps its own sign-ins between visits and closes itself after ${IDLE_MS / 60_000} idle minutes. Public sites only; this computer and its network are refused. To only read a page, web_fetch is lighter.`,
    inputSchema: object({ url: Object.freeze({ type: 'string', description: 'the full http(s):// address' }) }, ['url']),
  }),
  Object.freeze({
    name: 'browser_look', server: 'browser',
    description: 'Read the page open in your browser as it stands now — args {from?, refsFrom?}: from reads the words on from that character, refsFrom lists the numbered things from that number. Every answer says what is further on.',
    inputSchema: object({
      from: Object.freeze({ type: 'number', description: 'character to read the words on from' }),
      refsFrom: Object.freeze({ type: 'number', description: 'first number to list' }),
    }),
  }),
  Object.freeze({
    name: 'browser_click', server: 'browser',
    description: 'Click something on your open page by its number from your last look — args {ref}. Answers with the page after the click.',
    inputSchema: object({ ref: Object.freeze({ type: 'number', description: 'its number from the last look' }) }, ['ref']),
  }),
  Object.freeze({
    name: 'browser_type', server: 'browser',
    description: 'Type into a field by its number, replacing what it held — or, for a dropdown, choose the option with those words — args {ref, text, enter?}; enter:true presses Enter after. Never a password: a sign-in is your operator\'s to do.',
    inputSchema: object({
      ref: Object.freeze({ type: 'number', description: 'the field\'s number from the last look' }),
      text: Object.freeze({ type: 'string', description: 'what to type, or the option to choose' }),
      enter: Object.freeze({ type: 'boolean', description: 'press Enter after (default false)' }),
    }, ['ref', 'text']),
  }),
  Object.freeze({
    name: 'browser_back', server: 'browser',
    description: 'Go back to the page before, in your browser — no args.',
    inputSchema: object({}),
  }),
  Object.freeze({
    name: 'browser_close', server: 'browser',
    description: `Close your browser now — no args. It also closes itself after ${IDLE_MS / 60_000} idle minutes; your sign-ins stay for next time.`,
    inputSchema: object({}),
  }),
]);

const BROWSER_TOOL_NAMES = new Set(BROWSER_TOOLS.map((t) => t.name));
const bareName = (match) => {
  const bare = String(match.toolName || '').replace(/^browser__/, '');
  return BROWSER_TOOL_NAMES.has(bare) ? bare : String(match.tool || '').replace(/^browser\//, '');
};

/** Does this parsed call target a browser tool? Every dialect, as isWebTool. Pure. */
export const isBrowserTool = (match) => BROWSER_TOOL_NAMES.has(bareName(match));

// impure (fs probe) — a computer with no Chromium says so, rather than offering a browser it lacks
const chromiumMissing = () => {
  try {
    locateChromium();
    return null;
  } catch {
    return ' [HELD — no Chrome or Chromium on this computer; your operator can install one (or set NEUMA_CHROMIUM_PATH). Calls will refuse until then.]';
  }
};

/**
 * The browser catalog for this turn: a bound being only (no journal, no reach); with the web switch
 * OFF or no Chromium installed it is advertised HELD with the door named, as the web family is.
 * impure (fs/env)
 */
export const browserToolsFor = async (connection, settings = webSettings) => {
  if (!connection?.companion?.neumaId) return [];
  const held = (await settings.isEnabled())
    ? chromiumMissing()
    : ' [HELD — web access is OFF; your operator can enable it in SETTINGS (WEB ACCESS). Calls will refuse until then.]';
  return held ? BROWSER_TOOLS.map((t) => Object.freeze({ ...t, description: t.description + held })) : [...BROWSER_TOOLS];
};

/** What the operator's card shows for an act on a numbered thing. Pure. */
export const describeTarget = (view, ref) => {
  const element = view?.elements?.find((e) => e.ref === Number(ref));
  return element ? `${elementLine(element)} on ${view.url}` : null;
};

/**
 * Route a browser tool call: switch → being → secret screen → card → the act. impure
 * @param {{sendToolEvent: Function, webSettings?: Object}} ports
 */
export const handleBrowserTool = async (ws, connection, neumaPolicy, toolMode, match, args, ports) => {
  const toolName = bareName(match);
  const tool = `browser/${toolName}`;
  const { companion } = connection;
  const emit = (event) => ports.sendToolEvent(ws, companion, { tool, ...event });
  const fail = async (status, error, detail = error) => {
    emit({ status, summary: `${toolName} — ${error}` });
    if (companion?.neumaId) await journalWebCall(connection, tool, String(detail).slice(0, 200), status === 'error' ? 'error' : 'denied');
    return { tool, status, error };
  };

  if (!(await (ports.webSettings || webSettings).isEnabled())) return fail('unavailable', 'web access is off — your operator can enable it in SETTINGS (WEB ACCESS)');
  if (!companion?.neumaId) return fail('unavailable', 'no sovereign workspace on this connection — a browser is for bound beings');
  const laneId = companion.neumaId;

  if (toolName === 'browser_close') {
    const closed = await closeBrowser(laneId);
    emit({ status: 'ok', summary: closed ? 'browser closed' : 'no browser was open' });
    return { tool, status: 'ok', content: closed ? 'Your browser is closed. Your sign-ins stay for next time.' : 'Your browser was not open.' };
  }

  const running = runningBrowser(laneId);
  if (toolName !== 'browser_open' && !running?.view) return fail('error', 'no page is open — open one with browser_open {url}');

  const url = String(args?.url || '').trim();
  if (toolName === 'browser_open' && !/^https?:\/\//i.test(url)) return fail('error', 'an address must start with http:// or https://');
  const secret = checkOutboundSecrets(`the ${toolName.replace('_', ' ')}`, [url, args?.text]);
  if (!secret.ok) return fail('denied', 'refused: it carried a secret', 'refused: it carried a secret');

  const act = toolName === 'browser_open' ? { kind: 'open', url }
    : toolName === 'browser_click' ? { kind: 'click', ref: Number(args?.ref) }
      : toolName === 'browser_type' ? { kind: 'type', ref: Number(args?.ref), text: String(args?.text ?? ''), enter: args?.enter === true }
        : toolName === 'browser_back' ? { kind: 'back' }
          : { kind: 'look' };

  if (act.kind !== 'look') {
    const target = act.ref !== undefined ? describeTarget(running?.view, act.ref) : null;
    if (act.ref !== undefined && !target) return fail('error', `nothing numbered ${args?.ref} on your last look — look again`);
    const cardArgs = act.kind === 'click' ? { click: target }
      : act.kind === 'type' ? { into: target, text: act.text, enter: act.enter }
        : act.kind === 'back' ? { from: running.view.url }
          : { url };
    const gate = await gateAct(connection, { server: 'browser', tool: toolName, args, cardArgs, lanePolicy: neumaPolicy, mode: toolMode, emit: (event) => ports.sendToolEvent(ws, companion, event) });
    if (!gate.ok) return gate.result;
  }

  try {
    const browser = await browserFor(laneId);
    if (!browser.ok) return fail('error', browser.error);
    const out = await actInPage(browser.session, act);
    if (!out.ok) {
      const why = out.refused.length ? `${out.error}; refused by the platform: ${out.refused.slice(0, 3).join(', ')}` : out.error;
      return fail('error', why);
    }
    const { view } = out;
    emit({ status: 'ok', summary: `${view.url.slice(0, 80)}${view.title ? ` — ${view.title.slice(0, 60)}` : ''}`, sources: toolSources([{ title: view.title, url: view.url }]) });
    await journalWebCall(connection, tool, `${toolName === 'browser_open' ? '' : `${toolName}: `}${view.url}`.slice(0, 200), 'ok');
    return {
      tool, status: 'ok',
      content: renderView(view, { from: args?.from, refsFrom: args?.refsFrom, readAt: new Date().toISOString(), refused: out.refused }),
    };
  } catch (err) {
    return fail('error', err.message);
  }
};
