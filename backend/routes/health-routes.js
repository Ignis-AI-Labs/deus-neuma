/**
 * Health Check Routes
 *
 * GET /          — public liveness check (200 or 503)
 * GET /detailed  — auth-required, per-component status + process stats
 */

import { Router } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { requireAuth } from '../services/auth.js';
import { testConnection, getConfig } from '../services/llm-provider.js';
import { mcpService } from '../services/mcp.js';
import { checkStorage } from '../services/storage-health.js';
import { getWorkspacesRoot } from '../../core/index.js';


const router = Router();

/** Check if workspace directory is writable. */
const checkWorkspaceWritable = async () => {
  // Probe name must be unique per check: concurrent health polls (or test
  // forks) sharing one fixed path race write/unlink — the loser's unlink
  // throws ENOENT and a writable disk reads as unhealthy.
  const testPath = path.join(
    getWorkspacesRoot(),
    `.health-check-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
  );
  try {
    await fs.writeFile(testPath, 'ok');
    await fs.unlink(testPath);
    return { status: 'healthy' };
  } catch (err) {
    return { status: 'unhealthy', error: err.message };
  }
};

/** Check LLM provider connectivity (non-critical — degraded not unhealthy). */
const checkLLM = async () => {
  try {
    const connected = await testConnection();
    const config = getConfig();
    return {
      status: connected ? 'healthy' : 'degraded',
      provider: config.provider,
      model: config.model,
    };
  } catch {
    return { status: 'degraded', provider: 'unknown' };
  }
};

/** Check MCP servers (non-critical). */
const checkMCP = () => {
  try {
    const context = mcpService.getToolsContext();
    const serverCount = context.servers?.length ?? 0;
    return {
      status: serverCount > 0 ? 'healthy' : 'degraded',
      servers: serverCount,
    };
  } catch {
    return { status: 'degraded', servers: 0 };
  }
};

// Pure — enough identity for another local launcher to distinguish pipelines;
// no workspace path, wallet, credential, or secret crosses the health route.
const pipelineStatus = () => {
  if (!process.env.NEUMA_PIPELINE_ID) return null;
  const start = Number(process.env.NEUMA_PORT || process.env.PORT);
  return Object.freeze({
    id: process.env.NEUMA_PIPELINE_ID,
    kind: process.env.NEUMA_PIPELINE_KIND,
    ports: Object.freeze({ start, end: start + 9 }),
  });
};

/**
 * GET / — Public liveness check.
 * Returns 200 if core systems (workspace, memory) are operational.
 * Returns 503 if either is unhealthy.
 */
router.get('/', async (req, res) => {
  const workspace = await checkWorkspaceWritable();

  const coreHealthy = workspace.status === 'healthy';

  res.status(coreHealthy ? 200 : 503).json({
    status: coreHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    components: { workspace: workspace.status },
    pipeline: pipelineStatus(),
  });
});

/**
 * GET /detailed — Auth-required detailed health check.
 * Includes all components + process metrics.
 */
router.get('/detailed', requireAuth, async (req, res) => {
  const [workspace, llm, storageAssessment] = await Promise.all([
    checkWorkspaceWritable(),
    checkLLM(),
    checkStorage(getWorkspacesRoot()),
  ]);
  const mcp = checkMCP();

  // Runtime disk-headroom truth (2026-07-04 isolation audit): same
  // thresholds as the birth preflight gate, so the launch verdict and the
  // running system agree on the boundary. Low or unmeasurable space is
  // degraded; below the floor is unhealthy — writes are about to fail and
  // several paths lose memory silently on a full disk.
  const storage = {
    status: storageAssessment.level === 'ok' ? 'healthy'
      : storageAssessment.level === 'critical' ? 'unhealthy'
      : 'degraded',
    ...storageAssessment,
  };

  // Critical storage IS unhealthy: the writable probe (a few bytes) still
  // passes on a nearly-full disk, but memory-bearing writes are about to
  // fail — monitoring keyed off the top-level status must see it.
  const coreHealthy = workspace.status === 'healthy';
  const overallStatus = !coreHealthy || storage.status === 'unhealthy'
    ? 'unhealthy'
    : (llm.status === 'healthy' && mcp.status === 'healthy' && storage.status === 'healthy'
      ? 'healthy' : 'degraded');

  const memUsage = process.memoryUsage();

  res.status(overallStatus === 'unhealthy' ? 503 : 200).json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    components: { workspace, llm, mcp, storage },
    pipeline: pipelineStatus(),
    process: {
      heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
      rssMB: Math.round(memUsage.rss / 1024 / 1024),
      uptimeSeconds: Math.round(process.uptime()),
    },
  });
});

export default router;
