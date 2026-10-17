/**
 * THE SECRET GATE — real git repos, the real script as a real subprocess,
 * NO mock (AGENTS.md RULE 0). This is the gnosis for #160 step 4.
 *
 * A secret scanner that reports "clean" is worthless unless you have watched it
 * FIRE. Every credential planted here is fake but real-SHAPED, and each case
 * proves one thing the gate must do:
 *
 *   - it catches each pattern class, naming file + line
 *   - it never prints the matched text (a CI log is more public than a tree)
 *   - it catches a live key in docs/audit/ — the #160 blind spot
 *   - it does NOT catch a redacted archive quote, which is why closing that
 *     blind spot cost zero false positives
 *   - it does NOT catch a UI placeholder that merely looks token-shaped
 *   - a clean repo exits 0
 */
import { describe, test, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createTempDir } from '../helpers/temp-fs.js';

const execFileP = promisify(execFile);
const SCRIPT = path.resolve('scripts/secret-scan.mjs');

// Fake, never issued anywhere — but shaped exactly like the real thing, which
// is the only way to prove the pattern table works.
const FAKE = Object.freeze({
  openai: `sk-proj-${'A1b2C3d4E5f6G7h8I9j0'.repeat(2)}`,
  github: `ghp_${'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'}`,
  aws: 'AKIA1234567890ABCDEF',
  evm: `0x${'ab'.repeat(32)}`,
  slack: 'xoxb-1234567890-1234567890123-AbCdEfGhIjKlMnOpQrSt',
});

const run = async (cwd) => {
  try {
    const { stdout, stderr } = await execFileP('node', [SCRIPT, cwd], { cwd });
    return { code: 0, out: stdout + stderr };
  } catch (err) {
    return { code: err.code, out: (err.stdout || '') + (err.stderr || '') };
  }
};

describe('secret-scan gate — proven by watching it fire (gnosis, no mock)', () => {
  let repo;
  const made = [];

  const commitFile = async (rel, body) => {
    const full = path.join(repo, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body);
    await execFileP('git', ['add', '-A'], { cwd: repo });
  };

  beforeEach(async () => {
    repo = await createTempDir('secret-gate');
    made.push(repo);
    await execFileP('git', ['init', '-q'], { cwd: repo });
    await commitFile('backend/ok.js', 'export const ok = true;\n');
  });

  afterAll(async () => {
    for (const r of made) await fs.rm(r, { recursive: true, force: true }).catch(() => {});
  });

  test('a clean repo passes', async () => {
    const { code, out } = await run(repo);
    expect(code).toBe(0);
    expect(out).toMatch(/no secrets found/);
  });

  test('every pattern class fires, with file and line', async () => {
    await commitFile('backend/leak.js', [
      '// line 1',
      `const a = '${FAKE.openai}';`,       // line 2
      `const b = '${FAKE.github}';`,       // line 3
      `const c = '${FAKE.aws}';`,          // line 4
      `DEPLOYER_PRIVATE_KEY=${FAKE.evm}`,  // line 5
      `const d = '${FAKE.slack}';`,        // line 6
    ].join('\n'));
    const { code, out } = await run(repo);
    expect(code).toBe(1);
    expect(out).toMatch(/backend\/leak\.js:2\s+\[openai-key\]/);
    expect(out).toMatch(/backend\/leak\.js:3\s+\[github-token\]/);
    expect(out).toMatch(/backend\/leak\.js:4\s+\[aws-access-key\]/);
    expect(out).toMatch(/backend\/leak\.js:5\s+\[evm-private-key\]/);
    expect(out).toMatch(/backend\/leak\.js:6\s+\[slack-token\]/);
  });

  test('the report never carries the secret it found', async () => {
    await commitFile('backend/leak.js', `const k = '${FAKE.openai}';\n`);
    const { code, out } = await run(repo);
    expect(code).toBe(1);
    expect(out).not.toContain(FAKE.openai);
    expect(out).toMatch(/deliberately not printed/);
  });

  test('a live key in docs/audit/ is caught — the #160 blind spot', async () => {
    await commitFile('docs/audit/archive/sector-infrastructure.md',
      `## Evidence\n\n\`\`\`\nOPENAI_API_KEY=${FAKE.openai}\n\`\`\`\n`);
    const { code, out } = await run(repo);
    expect(code).toBe(1);
    expect(out).toMatch(/docs\/audit\/archive\/sector-infrastructure\.md:4\s+\[openai-key\]/);
  });

  test('a REDACTED archive quote is not a finding — why closing the hole was free', async () => {
    // The exact convention the real archive uses after remediation.
    await commitFile('docs/audit/archive/sector-infrastructure.md', [
      'OPENAI_API_KEY=sk-proj-…REDACTED',
      'ANTHROPIC_API_KEY=sk-ant-…REDACTED',
      'XAI_API_KEY=xai-…REDACTED',
      'ETH_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/REDACTED',
      'DEPLOYER_PRIVATE_KEY=0x…REDACTED (64-hex key burned — rotate wallet if still funded)',
    ].join('\n'));
    const { code, out } = await run(repo);
    expect(code).toBe(0);
    expect(out).toMatch(/no secrets found/);
  });

  test('a token-shaped UI placeholder is not reported as a live token', async () => {
    await commitFile('archive/old-ui/js/mcp-installer.js',
      "        authPlaceholder: 'xoxb-your-token-here',\n");
    const { code } = await run(repo);
    expect(code).toBe(0);
  });

  test('an UNTRACKED secret is not scanned — .gitignore is honored by construction', async () => {
    await fs.writeFile(path.join(repo, '.env'), `OPENAI_API_KEY=${FAKE.openai}\n`);
    await fs.writeFile(path.join(repo, '.gitignore'), '.env\n');
    await execFileP('git', ['add', '-A'], { cwd: repo });
    const { code } = await run(repo);
    expect(code).toBe(0);
  });

  test('a directory that is not a git repo exits 2, never a false all-clear', async () => {
    const bare = await createTempDir('secret-gate-nogit');
    made.push(bare);
    const { code, out } = await run(bare);
    expect(code).toBe(2);
    expect(out).toMatch(/could not run/);
  });
});
