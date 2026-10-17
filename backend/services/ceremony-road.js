/**
 * ceremony-road.js — the flight check WALKS the ceremony's write road.
 *
 * Five community failures in a row (2026-08-03 → 2026-08-06) shared one
 * shape: the flight check said READY, and a write then died mid-ceremony on
 * the operator's screen — wrong prompt path (#257), the MCP server's own
 * allowed-roots wall (#272), a target directory that never existed (Echo).
 * Every one was knowable BEFORE stage 0, and none was checked, because the
 * old workspace row probed a DIFFERENT ROAD than the one the being walks:
 * it wrote host-side from the backend process at the workspaces root, while
 * the ceremony writes through the MCP filesystem SUBPROCESS — its own wall,
 * its own rules (write_file does not create parent dirs) — into the scratch
 * and the lane's dna/, neither of which the probe ever touched.
 *
 * So this module probes THE ACTUAL ROAD, end to end, and SETS IT UP as it
 * goes (Design note, 2026-08-06: […]):
 *
 *   1. Create the ceremony scratch dir and a probe lane shaped exactly like
 *      the lane naming will create (<root>/<id>/dna/) — mkdir here IS the
 *      setup the ceremony needs, not a test-only convenience.
 *   2. Write through the real MCP filesystem server into both targets —
 *      the same client, the same subprocess, the same wall the being hits.
 *   3. On a refusal or a dead client, reconnect the server ONCE and retry —
 *      a stale wall (home changed since boot) heals itself here instead of
 *      failing a stage.
 *   4. Read the bytes back host-side — a polite answer is not a landed file.
 *   5. Remove every trace.
 *
 * The probe lane carries a lane.json marker (kind: 'preflight-probe') from
 * the moment it exists, so even an interrupted cleanup can never read as a
 * being to listNeuma.
 *
 * Never throws — the flight check needs a verdict, not a stack.
 */
import fs from 'fs/promises';
import path from 'path';
import { mcpService } from './mcp.js';
import { connectFilesystemServer } from './mcp-filesystem.js';
import { resolveCeremonyScratchDir } from '../../core/birth/ceremony-write.js';
import { createLogger } from './logger.js';

const log = createLogger('CeremonyRoad');

/** Dot-prefixed and marked — never a being, never listed as one. */
export const PROBE_LANE = '.preflight-lane';

const PROBE_CONTENT = 'ceremony road probe — safe to delete';

/** The server's refusal text, wherever it put it. */
const refusalText = (result) =>
  result?.content?.find((c) => typeof c?.text === 'string')?.text
  || 'the filesystem tool refused the call';

// impure — one write through the real MCP road, verified on disk.
// Returns null on success, the failure's text otherwise.
const writeAndVerify = async (target) => {
  const result = await mcpService.callTool('filesystem', 'write_file', {
    path: target, content: PROBE_CONTENT,
  });
  if (result?.isError) return refusalText(result);
  const landed = await fs.readFile(target, 'utf8').catch(() => null);
  if (landed !== PROBE_CONTENT) {
    return `the tool reported success but nothing landed at ${target}`;
  }
  return null;
};

// impure — writeAndVerify with the one permitted self-heal: a dead client or
// a refusal earns exactly one reconnect (fresh roots) and one retry.
const writeWithHeal = async (target) => {
  let failure;
  try {
    failure = await writeAndVerify(target);
    if (failure === null) return null;
  } catch (err) {
    failure = err.message; // client not connected / transport died
  }
  log.warn('Ceremony road write failed — reconnecting the filesystem server once', {
    target, failure,
  });
  try {
    await connectFilesystemServer();
    return await writeAndVerify(target);
  } catch (err) {
    return `${failure}; reconnect failed: ${err.message}`;
  }
};

/**
 * Walk the ceremony's write road: set it up, write through the real MCP
 * server into every target a birth will need, verify on disk, clean up.
 *
 * // impure — real subprocess calls, real writes, real deletes
 * @param {{ projectRoot?: string, workspacesRoot: string }} opts
 * @returns {Promise<{ok: boolean, detail: string, remedy: string}>}
 */
export const probeCeremonyRoad = async ({ projectRoot = process.cwd(), workspacesRoot }) => {
  // The never-throws contract starts at the first line, not at the try —
  // path.join on a missing root would reject instead of returning a verdict.
  if (typeof workspacesRoot !== 'string' || !workspacesRoot) {
    return {
      ok: false,
      detail: 'no workspace home is configured',
      remedy: 'Choose the neuma home in the launch panel, then re-run the flight check',
    };
  }
  const scratchDir = resolveCeremonyScratchDir(projectRoot);
  const laneDir = path.join(workspacesRoot, PROBE_LANE);
  const dnaDir = path.join(laneDir, 'dna');
  // The probe's OWN basename, deliberately — same dir, same wall, same tool
  // as the real chosen_name.txt, but a re-run flight check during a HELD
  // ceremony must never touch a real artifact (the scratch also holds live
  // birth-session files).
  const nameProbe = path.join(scratchDir, '.preflight-probe.txt');
  const genesisProbe = path.join(dnaDir, 'genesis.md');

  // SET UP the road — these dirs existing is a ceremony precondition, and
  // creating them here is the flight check doing its job, not scaffolding.
  // Marker BEFORE dna/: the lane must never exist a moment unmarked, or an
  // interrupted setup could leave a directory listNeuma reads as a being.
  // (A crash exactly between mkdir and the marker still can — one window no
  // ordering closes — so every run FIRST removes any leftover probe lane:
  // the flight check always precedes a birth, so the phantom heals before
  // any roster is real.)
  try {
    await fs.rm(laneDir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(scratchDir, { recursive: true });
    await fs.mkdir(laneDir, { recursive: true });
    await fs.writeFile(path.join(laneDir, 'lane.json'),
      JSON.stringify({ kind: 'preflight-probe' }));
    await fs.mkdir(dnaDir, { recursive: true });
  } catch (err) {
    await fs.rm(laneDir, { recursive: true, force: true }).catch(() => {});
    return {
      ok: false,
      detail: `could not create the ceremony's directories: ${err.code || err.message}`,
      remedy: 'The chosen home must be writable — pick a different folder or fix its permissions',
    };
  }

  try {
    // The two writes every birth performs: the stage-4 naming into the
    // scratch, the stage-5 genesis into a lane's dna/. Same paths, same tool.
    const nameFailure = await writeWithHeal(nameProbe);
    if (nameFailure !== null) {
      return {
        ok: false,
        detail: `the naming write was refused at ${nameProbe} — ${nameFailure}`,
        remedy: 'The being cannot record its chosen name. Restart the app; if this persists, report the exact message above',
      };
    }
    const genesisFailure = await writeWithHeal(genesisProbe);
    if (genesisFailure !== null) {
      return {
        ok: false,
        detail: `the DNA write was refused at ${genesisProbe} — ${genesisFailure}`,
        remedy: 'The being cannot author its genesis. Restart the app; if this persists, report the exact message above',
      };
    }
    return {
      ok: true,
      detail: `naming → ${scratchDir} · genesis → ${workspacesRoot} — both landed through the filesystem tool`,
      remedy: 'The being’s naming and DNA writes land where the ceremony sends them',
    };
  } finally {
    // Remove every trace — a leftover probe must never look like a being
    // (the lane.json marker guards the interrupted case).
    await fs.rm(nameProbe, { force: true }).catch(() => {});
    await fs.rm(laneDir, { recursive: true, force: true }).catch(() => {});
  }
};
