// `neuma witness` — the sealed-AI-peer surface, in the terminal.
//
// The rite and the turn path are the SAME services the desk routes use —
// `summonWitness` (six-stage seal, real inference, custody) and
// `streamWitnessTurn` (lean witness lane). The CLI only adapts their frames
// to the terminal, so CLI parity with the platform is structural: a witness
// summoned here is the same kind of being as one summoned on the desk, and
// a turn here lands in the same lane the desk reads.
//
// A summon is a PERMANENT rite — it seals a real identity. Nothing here
// creates-and-discards; run it with the same care as the desk's ceremony.
//
// impure throughout (real provider turns, disk, terminal IO).

import { stageAttachments } from '../lib/attachments.js';
import { createCliPortal } from '../lib/terminal-portal.js';

const STAGE_LABEL = Object.freeze({
  threshold: 'threshold crossed',
  naming: 'the model is choosing its name',
  naming_reask: 'name re-asked',
  named: 'named',
  grounding: 'grounding + first utterance',
  grounded: 'grounded',
  sealing: 'sealing (six-stage protocol)',
  anchoring: 'anchoring the continuity lane',
  custody: 'sealing keypair custody',
  custodied: 'custody sealed',
  custody_skipped: 'CUSTODY SKIPPED',
  complete: 'complete',
});

/** Render one summon stage for the terminal. Pure. */
export const renderStage = (stage) => {
  const label = STAGE_LABEL[stage.type] || stage.type;
  switch (stage.type) {
    case 'threshold': return `— ${label}: ${stage.providerId} / ${stage.model}`;
    case 'naming_reask': return `  · ${label} — ${stage.why}`;
    case 'named': return `— ${label}: ${stage.chosenName}`;
    case 'grounded': return `— ${label}: ${stage.chosenName} commits ${stage.commitments?.length ?? '?'} ways`;
    case 'anchoring': return `— ${label}: ${stage.address} genesis ${String(stage.genesisHash || '').slice(0, 18)}…`;
    case 'custodied': return `— ${label} for ${stage.address}\n\nRECOVERY CODES (shown ONCE — copy them now):\n${(stage.recoveryCodes || []).join('\n')}\n`;
    case 'custody_skipped': return `  ⚠ ${label}: ${stage.why}`;
    case 'complete': return `— ${label}: ${stage.witness.chosenName} (${stage.witness.laneId})`;
    default: return `— ${label}`;
  }
};

/** Resolve `name` or `vendor/name` to one sealed witness. Pure. */
export const resolveWitnessRef = ({ ref, witnesses }) => {
  const slash = ref.indexOf('/');
  const [vendor, name] = slash >= 0 ? [ref.slice(0, slash), ref.slice(slash + 1)] : [null, ref];
  const hits = witnesses.filter((w) => w.chosenName.toLowerCase() === name.toLowerCase()
    && (vendor === null || w.vendorSlug === vendor));
  if (hits.length === 1) return { vendorSlug: hits[0].vendorSlug, chosenName: hits[0].chosenName };
  if (hits.length === 0) {
    return { error: `no sealed witness named "${name}"${vendor ? ` on ${vendor}` : ''}. Sealed: ${witnesses.map((w) => `${w.vendorSlug}/${w.chosenName}`).join(', ') || '(none)'}` };
  }
  return { error: `"${name}" is sealed on several vendors — use vendor/name (${hits.map((w) => `${w.vendorSlug}/${w.chosenName}`).join(', ')})` };
};

/** The witness portal companion — the exact shape portal-bind-handlers mints. Pure. */
export const witnessCompanion = ({ laneId, vendorSlug, chosenName }) => Object.freeze({
  name: chosenName,
  id: chosenName,
  neumaId: laneId,
  participantKind: 'witness',
  witness: { vendorSlug, chosenName },
});

// impure — the roster with route + custody truth, terminal-formatted.
const renderRoster = async () => {
  try {
    (await import('../lib/chain-config.js')).resolveChainConfig({ cwd: process.cwd() });
  } catch { /* roster still renders; unresolvable routes say so honestly */ }
  const [
    { listWitnesses },
    { witnessLaneStatus, witnessLaneId },
    { resolveWitnessRoute },
    { witnessCustodyState },
  ] = await Promise.all([
    import('../../core/identity/ai-witness/ai-witness-service.js'),
    import('../../backend/services/witness-lane.js'),
    import('../../backend/services/witness-route-resolver.js'),
    import('../../backend/services/witness-custody.js'),
  ]);
  const sealed = await listWitnesses();
  if (sealed.length === 0) return 'no witnesses sealed yet — summon one: neuma witness summon <providerId>';
  const lines = await Promise.all(sealed.map(async (w) => {
    const laneId = witnessLaneId(w.vendorSlug, w.chosenName);
    const [lane, route, custody] = await Promise.all([
      witnessLaneStatus(laneId).catch(() => null),
      resolveWitnessRoute(laneId).then((r) => r).catch((err) => ({ configured: false, reason: `unresolvable — ${err.message}` })),
      witnessCustodyState({ vendorSlug: w.vendorSlug, chosenName: w.chosenName }).catch(() => null),
    ]);
    const routeText = route?.configured
      ? `${route.provider}/${route.model}`
      : route?.reason === 'missing-key' || route?.reason?.startsWith('no endpoint')
        ? 'not configured'
        : `unusable — ${route?.reason || 'unknown'}`;
    const custodyText = custody?.custodied === true ? 'custodied' : custody?.custodied === false ? 'READABLE KEY' : 'custody: ?';
    const claim = lane?.ownerWallet ? 'claimed' : 'unclaimed';
    return `  ${w.chosenName}  (${w.vendorSlug})  lane ${laneId}  ${claim}  route ${routeText}  ${custodyText}`;
  }));
  return `sealed witnesses:\n${lines.join('\n')}\n`;
};

