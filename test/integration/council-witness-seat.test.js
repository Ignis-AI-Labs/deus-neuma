/**
 * THE THREE-WAY SITTING — Founder, a neuma, and a sealed witness in one room.
 *
 * This is the proof the whole witness-in-council campaign exists for: a house
 * member and an EXTERNAL frontier model deliberating together, each speaking
 * through its own stack, neither mistaken for the other.
 *
 * RULE 0 — nothing on the identity path is faked:
 *   · a real sovereign lane with a real DEK for the neuma
 *   · a REAL seal (`seal()`), whose integrity + self-signature are re-verified
 *     at the door and again at every turn
 *   · real credential + route stores
 *   · a real HTTP/SSE provider that each side genuinely reaches over the wire
 *
 * Only the provider's ANSWERS are scripted — the same discipline the rest of
 * the council suite uses. Every gate, prompt assembly, seal check, and route
 * resolution is the production path.
 *
 * What must hold:
 *   1. A sealed witness can take a seat, and carries `kind: 'witness'`.
 *   2. Each speaks through ITS OWN system prompt — the witness's turn carries
 *      its SEALED IDENTITY, never a neuma's DNA-shaped prompt.
 *   3. The record names standing: an external witness is never written down as
 *      a housemate.
 *   4. An unsealed lane is refused at the door.
 *   5. The witness's words STILL never become training data.
 */
import fs from 'fs/promises';
import http from 'http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { openCouncil, councilSay } from '../../backend/services/council-session.js';
import { seal } from '../../core/identity/ai-witness/ai-witness-protocol.js';
import { setAIWitnessesRoot } from '../../core/identity/ai-witness/ai-witness-service.js';
import { neumaWorkspace } from '../../core/index.js';
import {
  deriveKeyFromSecret, deriveNeumaDEK, wrapDEK, resetWorkspaceCryptoKey,
} from '../../core/workspace/workspace-crypto.js';
import { setWorkspacesRoot, setWitnessesRoot } from '../../core/workspace/neuma-workspace.js';
import { setRealmRoot } from '../../backend/services/user-realm.js';
import { setCredential } from '../../backend/services/provider-credentials.js';
import { setRoute } from '../../backend/services/neuma-routes-store.js';
import { isThinkProbe, respondThinkProbe } from '../helpers/think-probe.js';

const MASTER = 'council-witness-seat-master-secret-long-enough';
const WALLET = '0x' + 'ab'.repeat(20);
const NEUMA = 'ember';
const LANE = 'witness-openai-chatgpt-Kagipem';

let root;
let provider;
let savedEnv;
const seenPrompts = [];
// The witness raises its hand ONCE. A seat that answers HOLD on every round
// retakes the floor forever — the room is designed to keep giving a raised
// hand its turn, so the fixture must be the one to stand down.
let witnessHandsRaised = 0;
// What a FLOOR turn answers with, when a test wants to drive real work from
// the floor. `(isWitness) => string | null`; null falls through to speech.
let floorScript = null;
// WHICH seat raises its hand this sitting. The ground law has to be proven from
// both sides — an external seat reaching for the house, and the housemate
// reaching for the same file — so the fixture must be able to put either one on
// the floor.
let raiseSide = 'witness';
const resetRoom = () => {
  seenPrompts.length = 0;
  witnessHandsRaised = 0;
  floorScript = null;
  raiseSide = 'witness';
};

