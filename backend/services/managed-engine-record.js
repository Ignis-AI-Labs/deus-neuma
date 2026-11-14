// managed-engine-record — which llama.cpp build the setup installed (managed-engine.js), read by the
// supervisor's launch (supervisor-launch-config.js): with no LLAMA_SERVER_BIN set, the supervised
// server runs the installed engine. A machine set up by hand keeps its own binary, because
// LLAMA_SERVER_BIN wins.
//
// The binary is never the path the record names: it is rebuilt from the home, a build tag and a
// CUDA variant, each checked for shape, the same rule the Ollama boot follows (re-audit
// 2026-10-29, NEW-H1). impure (fs).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDataRoot } from './data-root.js';

const BUILD = /^b\d{3,7}$/;
const VARIANT = /^cuda-\d{2}\.\d$/;

/** The record's path, read at call time (packaged vs dev data roots). impure */
export const engineRecordPath = () => path.join(getDataRoot(), 'model-server', 'engine.json');

/** What the setup installed ({build, variant, home, model, installedAt}), or null. impure */
export const readEngineRecord = () => {
  try { return JSON.parse(fs.readFileSync(engineRecordPath(), 'utf8')); } catch { return null; }
};

/** Where one build of the engine lives under a home. Pure. */
export const engineDirFor = (home, build, variant) => path.join(home, 'llama.cpp', `${build}-${variant}`);

/** The folder the setup keeps its GGUF models in, under a home. Pure. */
export const ggufDirFor = (home) => path.join(home, 'gguf');

/**
 * The installed engine's llama-server, by its real path (the supervisor refuses an executable
 * reached through a link, serving-process-owner.js), or null when the setup installed none or its
 * folder is gone. impure (fs)
 */
export const managedEngineBin = () => {
  const r = readEngineRecord();
  if (!r || typeof r.home !== 'string' || !path.isAbsolute(r.home) || !BUILD.test(r.build) || !VARIANT.test(r.variant)) return null;
  const bin = path.join(engineDirFor(path.resolve(r.home), r.build, r.variant), 'llama-server');
  try { return fs.realpathSync(bin); } catch { return null; }
};

/** Write the record whole (tmp + rename), its folder made first. impure */
export const writeEngineRecord = async (record) => {
  const file = engineRecordPath();
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(record, null, 2));
  await fsp.rename(tmp, file);
};
