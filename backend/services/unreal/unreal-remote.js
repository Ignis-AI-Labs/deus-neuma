// The wire to an Unreal editor open on THIS computer: its Remote Control server, over HTTP on
// 127.0.0.1 and nothing else. The host is not configurable on purpose — this module can only ever
// reach the operator's own machine. The port is NEUMA_UNREAL_PORT (default 30010, Unreal's own).
//
// What the editor must allow (Project Settings → Remote Control, or Config/DefaultRemoteControl.ini):
// remote Python execution, and the Python library on its allowed remote calls. When it does not, the
// editor's own refusal is passed on word for word, so the operator reads which setting is missing.
//
// Everything here is impure (network, disk); the Python it sends is built in unreal-scripts.js.

import fs from 'fs/promises';
import os from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import {
  unrealPort, statusScript, screenshotScript, toolsetIndexScript, toolsetScript, toolAccessScript,
  toolStartScript, toolPollScript, logLines, markedAnswer, openToolAnswer,
} from './unreal-scripts.js';

const HOST = '127.0.0.1';
const PYTHON_LIBRARY = '/Script/PythonScriptPlugin.Default__PythonScriptLibrary';
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/** An error the tools turn into "unavailable" (no editor) or "error" (the editor said no). */
const wireError = (code, message) => Object.assign(new Error(message), { code });

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * @param {{ env?: Record<string, string|undefined> }} [opts]
 */
export const createUnrealRemote = ({ env = process.env } = {}) => {
  const endpoint = () => `http://${HOST}:${unrealPort(env)}`;

  // impure — one Remote Control call
  const put = async (path, body, timeoutMs) => {
    let response;
    try {
      response = await fetch(`${endpoint()}${path}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error?.name === 'TimeoutError') throw wireError('UNREAL_TIMEOUT', `the Unreal editor did not answer within ${Math.round(timeoutMs / 1000)} s`);
      throw wireError('UNREAL_DOWN', `no Unreal editor answers at ${endpoint()} — open the project in Unreal with the Remote Control plugin on`);
    }
    const text = await response.text();
    const parsed = (() => { try { return text ? JSON.parse(text) : {}; } catch { return null; } })();
    if (!response.ok || parsed?.errorMessage) {
      throw wireError('UNREAL_REFUSED', `the Unreal editor refused: ${parsed?.errorMessage || text.slice(0, 400) || `HTTP ${response.status}`}`);
    }
    return parsed ?? {};
  };

  /**
   * Run Python inside the editor. The call returns when the code has finished.
   * @returns {Promise<{ok: boolean, value: string, lines: string[]}>}
   */
  const python = async (code, { evaluate = false, timeoutMs = 600_000 } = {}) => {
    const out = await put('/remote/object/call', {
      objectPath: PYTHON_LIBRARY, functionName: 'ExecutePythonCommandEx',
      parameters: { PythonCommand: String(code), ExecutionMode: evaluate ? 'EvaluateStatement' : 'ExecuteFile', FileExecutionScope: 'Public' },
    }, timeoutMs);
    return { ok: out.ReturnValue === true, value: String(out.CommandResult ?? ''), lines: logLines(out.LogOutput) };
  };

  // impure — run one of our own scripts and take what it said on its marked line
  const ask = async (script, what, timeoutMs = 60_000) => {
    const out = await python(script, { timeoutMs });
    const answer = markedAnswer(out.lines);
    if (answer === undefined) throw wireError('UNREAL_REFUSED', `the Unreal editor could not ${what}: ${out.lines.filter((l) => l.startsWith('! ')).join(' ') || 'it gave no answer'}`);
    return answer;
  };

  return Object.freeze({
    endpoint,
    python,

    /** Which editor is open, on which project and level. */
    status: () => ask(statusScript(), 'report its state', 30_000),

    /**
     * A PNG of the level viewport. The editor writes it a few frames after the request, so this
     * waits until the file has stopped growing, reads it, and removes it.
     * @returns {Promise<{bytes: Buffer, width: number, height: number}>}
     */
    async viewport({ width = 1280, height = 720, waitMs = 30_000 } = {}) {
      const dir = await fs.mkdtemp(join(os.tmpdir(), 'neuma-unreal-'));
      const file = join(dir, 'viewport.png');
      try {
        const asked = await python(screenshotScript(file, width, height), { timeoutMs: 60_000 });
        if (!asked.ok) throw wireError('UNREAL_REFUSED', `the Unreal editor refused the picture: ${asked.lines.join(' ').slice(0, 400)}`);
        const end = Date.now() + waitMs;
        let last = -1;
        while (Date.now() < end) {
          await sleep(400);
          const size = await fs.stat(file).then((s) => s.size, () => 0);
          if (size > 0 && size === last) {
            const bytes = await fs.readFile(file);
            if (!bytes.subarray(0, 4).equals(PNG_MAGIC)) throw wireError('UNREAL_REFUSED', 'the Unreal editor wrote a file that is not a PNG');
            return { bytes, width, height };
          }
          last = size;
        }
        throw wireError('UNREAL_TIMEOUT', `the Unreal editor wrote no picture within ${Math.round(waitMs / 1000)} s (its viewport draws only while the editor is drawing)`);
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    },

    /** Every toolset Epic registered: [{name, tools: count}]. */
    toolsets: () => ask(toolsetIndexScript(), 'list its toolsets'),

    /** One toolset whole, or null when the editor has none by that name. */
    toolset: (name) => ask(toolsetScript(name), 'describe that toolset'),

    /** Epic's own read/write mark for one tool: {found, accessMode}. */
    toolAccess: (toolset, tool) => ask(toolAccessScript(toolset, tool), 'look that tool up'),

    /**
     * Call one of Epic's agent tools and wait for its answer (they answer some frames later, so
     * the wait is separate requests with the editor ticking in between).
     */
    async callTool(toolset, tool, args = {}, { waitMs = 120_000 } = {}) {
      const key = `_neuma_tool_${randomUUID().replace(/-/g, '')}`;
      const started = await python(toolStartScript(key, toolset, tool, args), { timeoutMs: 60_000 });
      if (!started.ok) throw wireError('UNREAL_REFUSED', `the Unreal editor could not start ${toolset} ${tool}: ${started.lines.join(' ').slice(0, 400)}`);
      const end = Date.now() + waitMs;
      while (Date.now() < end) {
        await sleep(400);
        const state = await ask(toolPollScript(key), 'report on that tool call');
        if (!state.done) continue;
        if (state.error) throw wireError('UNREAL_REFUSED', state.error);
        return openToolAnswer(state.value);
      }
      throw wireError('UNREAL_TIMEOUT', `${toolset} ${tool} did not answer within ${Math.round(waitMs / 1000)} s`);
    },
  });
};

// The one instance the tools share.
export const unrealRemote = createUnrealRemote();
