'use strict';

/**
 * Collision-proof port leases for every live NEUMA pipeline.
 *
 * A pipeline is the nearest agent process in the launch ancestry, not a model
 * name. Two Kimi sessions therefore receive two different ten-port lanes. The
 * lease survives every child process and restart while that agent root lives.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { applyGpuPolicy } = require('./gpu-policy.cjs');
const REGISTRY_VERSION = 1;
const LANE_WIDTH = 10;
const LOCK_STALE_MS = 30_000;
const LOCK_ATTEMPTS = 200;
const LOCK_WAIT_MS = 10;
const PIPELINE_BLOCKS = Object.freeze({
  claude: Object.freeze({ start: 47400, end: 47499 }),
  grok: Object.freeze({ start: 47500, end: 47599 }),
  kimi: Object.freeze({ start: 47600, end: 47699 }),
  sol: Object.freeze({ start: 47700, end: 47799 }),
  agent: Object.freeze({ start: 47800, end: 47899 }),
});

const sleep = (milliseconds) => {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
};

const safeInteger = (value) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const validatePipelineId = (value) => {
  const id = String(value || '').trim();
  if (!/^[a-zA-Z0-9._:-]{1,160}$/.test(id)) throw new Error('NEUMA_PIPELINE_ID contains invalid characters');
  return id;
};

const processRecord = (pid, procRoot = '/proc') => {
  try {
    const directory = path.join(procRoot, String(pid));
    const command = fs.readFileSync(path.join(directory, 'cmdline'))
      .toString('utf8')
      .split('\0')
      .filter(Boolean);
    const stat = fs.readFileSync(path.join(directory, 'stat'), 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
    return Object.freeze({
      pid,
      parentPid: safeInteger(fields[1]),
      startTime: fields[19] || null,
      command: Object.freeze(command),
    });
  } catch {
    return null;
  }
};


const classifyAgent = (command) => {
  const executables = command.slice(0, 3).map((part) => path.basename(part).toLowerCase());
  const joined = command.join(' ').toLowerCase();
  if (executables.includes('kimi') || joined.includes('/kimi-code/')) return 'kimi';
  if (executables.includes('grok') || joined.includes('/grok-cli/')) return 'grok';
  if (executables.includes('claude') || joined.includes('/@anthropic-ai/claude-code/')) return 'claude';
  if (executables.includes('omp') || executables.includes('codex') || joined.includes('/oh-my-pi/')) return 'sol';
  if (executables.includes('opencode') || executables.includes('gemini')) return 'agent';
  return null;
};

const processIsAlive = (pid, startTime, procRoot = '/proc') => {
  const record = processRecord(pid, procRoot);
  if (record) return !startTime || record.startTime === String(startTime);
  if (procRoot !== '/proc') return false;
  try {
    process.kill(pid, 0);
    return !startTime;
  } catch {
    return false;
  }
};

/** Identify the live workstream that owns this process. Pure except /proc reads. */
const detectPipeline = (env = process.env, { pid = process.pid, procRoot = '/proc' } = {}) => {
  if (env.NEUMA_PIPELINE_MODE === 'operator' || env.NEUMA_PIPELINE_KIND === 'operator') return null;

  if (env.NEUMA_PIPELINE_ID) {
    const kind = String(env.NEUMA_PIPELINE_KIND || '').toLowerCase();
    if (!PIPELINE_BLOCKS[kind]) throw new Error(`Unknown NEUMA_PIPELINE_KIND: ${kind || '(empty)'}`);
    const ownerPid = safeInteger(env.NEUMA_PIPELINE_PID) ?? pid;
    const owner = processRecord(ownerPid, procRoot);
    return Object.freeze({
      id: validatePipelineId(env.NEUMA_PIPELINE_ID),
      kind,
      ownerPid,
      ownerStart: String(env.NEUMA_PIPELINE_START || owner?.startTime || ''),
    });
  }

  const visited = new Set();
  let cursor = pid;
  while (cursor > 1 && !visited.has(cursor)) {
    visited.add(cursor);
    const record = processRecord(cursor, procRoot);
    if (!record) break;
    const kind = classifyAgent(record.command);
    if (kind) {
      return Object.freeze({
        id: `${kind}:${record.pid}:${record.startTime || 'unknown'}`,
        kind,
        ownerPid: record.pid,
        ownerStart: String(record.startTime || ''),
      });
    }
    cursor = record.parentPid;
  }

  if (String(env.OMPCODE || '') === '1') return Object.freeze({ id: `sol:${pid}`, kind: 'sol', ownerPid: pid, ownerStart: '' });
  if (String(env.CLAUDECODE || '') === '1') return Object.freeze({ id: `claude:${pid}`, kind: 'claude', ownerPid: pid, ownerStart: '' });
  return null;
};