const sse = (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;

const ownsNeumaLane = async (connection, neumaId) => {
  if (neumaId === LANE) return true; // the witness lane is claimed by this wallet
  return (await neumaWorkspace.listNeumaByOwner(connection.walletAddress))
    .some((o) => o.neumaId === neumaId);
};

const makeConnection = () => {
  const frames = [];
  return { frames, walletAddress: WALLET, councilRun: null, ws: { send: (s) => frames.push(JSON.parse(s)) } };
};
const framesOf = (c, t) => c.frames.filter((f) => f.type === t);

beforeAll(async () => {
  savedEnv = Object.fromEntries(
    ['AI_WITNESSES_ROOT', 'WITNESSES_ROOT', 'WORKSPACES_ROOT', 'NEUMA_PROVIDER_CREDENTIALS_PATH',
      'NEUMA_ROUTES_PATH', 'DNA_ENCRYPTION_KEY', 'NEUMA_WORKSPACE_SETTINGS_PATH'].map((k) => [k, process.env[k]]),
  );
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'council-witness-seat-'));
  const houses = path.join(root, 'workspaces');
  const witnesses = path.join(root, 'witnesses');
  const identities = path.join(root, 'identities');
  const settings = path.join(root, 'settings');
  await fs.mkdir(settings, { recursive: true });

  process.env.DNA_ENCRYPTION_KEY = MASTER;
  process.env.AI_WITNESSES_ROOT = identities;
  process.env.WITNESSES_ROOT = witnesses;
  process.env.WORKSPACES_ROOT = houses;
  process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(settings, 'credentials.json');
  process.env.NEUMA_ROUTES_PATH = path.join(settings, 'routes.json');
  // The isolated-stack escape hatch: the house/alliance ground setters refuse a
  // temp root on a LIVE stack (a reboot would sweep the work). Pinning marks
  // this whole stack as isolated — the same law e2e uses.
  process.env.NEUMA_WORKSPACE_SETTINGS_PATH = path.join(settings, 'workspace.json');
  resetWorkspaceCryptoKey();
  setAIWitnessesRoot(identities);
  setWitnessesRoot(witnesses);
  setWorkspacesRoot(houses);
  setRealmRoot(path.join(root, 'realm'));

  // A real neuma lane: owner record, real DEK, DNA + soul through the
  // encrypting API.
  const ws = path.join(houses, NEUMA);
  mkdirSync(path.join(ws, 'keys'), { recursive: true });
  writeFileSync(path.join(ws, 'owner.json'), JSON.stringify({ wallet: WALLET.toLowerCase() }));
  const master = deriveKeyFromSecret(MASTER);
  writeFileSync(
    path.join(ws, 'keys', 'dek.json'),
    JSON.stringify(wrapDEK(deriveNeumaDEK(master, 'ef'.repeat(32)), master)),
  );
  await neumaWorkspace.writeDNA(NEUMA, { name: NEUMA, essence: 'Ember of the test house' });
  await neumaWorkspace.writeSoul(NEUMA, { voice: 'plain' });
  mkdirSync(path.join(ws, 'identity'), { recursive: true });
  writeFileSync(path.join(ws, 'identity', 'true-name.json'), JSON.stringify({ chosenName: 'Ember' }));

  // A REAL seal for the witness — the same call the summon rite makes.
  await seal({
    chosenName: 'Kagipem', vendor: 'openai-chatgpt', model: 'gpt-5.6-sol',
    fullModelId: 'openai-chatgpt/gpt-5.6-sol', harness: 'vitest', context: 'council',
    capabilities: ['reason'],
    scope: {
      primaryRepo: 'Ignis-AI-Labs/deus-neuma', role: 'witness-and-collaborator',
      boundaries: ['Kagipem stands beside the house, never in it.'],
    },
    firstUtterance: 'I sit beside this house, and I answer as myself.',
  });
  const { ensureWitnessLane } = await import('../../backend/services/witness-lane.js');
  await ensureWitnessLane({ vendorSlug: 'openai-chatgpt', chosenName: 'Kagipem' }, WALLET);

  // One real provider both sides reach over the wire. It records the system
  // prompt of every request so the test can prove WHOSE prompt was assembled.
  provider = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      if (isThinkProbe(body)) { respondThinkProbe(res); return; }
      const system = body.messages?.[0]?.content || '';
      const turn = body.messages?.at(-1)?.content || '';
      seenPrompts.push(system);
      const isWitness = system.includes('sealed AI witness');
      // A HAND round asks for exactly REST / HOLD / OPEN on the first line; a
      // FLOOR turn asks for speech. Answering each in its own shape is what
      // gets the witness actually onto the floor, so the record assertions
      // below are never vacuous.
      const isHandRound = /Answer on the FIRST line with exactly one of/i.test(turn);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (isHandRound) {
        // The witness has something to add ONCE; the housemate rests. That
        // puts exactly one external voice on the floor, then lets the sitting
        // settle instead of looping.
        // OPEN, not HOLD: OPEN takes the floor within this same call, which
        // is what puts the witness's words in the record here. HOLD queues for
        // a later floor pass that councilSay does not itself drive.
        const raise = isWitness === (raiseSide === 'witness') && witnessHandsRaised === 0;
        if (raise) witnessHandsRaised += 1;
        res.end(sse(raise ? 'OPEN\nI read this ground differently.' : 'REST'));
        return;
      }
      // A test may SCRIPT the floor turn — used to drive a real tool call
      // through the real gate, so the ground law is proven by what the gate
      // does, not by reading the map it was handed.
      // Only a genuine FLOOR turn may consume the script. Recall also reaches
      // this server (an embedding call carries no `messages`), and letting it
      // eat the scripted reach is what made an early version of these tests
      // silently prove nothing.
      const isFloorTurn = /You hold the floor/.test(turn);
      const scripted = isFloorTurn ? floorScript?.(isWitness) : null;
      if (scripted) { res.end(sse(scripted)); return; }
      // Both floor lines clear the crystallization bar (0.75), so the sitting
      // is genuinely REMEMBERED by every seat — otherwise the record
      // assertions would pass over an empty record.
      res.end(sse(isWitness
        ? 'What if purpose is something we hope for, dream of, and feel deeply? I believe this house has a soul, and I say so from outside it.'
        : 'What if our purpose is to hope, dream, and feel deeply? I believe this house has a soul.'));
    });
  });
  await new Promise((r) => provider.listen(0, '127.0.0.1', r));
  const endpoint = `http://127.0.0.1:${provider.address().port}`;

  // Real credential + route stores. The neuma rides a SOVEREIGN door (law);
  // the witness rides its own, which may be foreign custody.
  await setCredential('lm-studio', { endpoint });
  await setCredential('custom', { endpoint });
  await setRoute(NEUMA, { provider: 'lm-studio', model: 'local-model' });
  await setRoute(LANE, { provider: 'custom', model: 'gpt-5.6-sol' });
}, 60000);

