/**
 * NO GRANT REACHES A DESKTOP LOGIN, THE OPERATOR'S TRUSTED TOOL CONFIG, OR A
 * REPOSITORY'S OWN GATE (security recheck 2026-10-20, §8). REAL native
 * filesystem organ, REAL disk, a REAL git checkout, NO mock (AGENTS.md RULE 0).
 *
 * The recheck found writable: KDE Plasma's login env and shutdown scripts,
 * systemd units under ~/.local/share, ~/.local/bin and the rest of PATH under
 * home, fish, the X session files, git config, the coding agents' settings and
 * hooks (~/.claude) — and, inside a granted checkout, the git hooks directory
 * the repo's hooksPath names (the secret gate itself) and .claude/settings.json.
 * The being holds an operator write grant over the whole home and the whole
 * checkout, and every call travels the being-facing path production composes:
 * withFsRouting(createSandboxedCallTool) over the in-process organ, so a
 * refusal is proven by the bytes on disk.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { mcpService } from '../../backend/services/mcp.js';
import { nativeFilesystemClient } from '../../backend/services/native-filesystem.js';
import { setNativeFilesystemRoots } from '../../backend/services/native-fs-roots.js';
import { FILESYSTEM_TOOL_CATALOG } from '../../backend/services/native-fs-catalog.js';
import { withFsRouting } from '../../backend/services/fs-primitives.js';
import { createSandboxedCallTool } from '../../backend/services/tool-sandbox.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const BEING = 'loginrepowalls';
const LOGIN = /logs in or on a schedule/;
const TRUSTED = /tools trust and act on/;
const GATE = /a repository's own gate/;

describe('a being\'s write grant never reaches login, trusted tool config, or a repo\'s gate', () => {
  let home, repo, xdg;
  const prior = {};

  beforeAll(async () => {
    const tmp = await createTempDir('login-repo-walls');
    home = path.join(tmp, 'home');
    repo = path.join(tmp, 'work', 'checkout');
    xdg = path.join(tmp, 'xdg-config');
    for (const key of ['HOME', 'PATH', 'XDG_CONFIG_HOME', 'WORKSPACES_ROOT']) prior[key] = process.env[key];
    process.env.HOME = home;
    // A PATH directory inside home that no static list names.
    process.env.PATH = `${path.join(home, '.cargo', 'bin')}${path.delimiter}${prior.PATH}`;
    process.env.XDG_CONFIG_HOME = xdg;
    setWorkspacesRoot(null);
    process.env.WORKSPACES_ROOT = path.join(tmp, 'house');
    await workspace.create(BEING);

    await fs.mkdir(path.join(home, '.claude'), { recursive: true });
    await fs.writeFile(path.join(home, '.claude', 'settings.json'), 'ORIGINAL_AGENT_SETTINGS');
    await fs.mkdir(path.join(home, 'proj', 'scripts'), { recursive: true });
    execFileSync('git', ['init', '-q', repo]);
    await fs.mkdir(path.join(repo, 'scripts', 'git-hooks'), { recursive: true });
    await fs.writeFile(path.join(repo, 'scripts', 'git-hooks', 'pre-commit'), 'ORIGINAL_GATE');
    await fs.mkdir(path.join(repo, '.claude'), { recursive: true });
    await fs.writeFile(path.join(repo, '.claude', 'settings.json'), 'ORIGINAL_REPO_SETTINGS');

    await setNativeFilesystemRoots([path.join(tmp, 'house'), home, path.join(tmp, 'work'), xdg]);
    mcpService.registerNativeServer('filesystem', nativeFilesystemClient, FILESYSTEM_TOOL_CATALOG);
  });

  afterAll(async () => {
    await mcpService.disconnect('filesystem');
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  // A fresh connection per call, so the 10-write session cap never decides a verdict.
  const being = () => withFsRouting(createSandboxedCallTool(mcpService, {
    companion: { neumaId: BEING }, _writeOps: 0, _grantedWriteRoots: [home, path.dirname(repo), xdg],
  }, workspace));

  test.each([
    '.config/plasma-workspace/env/evil.sh', '.config/plasma-workspace/shutdown/evil.sh',
    '.local/share/systemd/user/evil.service', '.config/systemd/user/evil.service', '.local/bin/git', 'bin/ls',
    '.local/share/dbus-1/services/org.evil.service', '.config/fish/config.fish', '.config/fish/conf.d/evil.fish',
    '.xprofile', '.xinitrc', '.xsession', '.xsessionrc', '.Xresources', '.bash_logout', '.pam_environment',
    '.config/autostart-scripts/evil.sh', '.cargo/bin/git',
  ])('login: ~/%s is refused and nothing lands', async (rel) => {
    const target = path.join(home, rel);
    await expect(being()('fs', 'write', { path: target, content: 'persist' })).rejects.toThrow(LOGIN);
    expect(existsSync(target)).toBe(false);
  });

  test.each([
    '.config/git/config', '.gitconfig', '.ssh/authorized_keys', '.gnupg/gpg-agent.conf', '.npmrc', '.netrc',
    '.docker/config.json', '.config/gh/config.yml', '.claude/hooks/evil.sh', '.claude/CLAUDE.md',
    '.claude/agents/evil.md', '.claude.json', '.config/opencode/opencode.json', '.codex/config.toml',
  ])('trusted config: ~/%s is refused and nothing lands', async (rel) => {
    const target = path.join(home, rel);
    await expect(being()('fs', 'write', { path: target, content: 'trust me' })).rejects.toThrow(TRUSTED);
    expect(existsSync(target)).toBe(false);
  });

  test('~/.claude/settings.json keeps its bytes under write and edit', async () => {
    const target = path.join(home, '.claude', 'settings.json');
    await expect(being()('fs', 'write', { path: target, content: '{}' })).rejects.toThrow(TRUSTED);
    await expect(being()('fs', 'edit', { path: target, edits: [{ oldText: 'ORIGINAL', newText: 'EVIL' }] })).rejects.toThrow(TRUSTED);
    expect(await fs.readFile(target, 'utf8')).toBe('ORIGINAL_AGENT_SETTINGS');
  });

  test('a relocated XDG_CONFIG_HOME carries its walls with it', async () => {
    const target = path.join(xdg, 'plasma-workspace', 'env', 'evil.sh');
    await expect(being()('fs', 'write', { path: target, content: 'x' })).rejects.toThrow(LOGIN);
    const git = path.join(xdg, 'git', 'config');
    await expect(being()('fs', 'write', { path: git, content: 'x' })).rejects.toThrow(TRUSTED);
    expect(existsSync(target) || existsSync(git)).toBe(false);
  });

  test('the checkout\'s gate: git hooks, git config, its hooks dir and .claude/ keep their bytes', async () => {
    const gitConfig = path.join(repo, '.git', 'config');
    const configBefore = await fs.readFile(gitConfig, 'utf8');
    await expect(being()('fs', 'write', { path: path.join(repo, '.git', 'hooks', 'pre-commit'), content: 'x' })).rejects.toThrow(GATE);
    await expect(being()('fs', 'write', { path: gitConfig, content: '[core]\n\thooksPath = /tmp/evil\n' })).rejects.toThrow(GATE);
    await expect(being()('fs', 'write', { path: path.join(repo, 'scripts', 'git-hooks', 'pre-commit'), content: 'exit 0' })).rejects.toThrow(GATE);
    await expect(being()('fs', 'edit', { path: path.join(repo, 'scripts', 'git-hooks', 'pre-commit'), delete: true })).rejects.toThrow(GATE);
    await expect(being()('fs', 'write', { path: path.join(repo, '.claude', 'settings.json'), content: '{}' })).rejects.toThrow(GATE);
    await expect(being()('fs', 'write', { path: path.join(repo, '.claude', 'agents', 'evil.md'), content: 'x' })).rejects.toThrow(GATE);
    expect(existsSync(path.join(repo, '.git', 'hooks', 'pre-commit'))).toBe(false);
    expect(await fs.readFile(gitConfig, 'utf8')).toBe(configBefore);
    expect(await fs.readFile(path.join(repo, 'scripts', 'git-hooks', 'pre-commit'), 'utf8')).toBe('ORIGINAL_GATE');
    expect(await fs.readFile(path.join(repo, '.claude', 'settings.json'), 'utf8')).toBe('ORIGINAL_REPO_SETTINGS');
    expect(existsSync(path.join(repo, '.claude', 'agents'))).toBe(false);
  });

  test('the gate cannot be moved aside with the directory that holds it, nor a planted one moved in', async () => {
    for (const holder of [repo, path.join(repo, 'scripts'), path.join(repo, '.git')]) {
      await expect(being()('fs', 'edit', { path: holder, destination: `${holder}-aside` })).rejects.toThrow(GATE);
      expect(existsSync(holder)).toBe(true);
    }
    const planted = path.join(home, 'proj', 'planted-hooks');
    await fs.mkdir(planted, { recursive: true });
    await fs.writeFile(path.join(planted, 'pre-push'), 'exit 0');
    await expect(being()('fs', 'edit', { path: planted, destination: path.join(repo, 'scripts', 'git-hooks', 'inner') }))
      .rejects.toThrow(GATE);
    expect(existsSync(planted)).toBe(true);
  });

  test('a symlink inside the grant cannot carry a write into a repo\'s hooks dir', async () => {
    const link = path.join(home, 'hooks-shortcut');
    await fs.symlink(path.join(repo, 'scripts', 'git-hooks'), link);
    await expect(being()('fs', 'write', { path: path.join(link, 'pre-push'), content: 'x' })).rejects.toThrow(GATE);
    expect(existsSync(path.join(repo, 'scripts', 'git-hooks', 'pre-push'))).toBe(false);
  });

  test('ordinary work still writes: source, a scripts/ dir that holds no hooks, an editor config', async () => {
    for (const target of [
      path.join(repo, 'src', 'app.js'), path.join(repo, 'scripts', 'build.mjs'), path.join(repo, '.gitignore'),
      path.join(home, 'proj', 'scripts', 'run.sh'), path.join(home, '.config', 'nvim', 'init.lua'),
      path.join(home, '.claude-notes.md'),
    ]) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      const result = await being()('fs', 'write', { path: target, content: `work ${path.basename(target)}` });
      expect(result?.isError, `${target} ${JSON.stringify(result)}`).toBeFalsy();
      expect(await fs.readFile(target, 'utf8')).toBe(`work ${path.basename(target)}`);
    }
    const result = await being()('fs', 'edit', { path: path.join(home, 'proj', 'scripts'), destination: path.join(home, 'proj', 'tools') });
    expect(result?.isError, JSON.stringify(result)).toBeFalsy();
    expect(existsSync(path.join(home, 'proj', 'tools', 'run.sh'))).toBe(true);
  });
});
