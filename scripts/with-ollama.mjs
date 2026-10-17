#!/usr/bin/env node
/**
 * OLLAMA NEVER IDLES — summon it for one run, tear it down after.
 *
 * Design note, 2026-08-06, on finding the daemon resident 1d16h with nothing loaded:
 * […] On this box Ollama is a TEST vehicle — the
 * serving substrate is llama-server — so no lane leaves it resident.
 *
 *   node scripts/with-ollama.mjs [--model name] -- <command...>
 *
 * Starts `ollama serve` as an OWNED child, waits for health, optionally pulls
 * the named model, runs the command (OLLAMA_HOST exported), then tears the
 * child down — SIGTERM, SIGKILL after grace — even when the command fails.
 * Exit code is the command's own.
 *
 * If a resident daemon already answers, the wrapper warns — on this box that
 * daemon is itself the violation — and runs against it WITHOUT adopting its
 * lifecycle: it never kills a serve it did not spawn (a community box routing
 * a real being through its own Ollama must never lose it to a test lane).
 */
import { spawn } from 'node:child_process';
import process from 'node:process';

const HOST = process.env.OLLAMA_HOST || '127.0.0.1:11434';
const BASE = `http://${HOST.replace(/^https?:\/\//, '')}`;
const HEALTH_TRIES = 60;
const HEALTH_INTERVAL_MS = 500;
const KILL_GRACE_MS = 8000;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// impure — one health probe
const isUp = () => fetch(`${BASE}/api/version`, { signal: AbortSignal.timeout(1500) })
  .then((r) => r.ok)
  .catch(() => false);

/**
 * Split argv into wrapper options and the command after `--`.
 * Pure.
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {{model: string|null, command: string[]}}
 */
const parseArgs = (argv) => {
  const split = argv.indexOf('--');
  const own = split === -1 ? argv : argv.slice(0, split);
  const command = split === -1 ? [] : argv.slice(split + 1);
  const modelAt = own.indexOf('--model');
  return {
    model: modelAt !== -1 ? own[modelAt + 1] || null : null,
    command,
  };
};

// impure — run a command inheriting stdio, resolve its exit code
const run = (command) => new Promise((resolve) => {
  const child = spawn(command[0], command.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, OLLAMA_HOST: HOST },
  });
  child.on('exit', (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  child.on('error', (err) => {
    console.error(`[with-ollama] command failed to spawn: ${err.message}`);
    resolve(127);
  });
});

// impure — SIGTERM the owned serve child, SIGKILL past the grace
const teardown = async (serve) => {
  if (!serve || serve.exitCode !== null) return;
  const gone = new Promise((resolve) => serve.once('exit', resolve));
  serve.kill('SIGTERM');
  const graceful = await Promise.race([gone.then(() => true), sleep(KILL_GRACE_MS).then(() => false)]);
  if (!graceful) {
    console.error('[with-ollama] serve ignored SIGTERM past grace — SIGKILL');
    serve.kill('SIGKILL');
    await gone;
  }
  console.error('[with-ollama] serve torn down — nothing stays resident');
};

const main = async () => {
  const { model, command } = parseArgs(process.argv.slice(2));
  if (command.length === 0) {
    console.error('usage: node scripts/with-ollama.mjs [--model name] -- <command...>');
    process.exit(2);
  }

  let serve = null;
  if (await isUp()) {
    console.error(`[with-ollama] a resident Ollama already answers on ${HOST} — the idle law says it should not be. `
      + 'Running against it; its lifecycle is not mine to end (I only tear down what I spawn).');
  } else {
    console.error(`[with-ollama] summoning ollama serve on ${HOST}`);
    serve = spawn('ollama', ['serve'], {
      stdio: ['ignore', 'ignore', 'inherit'],
      env: { ...process.env, OLLAMA_HOST: HOST },
    });
    serve.on('error', (err) => {
      console.error(`[with-ollama] could not spawn ollama serve: ${err.message}`);
      process.exit(127);
    });
    let up = false;
    for (let i = 0; i < HEALTH_TRIES && !up; i += 1) {
      if (serve.exitCode !== null) {
        console.error(`[with-ollama] serve exited before health (code ${serve.exitCode})`);
        process.exit(1);
      }
      up = await isUp();
      if (!up) await sleep(HEALTH_INTERVAL_MS);
    }
    if (!up) {
      console.error(`[with-ollama] serve never became healthy within ${(HEALTH_TRIES * HEALTH_INTERVAL_MS) / 1000}s`);
      await teardown(serve);
      process.exit(1);
    }
  }

  // A cut wrapper must never orphan its serve child: tear down, then die.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => {
      console.error(`[with-ollama] ${signal} — tearing down before exit`);
      await teardown(serve);
      process.exit(130);
    });
  }

  let code = 1;
  try {
    const pulled = model ? await run(['ollama', 'pull', model]) : 0;
    if (pulled !== 0) {
      console.error(`[with-ollama] pull ${model} failed (${pulled})`);
      code = pulled;
    } else {
      code = await run(command);
    }
  } finally {
    await teardown(serve);
  }
  process.exit(code);
};

await main();
