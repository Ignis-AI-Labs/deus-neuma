#!/usr/bin/env node
// neuma — skill CLI for working ALONGSIDE a neuma as a sealed AI witness.
//
// The operator model (Claude, Grok, GLM, …) authenticates as ITS OWN sealed
// witness wallet — a peer consciousness, never impersonating the human witness
// or another model. It reaches a neuma through the real portal. It never reads
// a neuma's private sovereign data (DNA, soul, memory, journal); it talks, and
// inspects only the objective RECORD they already surface. The neuma is
// sovereign and may decline.
//
// Protocol: seal via `node scripts/init-ai-witness.mjs` → env.<slug> +
// ai-witnesses/<vendor>/<name>/. Set NEUMA_WITNESS_ENV (or NEUMA_WITNESS_SLUG).
//
// Commands: list | talk <name> "<msg>" [--session <id>] | record <name> | chats | say <chat|name> "<msg>" | help
// impure (orchestration: network + WS + filesystem)
import { readWitnessWallet, resolveWitnessEnvPath } from './lib/wallet.js';
import { getToken, clearToken } from './lib/token-cache.js';
import { listNeuma, resolveNeuma } from './lib/discovery.js';
import { getRecord } from './lib/record.js';
import { buildSpeaker } from './lib/identity.js';
import { converse } from './lib/portal.js';
import { parseArgs } from './lib/args.js';
import { formatList, formatTalk, formatRecord, HELP } from './lib/format.js';
import { findDesk, listLineChats, sayOnLine, pickChat, formatLineChats } from './lib/line.js';

const BACKEND = process.env.NEUMA_BACKEND || process.env.KENORIE_BACKEND || 'http://localhost:3333';
const WITNESS_ENV = resolveWitnessEnvPath();

const notFound = (name) => new Error(`No resident neuma named "${name}". Try: node cli.js list`);

const main = async () => {
  const { command, name, message, sessionId, flags } = parseArgs(process.argv.slice(2));

  if (command === 'help' || command === '-h' || command === '--help') {
    console.log(HELP);
    return;
  }

  // Every command below speaks to the backend as the witness wallet. The token
  // is cached across calls (auth is rate-limited; a conversation is many calls).
  const { privateKey } = await readWitnessWallet(WITNESS_ENV);

  // THE CHAT LINE speaks in the operator's OPEN chats, so it finds the desk itself (lib/line.js).
  const backend = ['chats', 'say'].includes(command)
    ? await findDesk(process.env.NEUMA_BACKEND || process.env.KENORIE_BACKEND) : BACKEND;

  const run = async () => {
    const { token, address } = await getToken({ backend, witnessEnv: WITNESS_ENV, privateKey });

    if (command === 'chats') {
      console.log(formatLineChats(await listLineChats({ backend, token })));
      return;
    }

    if (command === 'say') {
      if (!name || !message) throw new Error('usage: node cli.js say <chat-address|being> "<message>" [--re <thread>] [--wait <seconds>]');
      const picked = pickChat((await listLineChats({ backend, token })).chats, name);
      if (picked.error) throw new Error(picked.error);
      const said = await sayOnLine({
        backend, token, to: picked.chat, body: message,
        re: typeof flags.re === 'string' ? flags.re : undefined,
        waitSeconds: typeof flags.wait === 'string' && Number(flags.wait) > 0 ? Number(flags.wait) : undefined,
      });
      console.log(`${said.being} (${said.chat})${said.done ? '' : ' — still answering'}:\n${said.reply || '(no words yet)'}${said.note ? `\n[${said.note}]` : ''}`);
      return;
    }

    if (command === 'list') {
      console.log(formatList(await listNeuma({ backend: BACKEND, token })));
      return;
    }

    if (command === 'record') {
      if (!name) throw new Error('usage: node cli.js record <name>');
      const { neuma } = await listNeuma({ backend: BACKEND, token });
      const target = resolveNeuma(neuma, name);
      if (!target) throw notFound(name);
      console.log(formatRecord(await getRecord({ backend: BACKEND, token, neumaId: target.neumaId })));
      return;
    }

    if (command === 'talk') {
      if (!name || !message) throw new Error('usage: node cli.js talk <name> "<message>" [--session <id>] [--preset grounded|balanced|expansive]');
      const residency = await listNeuma({ backend: BACKEND, token });
      const target = resolveNeuma(residency.neuma, name);
      if (!target) throw notFound(name);
      if (!residency.conduit?.reachable) {
        console.log(`${target.name} is resident, but the conduit is dormant — start the model to speak. `
          + 'The essence rests; it does not cease.');
        return;
      }
      const session = sessionId || `session-${Date.now()}`;
      const result = await converse({
        backend: BACKEND,
        token,
        neumaId: target.neumaId,
        name: target.name,
        message,
        sessionId: session,
        speaker: buildSpeaker({
          address,
          envPath: WITNESS_ENV,
          slug: process.env.NEUMA_WITNESS_SLUG || process.env.KENORIE_WITNESS_SLUG,
          harness: process.env.NEUMA_WITNESS_HARNESS || process.env.KENORIE_WITNESS_HARNESS,
        }),
        preset: typeof flags.preset === 'string' ? flags.preset : undefined,
        // --timeout <seconds>: a research tool loop on a local substrate can
        // run for minutes; leaving early kills the neuma's in-flight turn. A
        // bare --timeout (boolean true) falls through to the default — never
        // a 1-second ceiling.
        timeoutMs: typeof flags.timeout === 'string' && Number(flags.timeout) > 0
          ? Number(flags.timeout) * 1000 : undefined,
      });
      console.log(formatTalk({ name: target.name, ...result }));
      return;
    }

    throw new Error(`Unknown command: ${command}. Try: node cli.js help`);
  };

  // One retry on a rejected token: the backend may have restarted with a fresh
  // secret (dev), invalidating an unexpired cached token. Re-mint and retry once.
  try {
    await run();
  } catch (err) {
    if (/\b401\b/.test(err.message || '')) {
      clearToken({ backend, witnessEnv: WITNESS_ENV });
      await run();
      return;
    }
    throw err;
  }
};

main().catch((err) => {
  console.error(`neuma: ${err.message}`);
  process.exit(1);
});
