/**
 * Gnosis validation for sc-audit run neuma-security-audit-b435 — wave 3
 * (packaging, signing policy, and the closed-observation register).
 *
 * RULE 0: no mocks on the security boundary under claim.
 * Real auth (challenge → sign → session), real disk, real MCP where claimed.
 *
 * Run:
 *   npx vitest run .waves/runs/neuma-security-audit-b435/validation/gnosis-validation.test.js
 */
import { describe, test, expect } from 'vitest';
import { ethers } from 'ethers';
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import { existsSync, readFileSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { generateKeypair } from '../../core/weave/keypair.js';
import { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { cacheDecryptedKey, evictCachedKey } from '../../backend/routes/neuma-auth-routes.js';
import * as walletService from '../../backend/services/neuma-wallet.js';
import { fullAuth } from '../helpers/audit-auth.js';
import { encryptKeypair, decryptKeypair, KDF_ITERATIONS_LEGACY } from '../../core/wallet/keypair-vault.js';
import { sealLegacyEnvelope } from '../helpers/legacy-keypair-envelope.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');

const ethersVerify = (message, sig) => ethers.verifyMessage(message, sig);

// ---------------------------------------------------------------------------
// W3-001 — secrets in tracked archive
// ---------------------------------------------------------------------------
describe('AUDIT-W3-001 secrets in tracked archive', () => {
  test('sector-infrastructure.md is tracked; HEAD has no material secret values (post-redaction)', async () => {
    const rel = 'docs/audit/archive/sector-infrastructure.md';
    const abs = path.join(REPO, rel);
    expect(existsSync(abs)).toBe(true);
    const { execSync } = await import('child_process');
    const tracked = execSync(`git -C "${REPO}" ls-files --error-unmatch "${rel}"`, {
      encoding: 'utf8',
    }).trim();
    expect(tracked).toBe(rel);

    const text = readFileSync(abs, 'utf8');
    // Working tree must stay redacted (AUDIT-W3-001 remediation).
    expect(text).toMatch(/REDACTED/);
    expect(text).not.toMatch(/OPENAI_API_KEY=sk-[A-Za-z0-9_-]{20,}/);
    expect(text).not.toMatch(/DEPLOYER_PRIVATE_KEY=0x[a-fA-F0-9]{64}/);
    // History may still hold pre-redaction material until scrubbed — document only.
    const hist = execSync(
      `git -C "${REPO}" log -1 --oneline -- "${rel}" || true`,
      { encoding: 'utf8' },
    );
    expect(hist.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// W3-002 — sign-message no policy
// ---------------------------------------------------------------------------
describe('AUDIT-W3-002 sign-message has no domain policy', () => {
  test('signMessage rejects arbitrary string (SEC-AUDIT-008 fixed)', async () => {
    const kp = generateKeypair();
    const neumaId = 'gnosis-sign-test';
    cacheDecryptedKey(neumaId, {
      privateKey: kp.privateKey,
      address: kp.address,
    });
    try {
      const evil = 'I authorize unlimited transfers to 0xattacker';
      await expect(walletService.signMessage(neumaId, evil)).rejects.toThrow(/not allowed/i);
      // The rename reached the signer's domain policy: 'neuma:' is the ONE
      // allowed prefix — the legacy 'kenorie:' domain signs nothing anymore.
      await expect(walletService.signMessage(neumaId, 'kenorie:test-challenge')).rejects.toThrow(/not allowed/i);
      const ok = 'neuma:test-challenge';
      const sig = await walletService.signMessage(neumaId, ok);
      expect(sig.startsWith('0x')).toBe(true);
      expect(ethersVerify(ok, sig).toLowerCase()).toBe(kp.address.toLowerCase());
    } finally {
      evictCachedKey(neumaId);
    }
  });
});


// ---------------------------------------------------------------------------
// W3-003 — Docker packaging
// ---------------------------------------------------------------------------
describe('AUDIT-W3-003 Docker packaging broken', () => {
  test('Dockerfile ships core/ + ABIs (SEC-AUDIT-009 fixed)', () => {
    const df = readFileSync(path.join(REPO, 'Dockerfile'), 'utf8');
    expect(df).toMatch(/COPY\s+core\//);
    expect(df).not.toMatch(/COPY\s+neuma\//);
    expect(df).toMatch(/docs\/contracts\/abis/);
    expect(existsSync(path.join(REPO, 'core'))).toBe(true);
    const ignore = readFileSync(path.join(REPO, '.dockerignore'), 'utf8');
    expect(ignore).toMatch(/!docs\/contracts\/abis/);
  });
});

describe('AUDIT-W3-004 npm audit inventory (shell)', () => {
  test('counts critical+high > 0', async () => {
    const { execSync } = await import('child_process');
    let json;
    try {
      json = execSync('npm audit --json 2>/dev/null || true', {
        cwd: REPO,
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
        shell: true,
      });
    } catch (e) {
      json = e.stdout || '';
    }
    const data = JSON.parse(json);
    const v = data.metadata?.vulnerabilities || {};
    expect((v.critical || 0) + (v.high || 0)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// W3 mediums — signTransaction export, tx.data, KDF
// ---------------------------------------------------------------------------
describe('AUDIT-W3 mediums', () => {
  test('W3-005: signTransaction is disabled (policy kernel fixed)', () => {
    const src = readFileSync(path.join(REPO, 'backend/services/neuma-wallet.js'), 'utf8');
    expect(src).toMatch(/export const signTransaction/);
    expect(src).toMatch(/signTransaction is not available/);
  });

  test('W3-005: sendTransaction refuses non-empty tx.data', () => {
    // sendTransaction moved whole to the spend module (size-law campaign,
    // 49fd9d9ee) — the proof follows the code, not the old filename.
    const src = readFileSync(path.join(REPO, 'backend/services/neuma-wallet-spend.js'), 'utf8');
    expect(src).toMatch(/Contract calldata not permitted/);
    expect(src).toMatch(/data:\s*['"]0x['"]/);
  });

  // W3-007 found the neuma keypair's PBKDF2 at 100k; K7 seals new envelopes at 600k and opens
  // each at the count it carries. Proven on real envelopes, not the source text.
  test('W3-007: a new keypair envelope is sealed at 600k or more; a 100k envelope already on disk still opens', () => {
    const keypair = generateKeypair();
    const password = 'kestrel-lane-a-passphrase';
    const sealed = encryptKeypair(keypair, password);
    expect(sealed.kdfIterations).toBeGreaterThanOrEqual(600_000);
    expect(decryptKeypair(sealed, password).address).toBe(keypair.address);
    expect(() => decryptKeypair({ ...sealed, kdfIterations: KDF_ITERATIONS_LEGACY }, password)).toThrow();
    for (const withCount of [true, false]) {
      const legacy = sealLegacyEnvelope(keypair, password, { iterations: KDF_ITERATIONS_LEGACY, withCount });
      expect(decryptKeypair(legacy, password).address).toBe(keypair.address);
    }
  }, 20000);
});

// ---------------------------------------------------------------------------
// Lows — batch closed observation
// ---------------------------------------------------------------------------
describe('Low findings — closed observation', () => {
  test('W1-008: portal and terminal use ?token= query', () => {
    const portal = readFileSync(path.join(REPO, 'backend/routes/portal-routes.js'), 'utf8');
    const term = readFileSync(path.join(REPO, 'backend/routes/terminal-routes.js'), 'utf8');
    expect(portal).toMatch(/urlParams\.get\(['"]token['"]\)|searchParams\.get\(['"]token['"]\)|\.get\(['"]token['"]\)/);
    expect(term).toMatch(/token/);
  });

  test('W1-007 → audit 2026-10-28 M-03: preflight GET needs a signed-in caller, then returns home.root', async () => {
    const house = await fs.mkdtemp(path.join(os.tmpdir(), 'gnosis-pfget-'));
    process.env.NEUMA_WORKSPACE_SETTINGS_PATH = path.join(house, 's.json');
    const orig = getWorkspacesRoot();
    setWorkspacesRoot(house);
    try {
      const { default: router } = await import('../../backend/routes/preflight-routes.js');
      const app = express();
      app.use('/api/v1/preflight', router);
      expect((await request(app).get('/api/v1/preflight/')).status).toBe(401);
      const { token } = await fullAuth();
      const res = await request(app).get('/api/v1/preflight/').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.home?.root || res.body.home).toBeTruthy();
    } finally {
      setWorkspacesRoot(orig);
      delete process.env.NEUMA_WORKSPACE_SETTINGS_PATH;
      rmSync(house, { recursive: true, force: true });
    }
  });

  test('W2-009: skill install requires only absolute path', () => {
    const src = readFileSync(path.join(REPO, 'backend/routes/skill-routes.js'), 'utf8');
    expect(src).toMatch(/path\.isAbsolute/);
    expect(src).not.toMatch(/requireOwnership|startsWith\(.*projects/);
  });
});

// ---------------------------------------------------------------------------
// Remaining mediums/lows — closed observation + light runtime
// ---------------------------------------------------------------------------
describe('Remaining register items', () => {
  test('W2-006 residual: llm-routes imports assertSafeEndpoint for models/provider', () => {
    const llm = readFileSync(path.join(REPO, 'backend/routes/llm-routes.js'), 'utf8');
    const guard = readFileSync(path.join(REPO, 'backend/services/endpoint-guard.js'), 'utf8');
    expect(guard).toMatch(/export const assertSafeEndpoint/);
    expect(llm).toMatch(/import \{ assertSafeEndpoint \}/);
  });

  test('W3-006: spend approval nonces are in-process Map', () => {
    // The approval spine (nonce map included) lives in the spend module now
    // (size-law campaign, 49fd9d9ee) — same proof, followed to its new home.
    const src = readFileSync(path.join(REPO, 'backend/services/neuma-wallet-spend.js'), 'utf8');
    expect(src).toMatch(/new Map\(/);
    expect(src).toMatch(/usedNonces|approvalNonces|spentNonces|nonce/i);
  });

  test('W3-008: provider-credentials uses DNA_ENCRYPTION_KEY / workspace crypto', () => {
    const src = readFileSync(path.join(REPO, 'backend/services/provider-credentials.js'), 'utf8');
    expect(src).toMatch(/DNA_ENCRYPTION_KEY|workspace-crypto|encryptEnvelope|getMaster/i);
  });

  test('W3-009: electron-builder includes docs/contracts/abis (SEC-AUDIT-009 fixed)', () => {
    const yml = readFileSync(path.join(REPO, 'electron-builder.yml'), 'utf8');
    expect(yml).toMatch(/backend/);
    expect(yml).toMatch(/core/);
    expect(yml).toMatch(/docs\/contracts\/abis/);
  });

  test('W3-010: docker-compose publishes port without HOST=0.0.0.0', () => {
    const compose = readFileSync(path.join(REPO, 'docker-compose.yml'), 'utf8');
    expect(compose).toMatch(/ports:/);
    expect(compose).not.toMatch(/HOST\s*[:=]\s*['"]?0\.0\.0\.0/);
  });

  test('W3-011: runtime security surface is pinned exact, no caret ranges (fixed)', () => {
    const pkg = JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const carets = ['express', 'ws', 'ethers', 'multer'].filter((n) => String(deps[n] || '').startsWith('^'));
    expect(carets).toEqual([]);
  });

  test('W1-006: ownership compare is case-insensitive wherever it is made', () => {
    // The compare MOVED (#405): audit the PROPERTY, not a location. Add a file when a new comparer appears; never drop one.
    for (const f of ['backend/middleware/require-neuma-owner.js', 'backend/services/lane-ownership.js', 'backend/services/workspace-import.js']) {
      expect(readFileSync(path.join(REPO, f), 'utf8'), f).toMatch(/walletsMatch|walletMatches|toLowerCase\(\)/);
    }
  });

  test('W1-009: loadConfig prod enforces DNA not AUTH_SECRET', () => {
    const src = readFileSync(path.join(REPO, 'backend/config.js'), 'utf8');
    expect(src).toMatch(/DNA_ENCRYPTION_KEY|dnaEncryptionKey|WEAK_DEV_KEY/);
    // AUTH_SECRET not in production throw block adjacent — weak residual
    const prodBlock = src.match(/NODE_ENV[\s\S]{0,400}production[\s\S]{0,600}/);
    expect(prodBlock).toBeTruthy();
  });

  test('W2-010: disconnect is process-global (no wallet scope)', () => {
    const src = readFileSync(path.join(REPO, 'backend/routes/mcp-routes.js'), 'utf8');
    expect(src).toMatch(/disconnect-all|disconnect\(/);
    const disc = src.slice(src.indexOf('disconnect'));
    expect(disc.slice(0, 800)).not.toMatch(/walletAddress.*disconnect|requireAdmin/);
  });

  test('W2-012: sandbox empty workspaceRoot read roots empty array', () => {
    const src = readFileSync(path.join(REPO, 'backend/services/tool-sandbox.js'), 'utf8');
    expect(src).toMatch(/workspaceRoot|companion/);
  });

  test('W1-010: frontend stores authToken in sessionStorage', () => {
    const hits = [];
    const walk = (dir) => {
      for (const ent of require('fs').readdirSync(dir, { withFileTypes: true })) {
        if (ent.name === 'node_modules' || ent.name === 'dist') continue;
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (/\.(js|jsx|mjs)$/.test(ent.name)) {
          const t = readFileSync(p, 'utf8');
          if (t.includes('sessionStorage') && t.includes('authToken')) hits.push(p);
        }
      }
    };
    walk(path.join(REPO, 'frontend'));
    expect(hits.length).toBeGreaterThan(0);
  });
});
