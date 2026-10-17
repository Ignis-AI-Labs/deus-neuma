/**
 * CCR-LITE TOOL-RESULT PERSISTENCE — persist-first-then-ref (FR-1) with the
 * per-session byte ceiling. Fail-closed: unpersisted means unreferenced, and
 * the compressor renders the honest no-ref marker.
 *
 * Extracted VERBATIM from the tool loop (size-law breakdown 2026-08-26,
 * docs/work/size-law-breakdown.md Part 1 step 9 / #278) — a side-state
 * service the loop consults after execution, separable from the gate
 * ordering the loop itself enforces. Leaf module: imports shared leaves
 * only, never the loop, never portal-stream.
 */
import { createLogger } from './logger.js';
import { neumaWorkspace } from '../../core/index.js';
import { TOOL_RESULT_MAX_CHARS } from './tool-exchange.js';
import { compressToolResult } from '../../core/runtime/tool-result-compressor.js';
import { mintToolResultRef } from '../../core/workspace/neuma-workspace.js';

const log = createLogger('Portal');

/** Per-session ceiling on persisted tool-result bytes (CCR-lite retention,
 *  deferred from S-02). Past it, minting stops and markers fall back to the
 *  honest no-ref form — never a ref that cannot be retrieved. */
export const TOOL_RESULT_SESSION_BYTE_CAP = 16 * 1024 * 1024;

// CCR-lite persist-first-then-ref (FR-1): an ok-result whose content exceeds
// the model-facing cap gets its FULL content persisted to the session's
// sibling tool-results store, and only after the write lands does the result
// carry a ref. Fail-closed: any persist failure (or the session byte cap)
// means NO ref — the compressor then renders the honest no-ref marker.
// Mutates `result` (attaches .ref) and the connection's seq/byte counters.
// impure — encrypted disk append via neumaWorkspace
export const persistOverCapResult = async (connection, result) => {
  const { companion, sessionId } = connection;
  if (!sessionId || !companion?.neumaId) return null;
  const content = result.content ?? '';
  const cap = result.cap || TOOL_RESULT_MAX_CHARS;
  if (result.status !== 'ok' || content.length <= cap) return null;

  const byteCap = connection.toolResultByteCap ?? TOOL_RESULT_SESSION_BYTE_CAP;
  const used = connection.toolResultBytes || 0;
  const bytes = Buffer.byteLength(content, 'utf8');
  if (used + bytes > byteCap) {
    log.debug('Tool-result session byte cap reached — minting stopped', {
      sessionId, used, bytes, byteCap,
    });
    return null;
  }

  const seq = connection.toolResultSeq || 0;
  const ref = mintToolResultRef(sessionId, seq);
  try {
    await neumaWorkspace.appendToolResult(companion.neumaId, sessionId, {
      ref, seq, tool: result.tool, status: result.status, content, chars: content.length,
    });
  } catch (error) {
    // Fail-closed: unpersisted means unreferenced. The marker falls back to
    // the honest char-count form; the turn continues.
    log.debug('Tool-result persist failed — no ref attached', {
      sessionId, tool: result.tool, err: error.message,
    });
    return null;
  }
  connection.toolResultSeq = seq + 1;
  connection.toolResultBytes = used + bytes;
  result.ref = ref;
  // Composition telemetry (B-04): record COUNTS for the context map — never
  // content. The compressor is pure + deterministic, so measuring here yields
  // exactly the sentChars/kind that formatToolResult (tool-exchange.js)
  // will hand the model.
  const { compressed, kind } = compressToolResult(content, { cap, ref });
  connection.compositionToolResults = [
    ...(connection.compositionToolResults || []),
    Object.freeze({
      ref, tool: result.tool, originalChars: content.length, sentChars: compressed.length, kind,
    }),
  ];
  return ref;
};