const laneStartForPort = (kind, port) => {
  const block = PIPELINE_BLOCKS[kind];
  if (!block || port < block.start || port > block.end || port % LANE_WIDTH !== 0) {
    throw new Error(`NEUMA_PORT=${port} is outside ${kind}'s ten-port lane starts (${block?.start}-${block?.end - 9})`);
  }
  return port;
};

const hashLaneOffset = (id, laneCount) => {
  const hash = crypto.createHash('sha256').update(id).digest();
  return hash.readUInt32BE(0) % laneCount;
};

const readRegistry = (file) => {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed.version !== REGISTRY_VERSION || !Array.isArray(parsed.claims)) throw new Error('unsupported schema');
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') return { version: REGISTRY_VERSION, claims: [] };
    throw new Error(`Port lease registry is unreadable (${file}): ${error.message}`);
  }
};

const writeRegistry = (file, registry) => {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
};

const lockRegistry = (directory) => {
  const lock = path.join(directory, 'leases.lock');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    try {
      fs.mkdirSync(lock, { mode: 0o700 });
      fs.writeFileSync(path.join(lock, 'owner'), String(process.pid), { mode: 0o600 });
      return lock;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) fs.rmSync(lock, { recursive: true, force: true });
      } catch (statError) {
        if (statError.code !== 'ENOENT') throw statError;
      }
      sleep(LOCK_WAIT_MS);
    }
  }
  throw new Error(`Timed out acquiring port lease registry lock: ${lock}`);
};