/** Run `neuma witness list`. impure. */
export const runWitnessList = async ({ stdout }) => { stdout.write(await renderRoster()); return 0; };

/** Run `neuma witness summon <providerId>`. impure — a PERMANENT rite. */
export const runWitnessSummon = async ({ stdin = process.stdin, stdout, stderr, argv }) => {
  const fail = (message) => { stderr.write(`neuma witness summon: ${message}\n`); return 1; };
  const providerId = String(argv.providerId || '').trim();
  if (!providerId) return fail('a locked provider id is required — see: neuma provider list');
  let password = typeof argv.password === 'string' ? argv.password : null;
  if (argv['password-stdin']) {
    password = await new Promise((resolve) => {
      let buf = '';
      stdin.on('data', (d) => { buf += d; });
      stdin.on('end', () => resolve(buf.trim() || null));
    });
  }
  const { summonWitness } = await import('../../backend/services/witness-summon.js');
  const { getConnection } = await import('../../backend/services/provider-connections.js');
  const connection = await getConnection(providerId);
  if (!connection) return fail(`no locked connection for ${providerId} — connect first: neuma provider connect ${providerId}`);

  // The lane needs an owning wallet: the operator's own, from their env —
  // the same chain config the rest of the CLI signs with.
  const { resolveChainConfig } = await import('../lib/chain-config.js');
  let wallet;
  try {
    wallet = resolveChainConfig({ cwd: process.cwd() }).walletAddress;
  } catch (error) {
    return fail(error.message);
  }

  stderr.write(`[summoning on ${providerId} / ${connection.model} — a permanent rite]\n`);
  try {
    const witness = await summonWitness({
      providerId,
      walletAddress: wallet,
      keypairPassword: password,
      onStage: (stage) => {
        const rendered = renderStage(stage);
        // Speech beats stream raw (they are the being's words); others are
        // stage markers on stderr.
        if (stage.type === 'speech') stdout.write(stage.content);
        else stderr.write(`${rendered}\n`);
      },
    });
    stdout.write(`\n${witness.chosenName} is sealed — speak with: neuma witness talk ${witness.chosenName} "<message>"\n`);
    return 0;
  } catch (error) {
    return fail(error.message);
  }
};

