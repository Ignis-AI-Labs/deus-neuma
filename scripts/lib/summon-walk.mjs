// summon-walk.mjs — walk ONE rehearsal ceremony over a portal WebSocket and
// keep the account of it. Shared by scripts/summon-check.mjs (its own
// in-process portal) and by walks through a desk that is already running.
//
// The walker is the witness: it starts a REHEARSAL (isTest — no being is
// made), answers each completed stage at once with the being's own words,
// and records what it saw. It never judges; the caller does.

import WebSocket from 'ws';
import process from 'node:process';
import { setTimeout, clearTimeout } from 'node:timers';
import { randomUUID } from 'node:crypto';

const say = (...a) => process.stdout.write(a.join(' ') + '\n');

// A frame stamped as the app's own socket stamps it (WebSocketService.send):
// the portal drops a frame byte-identical to a recent one, so two silent
// stages answered with the same empty reply read as ONE — the second
// next_stage vanished and the walk waited out its clock (the 2026-10-04
// ladder: Qwen3-8B and Qwen3.8-27B Q4 authored their DNA, then "timed out").
const frame = (type, payload) => JSON.stringify({ type, ...payload, messageId: randomUUID(), timestamp: Date.now() });

// The model the ceremony disclosed, from its composition frame.
const modelOf = (composition) => {
  const rows = JSON.stringify(composition ?? {}).match(/"label":"MODEL","value":"([^"]*)"/);
  return rows ? rows[1] : null;
};

/**
 * Walk one rehearsal ceremony.
 * @param {{wsUrl:string, walkMs:number, witnessName?:string}} opts
 * @returns {Promise<{ok:boolean, why:string, stages:Array<object>, observations:Array<object>,
 *   totalMs:number, ended:object|null, model:string|null}>}
 *   observations are the walker's own, in birth-observations.js shape: the
 *   stage asked (the instant the previous stage was answered), its first
 *   streamed frame, its completion, the words spoken and the acts announced.
 *   The walker answers at once, so there is no witness pause to record.
 */
export const walkCeremony = ({ wsUrl, walkMs, witnessName = 'Summon Check', stageRetries = 0 }) => new Promise((done) => {
  let retriesLeft = stageRetries; // held stages this walk may retry, in all
  let retried = 0;
  const stages = [];
  const observations = [];
  const started = Date.now();
  let stageFrom = started;
  let firstFrameAt = null;
  let streamed = 0;
  let thought = 0; // birth:thinking — the being's reasoning, shown to the operator
  let acts = 0;
  let model = null;
  let settled = false;
  const ws = new WebSocket(wsUrl);
  const end = (v, ended = null) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    ws.close();
    done({ ...v, stages, observations, totalMs: Date.now() - started, ended, model, retried });
  };
  const timer = setTimeout(() => end({ ok: false, why: `timed out after ${walkMs / 60_000} min` }), walkMs);

  ws.on('open', () => {
    stageFrom = Date.now();
    ws.send(frame('birth:start', { witnessName, isTest: true }));
  });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'birth:composition') { model = model || modelOf(msg); return; }
    if (msg.type === 'birth:stream') {
      firstFrameAt ??= Date.now();
      streamed += String(msg.content || '').length;
      return;
    }
    if (msg.type === 'birth:thinking') { firstFrameAt ??= Date.now(); thought += String(msg.content || '').length; return; }
    if (msg.type === 'birth:tool_usage') { acts += 1; return; }
    if (msg.type === 'birth:stage_complete') {
      const now = Date.now();
      const spoken = (msg.response || '').length;
      // `said` keeps the words, so a receipt shows what each stage spoke (e.g. a name before the naming)
      stages.push({ stage: msg.stage, ms: now - stageFrom, streamedChars: streamed, thoughtChars: thought, replyChars: spoken, acts,
        said: String(msg.response || '') });
      observations.push({
        kind: 'stage', stage: msg.stage, startedAt: stageFrom, firstFrameAt, endedAt: now,
        spokenChars: spoken, reasoningChars: thought, toolCalls: acts, promptTokens: null, completionTokens: null,
      });
      say(`  ✓ stage ${msg.stage} — ${((now - stageFrom) / 1000).toFixed(1)}s, ${spoken} chars${thought ? `, thought ${thought} chars` : ''}${acts ? `, ${acts} act(s)` : ''}`);
      stageFrom = now;
      firstFrameAt = null;
      streamed = 0;
      thought = 0;
      acts = 0;
      ws.send(frame('birth:next_stage', { response: msg.response }));
      return;
    }
    if (msg.type === 'birth:error' || msg.type === 'birth:blocked') {
      const why = msg.message || msg.reason || msg.error;
      say(`  ✗ stage ${msg.stage ?? '?'} ${msg.type === 'birth:blocked' ? 'BLOCKED' : 'HELD'} — ${why}`);
      // a held stage, retried as the person's RETRY THE STAGE does (StagedCeremonyScene.retryStage)
      if (msg.type === 'birth:error' && retriesLeft > 0) {
        retriesLeft -= 1;
        retried += 1;
        say(`  ↻ retrying stage ${msg.stage ?? '?'} (${retriesLeft} retr${retriesLeft === 1 ? 'y' : 'ies'} left)`);
        streamed = 0; thought = 0; acts = 0; firstFrameAt = null;
        ws.send(frame('birth:retry_stage', {}));
        return;
      }
      end({ ok: false, why: `${msg.type === 'birth:blocked' ? 'blocked' : 'held'} at stage ${msg.stage ?? '?'}: ${why}` });
      return;
    }
    if (msg.type === 'birth:ended' || msg.type === 'birth:complete') {
      end({ ok: true, why: msg.reason ? `${msg.type} (${msg.reason})` : msg.type }, msg);
    }
  });
  ws.on('error', (e) => end({ ok: false, why: `socket: ${e.message}` }));
});