/** Persist one collision-free ten-port lane for this live pipeline. impure. */
const claimPipelineLane = (pipeline, {
  home = os.homedir(),
  procRoot = '/proc',
  requestedPort = null,
  now = () => new Date().toISOString(),
} = {}) => {
  const block = PIPELINE_BLOCKS[pipeline.kind];
  const laneCount = (block.end - block.start + 1) / LANE_WIDTH;
  const requestedStart = requestedPort === null ? null : laneStartForPort(pipeline.kind, requestedPort);
  const directory = path.join(home, '.neuma', 'ports');
  const file = path.join(directory, 'leases.json');
  const lock = lockRegistry(directory);

  try {
    const registry = readRegistry(file);
    const liveClaims = registry.claims.filter((claim) => processIsAlive(claim.ownerPid, claim.ownerStart, procRoot));
    const existing = liveClaims.find((claim) => claim.pipelineId === pipeline.id);
    if (existing) {
      if (requestedStart !== null && existing.start !== requestedStart) {
        throw new Error(`Pipeline ${pipeline.id} already owns ${existing.start}-${existing.end}, not ${requestedStart}`);
      }
      if (liveClaims.length !== registry.claims.length) writeRegistry(file, { version: REGISTRY_VERSION, claims: liveClaims });
      return Object.freeze(existing);
    }

    const occupied = new Set(liveClaims.filter((claim) => claim.kind === pipeline.kind).map((claim) => claim.start));
    const firstOffset = requestedStart === null ? hashLaneOffset(pipeline.id, laneCount) : (requestedStart - block.start) / LANE_WIDTH;
    let start = null;
    for (let step = 0; step < laneCount; step += 1) {
      const candidate = block.start + (((firstOffset + step) % laneCount) * LANE_WIDTH);
      if (!occupied.has(candidate)) {
        start = candidate;
        break;
      }
      if (requestedStart !== null) break;
    }
    if (start === null) throw new Error(`No free ${pipeline.kind} pipeline lane in ${block.start}-${block.end}`);

    const claim = Object.freeze({
      pipelineId: pipeline.id,
      kind: pipeline.kind,
      ownerPid: pipeline.ownerPid,
      ownerStart: pipeline.ownerStart,
      start,
      end: start + LANE_WIDTH - 1,
      claimedAt: now(),
    });
    writeRegistry(file, { version: REGISTRY_VERSION, claims: [...liveClaims, claim] });
    return claim;
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
};

const pipelineRoot = (home, pipelineId) => {
  const digest = crypto.createHash('sha256').update(pipelineId).digest('hex').slice(0, 16);
  return path.join(home, '.neuma', 'pipelines', digest);
};

/** Resolve the ports and data roots every child in one pipeline must inherit. impure. */
const resolvePipelineEnvironment = (env = process.env, options = {}) => {
  const pipeline = detectPipeline(env, options);
  if (!pipeline) return Object.freeze({ pipeline: null, environment: Object.freeze({}) });

  const requestedPort = env.NEUMA_PORT === undefined ? null : safeInteger(env.NEUMA_PORT);
  if (env.NEUMA_PORT !== undefined && requestedPort === null) throw new Error('NEUMA_PORT must be a non-negative integer');
  const claim = claimPipelineLane(pipeline, { ...options, requestedPort });
  const home = options.home || os.homedir();
  const root = pipelineRoot(home, pipeline.id);
  const backendPort = claim.start;
  const environment = Object.freeze({
    NEUMA_PIPELINE_ID: pipeline.id,
    NEUMA_PIPELINE_KIND: pipeline.kind,
    NEUMA_PIPELINE_PID: String(pipeline.ownerPid),
    NEUMA_PIPELINE_START: pipeline.ownerStart,
    NEUMA_PORT: String(backendPort),
    PORT: String(backendPort),
    FRONTEND_PORT: String(backendPort + 1),
    NEUMA_DEBUG_PORT: String(backendPort + 2),
    NEUMA_ROOT_LOCK_PATH: path.join(root, 'root-lock.json'),
    NEUMA_DATA_ROOT: path.join(root, 'data'),
    NEUMA_REALM_ROOT: path.join(root, 'realm'),
    NEUMA_VAULT_ROOT: path.join(root, 'vault'),
    NEUMA_SECRETS_FILE: path.join(root, 'secrets.json'),
    NEUMA_BACKUPS_ROOT: path.join(root, 'backups'),
    WORKSPACES_ROOT: path.join(root, 'workspaces'),
    WITNESSES_ROOT: path.join(root, 'witnesses'),
    AI_WITNESSES_ROOT: path.join(root, 'ai-witnesses'),
    PLATFORM_DB_PATH: path.join(root, 'platform', 'platform.db'),
  });
  return Object.freeze({ pipeline: Object.freeze({ ...pipeline, ...claim, root }), environment });
};

/** Apply one detected pipeline before Electron opens userData-backed services. impure. */
const applyElectronPipeline = (app, env = process.env, options = {}) => {
  // Before ready: compositor must sit on the NVIDIA render node, not the
  // Intel iGPU whose tile budget Chromium already exhausted on this box.
  applyGpuPolicy(app);
  const assignment = resolvePipelineEnvironment(env, options);
  if (assignment.pipeline) {
    Object.assign(env, assignment.environment);
    app.setPath('userData', path.join(assignment.pipeline.root, 'electron'));
  }
  return assignment;
};
/** Wait for the real backend child to report its kernel-bound port over IPC. impure. */
const waitForBackendPort = (child, timeoutMs = 30_000) => new Promise((resolve, reject) => {
  let settled = false;
  const finish = (done, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    child.removeListener('message', receive);
    done(value);
  };
  const receive = (message) => {
    if (message?.type === 'neuma:backend-ready' && Number.isInteger(message.port) && message.port > 0) {
      finish(resolve, message.port);
    }
  };
  const timer = setTimeout(() => finish(reject, new Error('backend did not report its listening port')), timeoutMs);
  child.on('message', receive);
  child.once('error', (error) => finish(reject, error));
  child.once('exit', (code) => finish(reject, new Error(`backend exited before ready (${code})`)));
});


module.exports = Object.freeze({
  applyElectronPipeline,
  LANE_WIDTH,
  PIPELINE_BLOCKS,
  classifyAgent,
  claimPipelineLane,
  detectPipeline,
  processIsAlive,
  resolvePipelineEnvironment,
  waitForBackendPort,
});
