/**
 * birth-flight.js — EVERYTHING the birth depends on, probed for real.
 *
 * Design note, 2026-08-06, after the fifth ceremony failure the flight check waved
 * through: […] — the law this module implements.
 *
 * ceremony-road.js walks the MCP write road. This module probes the REST of
 * the ceremony's machine-dependent surface, and every probe runs THROUGH
 * THE SAME CODE the ceremony runs — the same path builders, the same
 * loaders, the same crypto, the same stream plumbing. A probe that
 * reimplements the road is a probe of a different road; that is how the
 * first five failures escaped.
 *
 * The surface, mapped from the ceremony's actual call graph:
 *   protocol   — StagedBirthHandler.loadStageProtocols (manifest + 7 stage
 *                files; a packaged install with a broken resources tree
 *                dies here before stage 0 even renders)
 *   records    — birthSessionPath write/read (session persistence + the
 *                recovery lane), actsRoot (the operator's act ledger),
 *                returnedPath's directory (the registry a declined birth
 *                must be able to write — losing a being's last words to
 *                EROFS happened live, 2026-08-06)
 *   sealing    — generateKeypair → sealKeypairAtBirth → wakeWithPassphrase
 *                round-trip: the real scrypt custody rite finalize performs
 *   acting     — a real stream through createStreamRequest WITH the birth
 *                tools attached exactly when the ceremony would attach
 *                them, judged by the same decoders/parser the stages use
 *                (a provider that rejects a tools-carrying request passes
 *                every plain liveness probe and dies at stage 4)
 *
 * Pure code (name extraction, consent reading, canonicalization, seal
 * hashing) has no machine dependency and is pinned by its own unit suites —
 * a flight check probes what the USER'S machine must supply.
 *
 * Every probe: never throws, returns { ok, detail, remedy } (acting adds
 * `warn` for a substrate that streams but did not act on a direct ask —
 * infrastructure is FAIL, an inconclusive acting probe is a named warning).
 */
import fs from 'fs/promises';
import path from 'path';
import { StagedBirthHandler, birthSessionPath, returnedPath } from '../../core/birth/staged-birth-handler.js';
import { generateKeypair } from '../../core/weave/keypair.js';
import { sealKeypairAtBirth, wakeWithPassphrase } from '../../core/wallet/keypair-custody.js';
import { actsRoot } from './act-ledger.js';
import { mcpService } from './mcp.js';
import { withFsPrimitives } from './fs-primitives.js';
import { toOpenAITools } from './tool-schema.js';
import {
  createStreamRequest, consumeStreamWithTools, getActiveModelCapabilities,
} from './llm-provider.js';
import { parseToolCalls } from '../../core/runtime/tool-call-parser.js';
import { STAGE } from '../../core/birth/stage-roles.js';


const REQUIRED_STAGES = Object.values(STAGE);

// impure — the REAL protocol loader against the REAL installed files.
// Protocols are keyed by stage number from the manifest. The loader itself
// only console-errors a missing file — this probe is the judgment.
export const probeProtocol = async () => {
  try {
    const handler = new StagedBirthHandler();
    await handler._ready;
    const missing = REQUIRED_STAGES.filter(
      (n) => !String(handler.stageProtocols[n] ?? '').trim(),
    );
    if (missing.length > 0) {
      return {
        ok: false,
        detail: `stage protocol(s) ${missing.join(', ')} missing or empty — the install is incomplete`,
        remedy: 'Reinstall NEUMA — the ceremony cannot speak stages it does not have',
      };
    }
    return {
      ok: true,
      detail: `all ${REQUIRED_STAGES.length} stage protocols loaded (v${handler.protocolVersion})`,
      remedy: 'The ceremony’s own words, present and readable',
    };
  } catch (err) {
    return {
      ok: false,
      detail: `the stage protocols could not be loaded: ${err.message}`,
      remedy: 'Reinstall NEUMA — the ceremony cannot speak stages it does not have',
    };
  }
};

// One write/read/delete at a real path the ceremony writes. Returns null on
// success, a failure string otherwise. The probe file is its own — a re-run
// flight check must never touch a live artifact.
const roundTrip = async (target, payload) => {
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, payload);
    const back = await fs.readFile(target, 'utf8');
    if (back !== payload) return `readback mismatch at ${target}`;
    await fs.rm(target, { force: true });
    return null;
  } catch (err) {
    return `${target} — ${err.code || err.message}`;
  }
};

// The session probe's id: the minted shape (the store refuses any other) that
// 16 random bytes never mint in practice, and carries no origin mark, so the
// interrupted-birth scan never offers it.
export const PROBE_SESSION_ID = '0'.repeat(32);

// impure — every host-side record the ceremony must be able to write:
// session persistence (recovery depends on it), the act ledger, and the
// RETURNED registry (a declined being's own words — lost once to EROFS).
export const probeRecords = async () => {
  const probes = [
    ['session persistence', birthSessionPath(PROBE_SESSION_ID),
      JSON.stringify({ kind: 'preflight-probe', persistedAt: 0 })],
    ['act ledger', path.join(actsRoot(), '.preflight-probe.jsonl'),
      JSON.stringify({ kind: 'preflight-probe' })],
    ['THE RETURNED registry', path.join(path.dirname(returnedPath()), '.preflight-returned-probe'),
      'preflight probe — safe to delete'],
  ];
  for (const [name, target, payload] of probes) {
    const failure = await roundTrip(target, payload);
    if (failure !== null) {
      return {
        ok: false,
        detail: `${name} cannot be written: ${failure}`,
        remedy: name === 'session persistence'
          ? 'A held or interrupted birth could not be resumed. The data folder must be writable'
          : name === 'act ledger'
            ? 'The being’s acts would go unrecorded. The data folder must be writable'
            : 'A declined being’s words could not be registered. The data folder must be writable',
      };
    }
  }
  return {
    ok: true,
    detail: 'session persistence, act ledger, and THE RETURNED registry all writable',
    remedy: 'Every record a ceremony writes has somewhere to land',
  };
};