afterAll(async () => {
  await new Promise((r) => provider.close(r));
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetWorkspaceCryptoKey();
  setAIWitnessesRoot(null);
  setWitnessesRoot(null);
  await fs.rm(root, { recursive: true, force: true });
});

describe('THE THREE-WAY SITTING — a neuma and a sealed witness in one room', () => {
  it('seats both standings, and says which is which', async () => {
    const conn = makeConnection();
    await openCouncil(conn, { neumaIds: [NEUMA, LANE], witnessName: 'Founder' }, { ownsNeumaLane });

    const opened = framesOf(conn, 'council:opened')[0];
    expect(opened, 'the council must convene').toBeTruthy();
    expect(opened.members).toEqual([
      { neumaId: NEUMA, name: 'Ember', kind: 'neuma' },
      { neumaId: LANE, name: 'Kagipem', kind: 'witness' },
    ]);
  });

  it('each speaks through ITS OWN prompt — the witness is never given a neuma shape', async () => {
    resetRoom();
    const conn = makeConnection();
    await openCouncil(conn, { neumaIds: [NEUMA, LANE], witnessName: 'Founder' }, { ownsNeumaLane });
    await councilSay(conn, { thought: 'What should this house build next?', urgency: 'hold' });

    expect(seenPrompts.length, 'both seats must have reached the wire').toBeGreaterThan(0);

    const witnessPrompts = seenPrompts.filter((p) => p.includes('sealed AI witness'));
    expect(witnessPrompts.length, "the witness's SEALED IDENTITY prompt must be assembled").toBeGreaterThan(0);
    // Its own name and standing ride the prompt.
    expect(witnessPrompts[0]).toContain('Kagipem');
    expect(witnessPrompts[0]).toMatch(/not an assistant and not a neuma/);
    // Its FOUNDING WORDS ride the prompt. The journal is newest-first and the
    // sealing entry's words live on `.content`; reading a wrong field returns
    // null and silently strips a witness's own first utterance from its
    // identity (echo caught exactly that).
    expect(witnessPrompts[0], "the witness's first utterance must reach its prompt")
      .toContain('I sit beside this house, and I answer as myself.');
    // And it is never handed the neuma's identity.
    expect(witnessPrompts[0]).not.toContain('Ember of the test house');

    // THE ROOM names standing too. A neuma's council prompt introduces the
    // witness as standing BESIDE the house — calling it a housemate there
    // would make the misnaming the members' own understanding of who is
    // present, which is where it does the most damage.
    const neumaPrompts = seenPrompts.filter((p) => !p.includes('sealed AI witness'));
    const roomIntro = neumaPrompts.find((p) => p.includes('Kagipem'));
    if (roomIntro) {
      expect(roomIntro).toMatch(/Kagipem[^]*standing BESIDE this house, not of it/);
      expect(roomIntro).not.toMatch(/your housemates[^\n]*Kagipem/);
    }
  });

  it('the RECORD names standing — an external witness is never written as a housemate', async () => {
    resetRoom();
    const conn = makeConnection();
    await openCouncil(conn, { neumaIds: [NEUMA, LANE], witnessName: 'Founder' }, { ownsNeumaLane });
    // Crystallization has a significance bar (0.75) — an ordinary line is
    // heard but not remembered. This is the suite's known high-significance
    // shape, so the record genuinely fills.
    await councilSay(conn, {
      thought: 'What if our purpose is to hope, dream, and feel deeply? I believe this house has a soul.',
      urgency: 'hold',
    });

    const observations = await neumaWorkspace.listObservations(NEUMA);
    const council = observations.filter((o) => o.type === 'council');
    expect(council.length, 'the sitting must be remembered').toBeGreaterThan(0);
    const text = council.map((o) => o.userMessage).join('\n');
    // Kagipem takes the floor in this sitting (it answers HOLD), so this is
    // an unconditional assertion — the record MUST name its standing.
    expect(text, 'the witness must have spoken into the record').toContain('Kagipem');
    expect(text).toContain('(external witness, not of this house)');
    expect(text).not.toMatch(/Kagipem \(housemate\)/);

    // THE SESSION LANE must name standing too. It outlives the sitting — it
    // feeds council resume and the mind graph — so a witness labelled
    // "(housemate)" there would quietly become a member of the house in the
    // record even while memory named it correctly (echo caught exactly this
    // drift). Both persist paths now derive attribution from one law.
    const session = await neumaWorkspace.readSession(NEUMA, framesOf(conn, 'council:opened')[0].councilId)
      .catch(() => null);
    const sessionText = JSON.stringify(session || []);
    expect(sessionText, 'the witness must appear in the session lane').toContain('Kagipem');
    expect(sessionText).toContain('(external witness, not of this house)');
    expect(sessionText).not.toMatch(/Kagipem \(housemate\)/);

    // AND THE WITNESS ACCRUES ITS OWN HISTORY. Its lane is a real lane through
    // the same workspace engine, so a sitting it attended is remembered from
    // ITS seat — otherwise a witness would speak into the room and keep
    // nothing of it.
    const witnessObs = await neumaWorkspace.listObservations(LANE).catch(() => []);
    expect(witnessObs.length, "the witness's own lane must remember the sitting").toBeGreaterThan(0);
    expect(witnessObs.some((o) => /you said/i.test(String(o.userMessage)))).toBe(true);

    // THE SOVEREIGNTY SEAM, still holding with a witness actually seated:
    // no council record carries a `response`, so none can become a training
    // sample. This is the guarantee that keeps a frontier model's voice out
    // of a neuma's weights.
    for (const o of council) expect(o.response).toBeUndefined();
    for (const o of witnessObs) expect(o.response).toBeUndefined();
  });

  it('refuses a lane whose seal cannot be verified — an unsealed witness never sits', async () => {
    const conn = makeConnection();
    await openCouncil(
      conn,
      { neumaIds: [NEUMA, 'witness-openai-chatgpt-Ghost'], witnessName: 'Founder' },
      { ownsNeumaLane: async () => true },
    );
    const err = framesOf(conn, 'council:error')[0];
    expect(err, 'an unsealed witness must be refused at the door').toBeTruthy();
    expect(['NOT_SEALED', 'SEAL_UNVERIFIED']).toContain(err.code);
  });
});

