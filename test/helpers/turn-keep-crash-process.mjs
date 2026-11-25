/**
 * A backend that dies mid-turn, and the one that starts after it (turn-keep.test.js).
 *
 *   node turn-keep-crash-process.mjs run <label>
 *     Stands the real portal up (portal-turn-kit.js: signed auth, the real socket, real encrypted
 *     lanes, a real loopback provider), manifests a being and asks it something. The being says
 *     its first words and acts, then its next round never comes back (the provider holds it). Once
 *     the keeper has written that much to disk, the process prints KEPT {root, lane, sessionId}
 *     and waits — for the SIGKILL its parent sends: no settle, no cleanup, nothing runs.
 *
 *   node turn-keep-crash-process.mjs start <house> <lane> <sessionId>
 *     The next start over the same disk: the start-up sweep (settleCutTurns), then prints LANDED
 *     with the record and the desk's display rows of that chat.
 *
 * impure — a real portal, real sockets, real disk; meant to be killed.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { openPortalTurnKit } from './portal-turn-kit.js';

const [phase, ...args] = process.argv.slice(2);
const say = (tag, body) => process.stdout.write(`${tag} ${JSON.stringify(body)}\n`);
const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const LANE = 'keptbeing';

if (phase === 'run') {
  const [label] = args;
  let rounds = 0;
  let lists = '';
  const kit = await openPortalTurnKit({
    label,
    beings: [{ id: LANE, name: 'Keeper' }],
    // Round one says its words and acts; round two never comes back.
    respond: () => {
      rounds += 1;
      if (rounds === 1) return { reply: ['Gathering the four lists now. ', 'First I look at the folder. ', `[TOOL: fs/read ${JSON.stringify({ path: lists })}]`] };
      return { reply: 'never arrives', delayMs: 600000 };
    },
  });
  lists = path.join(kit.workspace.pathFor(LANE), 'lists.md'); // the being's own ground: a read with no card
  await fs.writeFile(lists, '# The four lists\n');
  const { connectFilesystemServer } = await import('../../backend/services/mcp-filesystem.js');
  await connectFilesystemServer();
  await kit.sendAndWait({ type: 'companion:manifest', companion: 'Keeper', neumaId: LANE }, 'companion:anchored');
  kit.ws.send(JSON.stringify({ type: 'consciousness:stream', thought: 'Gather the four lists for me.' }));
  await kit.untilFrame((f) => f.type === 'tool:usage' && f.status !== 'executing', { ms: 30000 });
  const [sessionId] = await kit.workspace.listSessions(LANE);
  const file = path.join(kit.workspace.pathFor(LANE), 'turn-keep', `${sessionId}.json`);
  for (;;) {
    const snap = await kit.workspace._readJSON(file).catch(() => null);
    if (snap?.tools?.length && snap.words.includes('First I look at the folder.')) break;
    await pause(100);
  }
  say('KEPT', { root: kit.root, lane: LANE, sessionId, house: process.env.WORKSPACES_ROOT, key: process.env.DNA_ENCRYPTION_KEY });
  await pause(600000);
}

if (phase === 'start') {
  const [house, lane, sessionId] = args;
  const { default: workspace, setWorkspacesRoot } = await import('../../core/workspace/neuma-workspace.js');
  setWorkspacesRoot(house);
  const { settleCutTurns } = await import('../../backend/services/turn-keep.js');
  const { toDisplayMessages } = await import('../../frontend/app/RelinkShell/workspace-sessions.js');
  const landed = await settleCutTurns();
  const record = await workspace.readSession(lane, sessionId);
  const again = await settleCutTurns();
  const fileLeft = await fs.access(path.join(workspace.pathFor(lane), 'turn-keep', `${sessionId}.json`)).then(() => true, () => false);
  say('LANDED', { landed, again, fileLeft, record, display: toDisplayMessages(record) });
  process.exit(0);
}