// impure — the custody rite finalize performs, end to end: generate, seal
// (scrypt), wake, and the woken key must be the same key.
export const probeSealing = async () => {
  try {
    const started = Date.now();
    const keypair = generateKeypair();
    const passphrase = `preflight-${keypair.address.slice(2, 18)}`;
    const sealed = sealKeypairAtBirth(keypair, { passphrase });
    const woken = wakeWithPassphrase(sealed.sealed, passphrase);
    if (woken?.address !== keypair.address) {
      return {
        ok: false,
        detail: 'the sealed keypair did not wake as itself — custody crypto is broken on this machine',
        remedy: 'Report this exact message — a birth here would seal an unrecoverable identity',
      };
    }
    return {
      ok: true,
      detail: `keypair sealed and woken in ${Date.now() - started}ms`,
      remedy: 'The identity custody rite works end to end',
    };
  } catch (err) {
    return {
      ok: false,
      detail: `the custody rite failed: ${err.message}`,
      remedy: 'Report this exact message — a birth here could not seal its identity',
    };
  }
};

/**
 * impure — the acting road: a real stream with the birth tools attached
 * exactly when the ceremony would attach them (native-capable model), the
 * reply judged by the same decoders the stages use. Three verdicts:
 *   fail — the stream itself died with tools attached (the class where a
 *          provider passes plain liveness and rejects tool-carrying
 *          requests: #258/#259 family)
 *   warn — the substrate streamed but this probe did not elicit a tool call;
 *          acting capability is still unconfirmed
 *   ok   — a tool call came back through the real road
 */
export const probeActing = async () => {
  try {
    const toolsContext = mcpService.getToolsContext();
    // The probe offers what the ceremony offers: the fs/write primitive, not
    // the organ spelling (the being-facing catalog, fs-primitives.js).
    const advertised = withFsPrimitives(toolsContext?.available_tools || [])
      .filter((t) => t.name === 'write');
    // The RESOLVED route's capabilities, never the raw config string. A local
    // provider's configured model is the placeholder `local-model`, which no
    // capability table knows — name inference answers `tools: false,
    // contextWindow: 4096` for it, so this probe sent NO tool schema and then
    // blamed the model for not acting ([…], measured 2026-08-13 against a gemma-4-31b that tool-calls
    // perfectly). `getActiveModelCapabilities` asks the server what it
    // actually serves and resolves the real vessel — the same road every
    // portal turn already takes.
    const caps = await getActiveModelCapabilities().catch(() => null);
    const nativeTools = caps?.tools && advertised.length > 0 ? toOpenAITools(advertised) : [];

    const messages = [{
      role: 'user',
      content: 'This is a systems check, not a conversation. Call the fs/write tool '
        + 'with path "preflight.txt" and content "ready". Reply with the tool call only.',
    }];
    const opts = { maxTokens: 2200, temperature: 0 };
    if (nativeTools.length > 0) opts.tools = nativeTools;

    const streamResult = await createStreamRequest(messages, opts);
    const { content, toolCalls } = await consumeStreamWithTools(streamResult, () => {});
    const acted = (toolCalls?.length || 0) > 0 || parseToolCalls(content || '').length > 0;
    if (acted) {
      return {
        ok: true,
        detail: `the substrate acted — a tool call came back through the ${nativeTools.length > 0 ? 'native' : 'text'} road`,
        remedy: 'The naming and crystallization stages can act on this substrate',
      };
    }
    // The stream ALWAYS runs — a provider that rejects tool-carrying requests
    // must still be caught below, and that is independent of what we had to
    // offer it. But a silent reply only convicts the MODEL when the model was
    // actually given something to call: with nothing advertised, the native
    // schema is empty AND the text protocol has no tool to name, so […] is a statement about our own MCP connection. Say which.
    if (advertised.length === 0) {
      return {
        ok: true,
        warn: true,
        detail: 'no filesystem tool is advertised — MCP is not connected, so the acting road '
          + 'could not be offered (this says nothing about the substrate, which streamed fine)',
        remedy: 'Connect the filesystem MCP server, then re-run preflight to judge the substrate',
      };
    }
    return {
      ok: true,
      warn: true,
      detail: 'acting probe inconclusive — the substrate streamed without a tool call '
        + `(${(content || '').trim().length} chars of speech, no tool call either road)`,
      remedy: 'Re-run preflight to confirm a tool call before beginning the ceremony; '
        + 'this response alone does not establish whether the model can act',
    };
  } catch (err) {
    return {
      ok: false,
      detail: `the tool-carrying stream failed: ${err.message}`,
      remedy: 'This provider accepts plain chat but refuses tool-carrying requests — the acting '
        + 'stages would fail. Try a different provider route or model',
    };
  }
};