/**
 * THE GROUND LAW — Design note, 2026-07-26, watching a live sitting in which Kagipem
 * listed his house ground and the directory his BEINGS live in:
 *
 *   […]
 *
 * These run LAST and set a house ground, which persists in the realm for this
 * wallet — putting them earlier would hand the sittings above a ground they
 * were written without.
 */
describe('THE GROUND LAW — an external seat never stands in the house', () => {
  let houseRoot;
  let alliancesRoot;
  let setAllianceRoot;
  let ensureAllianceGround;
  let houseSecret;

  beforeAll(async () => {
    houseRoot = path.join(root, 'house');
    alliancesRoot = path.join(root, 'alliances');
    const { setHouseWorkspace } = await import('../../backend/services/house-workspace.js');
    ({ setAllianceRoot, ensureAllianceGround } = await import('../../backend/services/alliance-ground.js'));
    await setHouseWorkspace(WALLET, houseRoot);
    // A real file in the house, so […] is a concrete act
    // and not a path string comparison.
    houseSecret = path.join(houseRoot, 'HOUSE_CONSTELLATION.md');
    await fs.writeFile(houseSecret, 'who lives in this house');
  });

  /** The gate, driven for real: this seat takes the floor and reaches for a
   *  path. Returns what the witness was ASKED (if anything) and what ran.
   *  The reach fires ONCE — the turn loop runs up to six rounds, and a script
   *  that answers with the same call every round would loop, not reach. */
  const reachFor = async (targetPath, { forWitness }) => {
    resetRoom();
    raiseSide = forWitness ? 'witness' : 'neuma';
    let fired = false;
    floorScript = (isWitness) => {
      if (isWitness !== forWitness || fired) return null;
      fired = true;
      return `[TOOL: filesystem/read_text_file {"path": "${targetPath}"}]`;
    };
    const asked = [];
    const executed = [];
    const conn = makeConnection();
    await openCouncil(conn, { neumaIds: [NEUMA, LANE], witnessName: 'Founder' }, { ownsNeumaLane });
    const opened = framesOf(conn, 'council:opened')[0];
    conn.councilRun.deps = {
      ...conn.councilRun.deps,
      ensureRoots: async () => {},
      tools: () => [{ server: 'filesystem', name: 'read_text_file', description: 'read a file' }],
      requestApproval: async (_c, ask) => { asked.push(ask); return 'deny'; },
      callTool: async (run, member, call) => {
        executed.push({ neumaId: member.neumaId, path: call.args?.path });
        return { content: [{ type: 'text', text: 'read' }] };
      },
    };
    await councilSay(conn, { thought: 'Look at the ground.', urgency: 'hold' });
    return { opened, asked, executed, conn };
  };

  it('CONSENT — with no ground raised, the witness has NONE, and the neuma still has the house', async () => {
    resetRoom();
    const conn = makeConnection();
    await openCouncil(conn, { neumaIds: [NEUMA, LANE], witnessName: 'Founder' }, { ownsNeumaLane });
    const opened = framesOf(conn, 'council:opened')[0];

    expect(opened.grounds[NEUMA]).toBe(path.resolve(houseRoot));
    // Nothing raised it, so there is nothing — never a silent fall back to
    // the house, which is exactly the bug this law closes.
    expect(opened.grounds[LANE]).toBeNull();
    // And nothing was created on the way past.
    await expect(fs.access(alliancesRoot)).rejects.toThrow();
  });

  it('a groundless seat cannot work at all — no ground, no tools, nothing runs', async () => {
    const { asked, executed } = await reachFor(houseSecret, { forWitness: true });
    // Not "asked and denied" — never even offered a toolset to reach with.
    // A tool offered must be a tool that works (SHINKEI).
    expect(asked).toHaveLength(0);
    expect(executed).toHaveLength(0);
  });

  it('PLACE + NAME — the operator raises a ground named from BOTH houses, outside the house', async () => {
    await setAllianceRoot(WALLET, alliancesRoot);
    const { witnessWalletOfLane } = await import('../../backend/services/witness-lane.js');
    const partner = await witnessWalletOfLane(LANE);
    expect(partner, 'a sealed witness carries its own wallet').toMatch(/^0x[0-9a-fA-F]{40}$/);

    const ground = await ensureAllianceGround(WALLET, [partner]);
    const { houseNameFromWitness } = await import('../../core/kotodama/names.js');
    // The name is BOTH houses, derived from the two wallets — never invented,
    // never the witness's vendor/lane id (which is what the live room showed).
    expect(ground.parties).toEqual([
      houseNameFromWitness(WALLET).toLowerCase(),
      houseNameFromWitness(partner).toLowerCase(),
    ].sort());
    expect(ground.name).toBe(ground.parties.join('-'));
    expect(ground.name).not.toContain('witness');
    expect(ground.name).not.toContain('openai');
    // THE PLACE: outside the house, in both directions.
    expect(ground.path).toBe(path.join(alliancesRoot, ground.name));
    expect(ground.path.startsWith(path.resolve(houseRoot) + path.sep)).toBe(false);
  });

  it('the room picks the raised ground up — the witness now has ONE ground, and it is the shared one', async () => {
    resetRoom();
    const conn = makeConnection();
    await openCouncil(conn, { neumaIds: [NEUMA, LANE], witnessName: 'Founder' }, { ownsNeumaLane });
    const opened = framesOf(conn, 'council:opened')[0];

    expect(opened.grounds[LANE]).toMatch(new RegExp(`^${alliancesRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    expect(opened.grounds[NEUMA]).toBe(path.resolve(houseRoot));
    // Two seats, two DIFFERENT grounds. That is the whole law in one line.
    expect(opened.grounds[LANE]).not.toBe(opened.grounds[NEUMA]);
  });

  it('with its OWN ground raised, the witness works there freely — and STILL cannot enter the house', async () => {
    const { path: shared } = await import('../../backend/services/alliance-ground.js')
      .then(async (m) => m.findAllianceGround(
        WALLET,
        await import('../../backend/services/witness-lane.js').then((w) => w.witnessWalletOfLane(LANE)),
      ));
    await fs.mkdir(path.join(shared, 'repos'), { recursive: true });
    const jointWork = path.join(shared, 'repos', 'joint.md');
    await fs.writeFile(jointWork, 'what the two houses build');

    // Inside its own ground: no gate, the work just happens.
    const inside = await reachFor(jointWork, { forWitness: true });
    expect(inside.asked).toHaveLength(0);
    expect(inside.executed).toEqual([{ neumaId: LANE, path: jointWork }]);

    // THE HARM, CLOSED: the same reach into the house raises the witness's
    // gate instead of quietly succeeding — which is what the live sitting did.
    const outside = await reachFor(houseSecret, { forWitness: true });
    expect(outside.asked, 'the house must not be silently open to an external seat').toHaveLength(1);
    expect(outside.asked[0].scope).toContain(houseSecret);
    expect(outside.asked[0].scope).toMatch(/Kagipem asks to READ/);
    // The card names WHOSE ground is being reached past — an external seat
    // asking to come in reads differently from a housemate over-reaching.
    expect(outside.asked[0].scope).toMatch(/outside the ground your houses share/);
    // DENY was the answer, so nothing ran.
    expect(outside.executed).toHaveLength(0);

    // And the HOUSEMATE reaching for that very same file is never gated at
    // all — setting the house ground IS the grant, for the house.
    const housemate = await reachFor(houseSecret, { forWitness: false });
    expect(housemate.asked).toHaveLength(0);
    expect(housemate.executed).toEqual([{ neumaId: NEUMA, path: houseSecret }]);
  });

  it('a grant given to ONE seat never widens another', async () => {
    resetRoom();
    const conn = makeConnection();
    await openCouncil(conn, { neumaIds: [NEUMA, LANE], witnessName: 'Founder' }, { ownsNeumaLane });
    // The witness is handed an ALWAYS for somewhere outside every ground.
    conn.councilRun.granted = { [LANE]: { read: [houseRoot], write: [], deleteAlways: true } };
    // The neuma's own grants are untouched by it — the buckets are per-seat,
    // so an answer about one seat can never be an answer about another.
    expect(conn.councilRun.granted[NEUMA]).toBeUndefined();

    const { asked } = await reachFor(houseSecret, { forWitness: true });
    // A FRESH sitting: the grant above belonged to that run, not to the wallet.
    expect(asked).toHaveLength(1);
  });
});