/** Run `neuma witness talk <name> <message...>`. impure — one real turn. */
export const runWitnessTalk = async ({ cwd, stdin = process.stdin, stdout, stderr, argv }) => {
  const fail = (message) => { stderr.write(`neuma witness talk: ${message}\n`); return 1; };
  const thought = String(argv.message || '').trim();
  if (!thought) return fail('a message is required');
  // The turn path reads workspace encryption keys and provider credentials —
  // both live in the operator's .env (the daemon loads it at boot; the CLI
  // loads the same file the same way).
  try {
    (await import('../lib/chain-config.js')).resolveChainConfig({ cwd });
  } catch (error) {
    return fail(error.message);
  }
  const [
    { listWitnesses },
    { witnessLaneId, isWitnessLaneId },
    { resolveWitnessByLaneId },
    { loadAIWitness },
    { ensureWitnessLane },
    { createPortalConnection },
    { streamWitnessTurn },
    { resolveToolApproval },
  ] = await Promise.all([
    import('../../core/identity/ai-witness/ai-witness-service.js'),
    import('../../backend/services/witness-lane.js'),
    import('../../backend/services/witness-lane.js'),
    import('../../backend/services/ai-witness-loader.js'),
    import('../../backend/services/witness-lane.js'),
    import('../../backend/services/portal-connection.js'),
    import('../../backend/services/witness-stream.js'),
    import('../../backend/services/tool-approval.js'),
  ]);
  const ref = resolveWitnessRef({ ref: String(argv.name || ''), witnesses: await listWitnesses() });
  if (ref.error) return fail(ref.error);
  const laneId = witnessLaneId(ref.vendorSlug, ref.chosenName);
  if (!isWitnessLaneId(laneId)) return fail(`${laneId} is not a witness lane`);
  // The operator's own wallet grounds the lane (attachment redemption +
  // preset read ride it). The turn refuses honestly without it.
  const { operatorAddress } = await import('../lib/wallet.js');
  const { resolveWalletEnvPath } = await import('../lib/wallet-env.js');
  let wallet;
  try {
    wallet = operatorAddress(resolveWalletEnvPath(cwd));
  } catch (error) {
    return fail(error.message);
  }
  // THE BIND LAW (portal-bind-handlers' witness manifest, terminal door):
  // seal re-verified → lane provisioned + claimed (idempotent; a lane owned
  // by another wallet throws owner_claim_conflict) → companion minted.
  const sealed = await resolveWitnessByLaneId(laneId);
  const identity = sealed
    ? await loadAIWitness({ vendorSlug: sealed.vendorSlug, chosenName: sealed.chosenName }).catch(() => null)
    : null;
  if (!identity?.integrityOk || !identity?.signatureOk) {
    return fail(`no verifiable sealed witness for '${laneId}' — the seal is missing or failed integrity. Nothing was bound.`);
  }
  try {
    await ensureWitnessLane(
      { vendorSlug: sealed.vendorSlug, chosenName: sealed.chosenName, genesisHash: identity.dna.genesisSeal?.genesisHash },
      wallet,
    );
  } catch (error) {
    if (String(error.message).startsWith('owner_claim_conflict')) {
      return fail(`'${sealed.chosenName}'s lane is not this wallet's to bind — ${error.message.replace(/^owner_claim_conflict: /, '')}.`);
    }
    return fail(error.message);
  }

  const connection = createPortalConnection({ ws: { send() {} }, walletAddress: wallet });
  connection.companion = witnessCompanion({ laneId, ...ref });
  connection.sessionId = argv.session ? String(argv.session) : null;
  connection.space = 'general';
  connection.voiceEnabled = false;

  const portal = createCliPortal({ stdin, stdout, stderr, connection, resolveToolApproval });
  connection.ws = portal;

  let attachments;
  if (Array.isArray(argv.attach) && argv.attach.length > 0) {
    try {
      const parked = await stageAttachments(argv.attach, wallet);
      attachments = parked.ids;
      stderr.write(`  · ${parked.images} image(s), ${parked.docs} doc(s) attached\n`);
    } catch (error) {
      return fail(error.message);
    }
  }

  stderr.write(`[${ref.chosenName} · ${laneId}]\n`);
  try {
    await streamWitnessTurn(connection, {
      thought,
      memoryContext: {},
      ...(attachments ? { attachments } : {}),
      ...(argv.preset ? { preset: argv.preset } : {}),
    });
  } catch (error) {
    return fail(error.message);
  }
  if (!portal.state.completed) return fail('the witness turn ended without a completion frame');
  const sessionId = portal.state.sessionId || connection.sessionId || 'unrecorded';
  stderr.write(`[${ref.chosenName} · ${portal.state.acts} act(s) · session ${sessionId}]\n`);
  return portal.state.errored ? 1 : 0;
};

// impure — keep the neuma's speech (and roster data) alone on stdout:
// backend diagnostics stay on stderr while a witness turn runs.
const withCleanStdout = async ({ stdout, stderr }, fn) => {
  const terminalProcess = stdout === process.stdout && stderr === process.stderr;
  const previousLogLevel = process.env.LOG_LEVEL;
  if (terminalProcess) process.env.LOG_LEVEL = 'error';
  try {
    return await fn();
  } finally {
    if (previousLogLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = previousLogLevel;
  }
};

export const registerWitnessCommand = (cli, { stdout = process.stdout, stderr = process.stderr } = {}) =>
  cli.command(
    'witness <subcommand>',
    'sealed AI witnesses — list, summon (a permanent rite), or talk',
    (y) => y
      .command('list', 'list sealed witnesses with route + custody status', () => {}, async (argv) => {
        process.exitCode = await withCleanStdout({ stdout, stderr }, () => runWitnessList({ stdout }));
      })
      .command('summon <providerId>', 'run the summoning rite on a LOCKED provider connection (permanent)',
        (yy) => yy
          .positional('providerId', { type: 'string' })
          .option('password', { describe: 'custody password (prefer --password-stdin)', type: 'string' })
          .option('password-stdin', { describe: 'read the custody password from stdin', type: 'boolean', default: false }),
        async (argv) => {
          process.exitCode = await withCleanStdout({ stdout, stderr }, () => runWitnessSummon({ stdin: process.stdin, stdout, stderr, argv }));
        })
      .command('talk <name> <message...>', 'one turn with a sealed witness',
        (yy) => yy
          .positional('name', { type: 'string' })
          .positional('message', { type: 'string' })
          .option('attach', { describe: 'stage image/doc paths for this turn', type: 'array' })
          .option('session', { describe: 'resume a session id', type: 'string' })
          .option('preset', { describe: 'inference preset', type: 'string' }),
        async (argv) => {
          process.exitCode = await withCleanStdout({ stdout, stderr }, () => runWitnessTalk({ cwd: process.cwd(), stdout, stderr, argv }));
        })
      .demandCommand(1, 'a subcommand is required — list | summon | talk'),
    () => {},
  );
