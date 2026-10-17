// `neuma talk <message>` — send one message to the active being over the
// portal, print the reply. Stdout = reply text only (Unix-friendly: pipe-
// to-grep / pipe-to-jq composes). Any metadata (session id, emotion,
// tools used) goes to stderr so it never corrupts the reply stream.
//
// Being resolution:
//   --being <name-or-id>  (explicit override, highest priority)
//   else cli/lib/active-being.resolveActiveBeing (env → file → auto-single → throw)
//
// Connection chain (C-02 ports):
//   1. readOperatorWallet(NEUMA_WALLET_ENV or <repo>/.env) → private key
//   2. getToken(backend, walletEnv, privateKey) → session token (cached)
//   3. listNeuma(backend, token) → residency snapshot
//   4. resolveNeuma(snapshot.neuma, beingNameOrId) → target being record
//   5. converse(backend, token, neumaId, name, message, sessionId, speaker, preset)
//      → { reply, emotion, intensity, tools, sessionId }
//
// 401 retry: if the cached token is rejected (server restarted with fresh
// secret), clearToken + re-mint + re-run once. Matches the skill CLI's
// 401-retry pattern.
//
// impure (network + signing + fs)

import { findProjectRoot } from '../lib/project-root.js';
import { resolveActiveBeing } from '../lib/active-being.js';
import { readOperatorWallet } from '../lib/wallet.js';
import { resolveWalletEnvPath } from '../lib/wallet-env.js';
import { getToken, clearToken } from '../lib/token-cache.js';
import { listNeuma, resolveNeuma } from '../lib/discovery.js';
import { buildSpeaker, resolveOperatorName } from '../lib/identity.js';
import { converse } from '../lib/portal.js';

const DEFAULT_BACKEND = 'http://localhost:3333';

// impure (delegates to resolveActiveBeing which reads env + .neuma/active)
// Pick the being name-or-id from --being or fall through to the active-being
// mechanism. residentBeings comes from the caller's already-fetched snapshot
// so we don't double-fetch.
const pickBeingNameOrId = ({ argv, projectRoot, residentBeings }) => {
  if (argv.being) return argv.being.trim();
  return resolveActiveBeing({ projectRoot, residentBeings });
};

const runTalk = async ({ cwd, stdout, stderr, argv }) => {
  if (!argv.message || !argv.message.trim()) {
    stderr.write('neuma talk: a message is required\n');
    process.exit(1);
  }

  const backend = argv.backend || DEFAULT_BACKEND;
  const walletEnv = resolveWalletEnvPath(cwd);
  const projectRoot = findProjectRoot(cwd);

  let privateKey;
  try {
    ({ privateKey } = readOperatorWallet(walletEnv));
  } catch (err) {
    stderr.write(`neuma talk: ${err.message}\n`);
    process.exit(1);
  }

  const runWithToken = async () => {
    const { token, address } = await getToken({ backend, walletEnv, privateKey });
    // Fetch residency ONCE — used for both being resolution + target lookup.
    // If listNeuma throws (401, timeout, etc), the error propagates to the
    // outer catch so the 401-retry can fire.
    const snapshot = await listNeuma({ backend, token });
    const residentBeings = Array.isArray(snapshot.neuma) ? snapshot.neuma : [];

    const beingNameOrId = pickBeingNameOrId({ argv, projectRoot, residentBeings });

    const target = resolveNeuma(residentBeings, beingNameOrId);
    if (!target) {
      stderr.write(
        `neuma talk: no resident being matches "${beingNameOrId}". `
        + `Resident: ${residentBeings.map((b) => b.name || b.neumaId).join(', ') || '(none)'}\n`,
      );
      process.exit(1);
    }

    if (snapshot.conduit && snapshot.conduit.reachable === false) {
      stderr.write(
        `neuma talk: ${target.name} is resident but the conduit is dormant. `
        + 'Start the model to speak — the essence rests, it does not cease.\n',
      );
      process.exit(1);
    }

    const sessionId = argv.session || `cli-${Date.now()}`;
    const speaker = buildSpeaker({ address, name: resolveOperatorName() });

    const result = await converse({
      backend,
      token,
      neumaId: target.neumaId,
      name: target.name,
      message: argv.message,
      sessionId,
      speaker,
      preset: argv.preset,
    });

    // Stdout = reply text only (pipe-friendly). Stderr = metadata.
    stdout.write(result.reply + '\n');
    const meta = [`session=${result.sessionId}`];
    if (result.emotion) meta.push(`emotion=${result.emotion}`);
    if (result.intensity) meta.push(`intensity=${result.intensity}`);
    if (result.tools && result.tools.length > 0) {
      meta.push(`tools=${result.tools.length}`);
    }
    stderr.write(`[${target.name} · ${meta.join(' · ')}]\n`);
  };

  try {
    await runWithToken();
  } catch (err) {
    // 401 detection currently keys on the substring "401" because the
    // upstream auth/portal error messages embed status codes that way.
    // T-01 follow-up: prefer a typed error (err.status === 401) once the
    // backend test fixture is stood up so the lib layer can throw it.
    if (/\b401\b/.test(err.message || '')) {
      clearToken({ backend, walletEnv });
      try {
        await runWithToken();
        return;
      } catch (err2) {
        stderr.write(`neuma talk: ${err2.message}\n`);
        process.exit(1);
      }
    }
    stderr.write(`neuma talk: ${err.message}\n`);
    process.exit(1);
  }
};

export const registerTalkCommand = (cli, { stdout = process.stdout, stderr = process.stderr } = {}) =>
  cli.command(
    'talk <message>',
    'send one message to the active being and print the reply',
    (y) => y
      .positional('message', {
        describe: 'the message to send',
        type: 'string',
      })
      .option('being', {
        describe: 'override the active being for this call (name or id)',
        type: 'string',
      })
      .option('session', {
        describe: 'resume an existing thread by session id',
        type: 'string',
      })
      .option('preset', {
        describe: 'llm preset',
        choices: ['grounded', 'balanced', 'expansive'],
      })
      .option('backend', {
        describe: 'backend origin (default http://localhost:3333)',
        type: 'string',
      }),
    async (argv) => {
      await runTalk({ cwd: process.cwd(), stdout, stderr, argv });
    },
  );
