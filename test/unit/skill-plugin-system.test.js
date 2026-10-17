/**
 * Skills S4 — plugin install + summoning runtime (#22).
 *
 * Real filesystem throughout (RULE 0): fixture plugins in the exact
 * Claude-format shape shadow-clone ships (.claude-plugin/plugin.json +
 * commands/*.md), installed into real temp skills roots, scanned by the
 * real registry, summoned through the real portal handler, with honest
 * acquisition landing in a real temp workspace tree.
 */
import fs from 'fs/promises';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  splitCommandMd, commandToSkill, composeSkillMd, readPluginManifest, installPlugin,
} from '../../core/skills/plugin-install.js';
import { loadManifest } from '../../core/skills/manifest.js';
import { createSkillService } from '../../backend/services/skill-service.js';
import { SKILL_RESULT_MAX_CHARS } from '../../backend/services/skill-tool.js';
import { assemblePrompt } from '../../core/runtime/prompt-assembler.js';

const SC_PLAN_MD = `---
description: Plan a feature as ordered waves of work
---

## Planning mode

You are in planning mode. Decompose the goal into waves.
Rule: never skip the audit wave.
`;

// A realistic fixture in the shape shadow-clone actually ships.
const writeFixturePlugin = async (dir, { name = 'shadow-clone', extras = true } = {}) => {
  await fs.mkdir(path.join(dir, '.claude-plugin'), { recursive: true });
  await fs.writeFile(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({
    name, description: 'AI orchestration as commands', version: '0.2.3',
  }));
  await fs.mkdir(path.join(dir, 'commands'), { recursive: true });
  await fs.writeFile(path.join(dir, 'commands', 'sc-plan.md'), SC_PLAN_MD);
  if (extras) {
    await fs.writeFile(path.join(dir, 'commands', 'sc-echo.md'),
      '---\ndescription: "Paired review: dispatch a second model"\n---\nReview loop body.\n');
    // A broken command — no description — must be reported, not installed
    await fs.writeFile(path.join(dir, 'commands', 'broken.md'), 'No frontmatter at all.\n');
    // A native skill dir (already in our contract) — copied through whole
    const native = path.join(dir, 'skills', 'wave-report');
    await fs.mkdir(path.join(native, 'lib'), { recursive: true });
    await fs.writeFile(path.join(native, 'SKILL.md'),
      '---\nname: wave-report\ndescription: Summarize a wave\n---\nReport body.\n');
    await fs.writeFile(path.join(native, 'lib', 'util.js'), 'export const x = 1;\n');
  }
  return dir;
};

describe('command → skill conversion (pure)', () => {
  it('parses frontmatter + body from a command md', () => {
    const { frontmatter, body } = splitCommandMd(SC_PLAN_MD);
    expect(frontmatter.description).toBe('Plan a feature as ordered waves of work');
    expect(body).toContain('## Planning mode');
  });

  it('derives the skill identity from the filename', () => {
    const skill = commandToSkill('sc-plan.md', SC_PLAN_MD);
    expect(skill.name).toBe('sc-plan');
    expect(skill.description).toBe('Plan a feature as ordered waves of work');
    expect(skill.body).toContain('never skip the audit wave');
  });

  it('accepts the real Claude dialect: bare colons inside a description (sc-echo)', () => {
    // Verbatim failure shape from the real shadow-clone install: strict YAML
    // rejects the plain scalar, the lenient dialect parse must not.
    const md = '---\ndescription: Paired review mode — a second model (default: GLM via OpenCode) reviews each wave\n---\nBody.\n';
    const skill = commandToSkill('sc-echo.md', md);
    expect(skill.description).toBe('Paired review mode — a second model (default: GLM via OpenCode) reviews each wave');
  });

  it('rejects a command with no description or empty body', () => {
    expect(() => commandToSkill('x.md', 'just a body')).toThrow(/description/);
    expect(() => commandToSkill('x.md', '---\ndescription: d\n---\n \n')).toThrow(/empty body/);
    expect(() => commandToSkill('Bad Name.md', SC_PLAN_MD)).toThrow(/kebab-case/);
  });

  it('composed SKILL.md round-trips through the real manifest loader', async () => {
    const skill = commandToSkill('sc-echo.md',
      '---\ndescription: "Tricky: colons, \\"quotes\\", and — dashes"\n---\nBody here.\n');
    const md = composeSkillMd(skill, { name: 'shadow-clone', version: '0.2.3', source: '/src' });
    const dir = await createTempDir('roundtrip');
    await fs.mkdir(path.join(dir, 'sc-echo'));
    await fs.writeFile(path.join(dir, 'sc-echo', 'SKILL.md'), md);
    const manifest = await loadManifest(path.join(dir, 'sc-echo'));
    expect(manifest.name).toBe('sc-echo');
    expect(manifest.description).toBe('Tricky: colons, "quotes", and — dashes');
    expect(manifest.category).toBe('shadow-clone');
    expect(manifest.metadata.plugin).toBe('shadow-clone');
    expect(manifest.body).toContain('Body here.');
  });
});

describe('installPlugin (real fs)', () => {
  it('installs commands + native skills and reports the broken one honestly', async () => {
    const pluginDir = await writeFixturePlugin(await createTempDir('plugin'));
    const root = await createTempDir('skills-root');

    const report = await installPlugin(pluginDir, root);
    expect(report.plugin.name).toBe('shadow-clone');
    expect(report.installed.map((i) => i.name).sort()).toEqual(['sc-echo', 'sc-plan', 'wave-report']);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0].entry).toBe('commands/broken.md');

    // Native skill copied whole — resources survive
    await expect(fs.readFile(path.join(root, 'wave-report', 'lib', 'util.js'), 'utf8'))
      .resolves.toContain('x = 1');
  });

  it('refuses to overwrite an existing skill unless forced', async () => {
    const pluginDir = await writeFixturePlugin(await createTempDir('plugin'), { extras: false });
    const root = await createTempDir('skills-root');
    await installPlugin(pluginDir, root);

    const again = await installPlugin(pluginDir, root);
    expect(again.installed).toHaveLength(0);
    expect(again.skipped[0].reason).toMatch(/already installed/);

    const forced = await installPlugin(pluginDir, root, { force: true });
    expect(forced.installed.map((i) => i.name)).toEqual(['sc-plan']);
  });

  it('rejects a directory that is not a plugin', async () => {
    const dir = await createTempDir('not-a-plugin');
    await expect(installPlugin(dir, await createTempDir('root'))).rejects.toThrow(/not a plugin/);
    await expect(readPluginManifest(dir)).rejects.toThrow(/not a plugin/);
  });
});

describe('skill service (real registry over a real root)', () => {
  it('lists installed skills with provenance and serves bodies', async () => {
    const pluginDir = await writeFixturePlugin(await createTempDir('plugin'));
    const root = await createTempDir('skills-root');
    const service = createSkillService(root);

    expect(await service.listSkills()).toEqual([]);
    await service.installPluginFromPath(pluginDir);

    const skills = await service.listSkills();
    expect(skills.map((s) => s.name)).toEqual(['sc-echo', 'sc-plan', 'wave-report']);
    expect(skills.find((s) => s.name === 'sc-plan').plugin).toBe('shadow-clone');

    const skill = await service.getSkill('sc-plan');
    expect(skill.body).toContain('never skip the audit wave');
    expect(await service.getSkill('nope')).toBeUndefined();
  });
});

describe('prompt advertisement', () => {
  it('renders the skills pointer with the summoning instruction — the library loads on demand', () => {
    const prompt = assemblePrompt({
      skills: [{ name: 'sc-plan', description: 'Plan a feature as ordered waves of work' }],
    });
    expect(prompt).toContain('## Your Skills (The Craft)');
    expect(prompt).not.toContain('- sc-plan: Plan a feature as ordered waves of work');
    expect(prompt).toContain('Your library holds 1');
    expect(prompt).toContain('skill/use_skill');
  });

  it('stays silent with no skills installed', () => {
    expect(assemblePrompt({})).not.toContain('The Craft');
  });
});

describe('summoning through the portal handler (real service, real workspace)', () => {
  // The portal services bind their skillService singleton (env root) and the
  // workspace singleton (WORKSPACES_ROOT) at import — reset modules with
  // both pointed at real temp dirs so the whole path runs against them.
  const loadPortal = async (skillsRoot, workspacesRoot) => {
    vi.resetModules();
    process.env.NEUMA_SKILLS_ROOT = skillsRoot;
    process.env.WORKSPACES_ROOT = workspacesRoot;
    const portal = await import('../../backend/services/portal-test-surface.js');
    const { neumaWorkspace } = await import('../../core/index.js');
    return { portal, neumaWorkspace };
  };

  it('returns the skill body as the tool result and records honest acquisition', async () => {
    const pluginDir = await writeFixturePlugin(await createTempDir('plugin'), { extras: false });
    const skillsRoot = await createTempDir('skills-root');
    const workspacesRoot = await createTempDir('workspaces');
    await installPlugin(pluginDir, skillsRoot);

    const { portal, neumaWorkspace } = await loadPortal(skillsRoot, workspacesRoot);
    const neumaId = 'test-neuma-craft';
    await neumaWorkspace.create(neumaId);

    const sent = [];
    const ws = { send: (raw) => sent.push(JSON.parse(raw)) };
    const result = await portal.__test._handleSkillUse(
      ws, { name: 'Echo', neumaId }, { name: 'sc-plan' }
    );

    // The summons delivers the full instructions with the roomier cap
    expect(result.status).toBe('ok');
    expect(result.content).toContain('<skill_instructions>');
    expect(result.content).toContain('never skip the audit wave');
    expect(result.cap).toBe(SKILL_RESULT_MAX_CHARS);

    // The witness sees the chip
    expect(sent.some((m) => m.type === 'tool:usage' && m.tool === 'skill/sc-plan' && m.status === 'ok')).toBe(true);

    // Honest acquisition: used ⇒ acquired, in the real tree on real disk
    const tree = await neumaWorkspace.readSkillTree(neumaId);
    const acquired = tree.acquisitions.find((a) => a.skill === 'sc-plan');
    expect(acquired).toBeDefined();
    expect(acquired.usageCount).toBe(1);
  });

  it('an unknown skill returns the library honestly instead of failing', async () => {
    const skillsRoot = await createTempDir('skills-root-empty');
    const { portal } = await loadPortal(skillsRoot, await createTempDir('workspaces'));
    const ws = { send: () => {} };
    const result = await portal.__test._handleSkillUse(ws, { name: 'Echo' }, { name: 'ghost' });
    expect(result.status).toBe('ok');
    expect(result.content).toMatch(/No skill named 'ghost'/);
  });

  it('recognizes the skill tool across dialects', async () => {
    const skillsRoot = await createTempDir('skills-root-d');
    const { portal } = await loadPortal(skillsRoot, await createTempDir('workspaces'));
    expect(portal.__test._isSkillTool({ server: 'skill', toolName: 'use_skill' })).toBe(true);
    expect(portal.__test._isSkillTool({ server: null, toolName: 'use_skill' })).toBe(true);
    expect(portal.__test._isSkillTool({ server: 'filesystem', toolName: 'read_file' })).toBe(false);
  });
});

describe('operator slash-invocation (pure)', () => {
  it('parses "/sc-plan build the thing"', async () => {
    const { parseSlashInvocation, composeSkillTurn } = await import('../../backend/services/skill-tool.js');
    expect(parseSlashInvocation('/sc-plan build the thing'))
      .toEqual({ name: 'sc-plan', input: 'build the thing' });
    expect(parseSlashInvocation('/sc-plan')).toEqual({ name: 'sc-plan', input: '' });
    expect(parseSlashInvocation('just talking / thinking')).toBeNull();
    expect(parseSlashInvocation('/Not-Kebab')).toBeNull();

    const turn = composeSkillTurn('sc-plan', 'BODY', 'build the thing', 'operator');
    expect(turn).toContain('Your operator summoned your skill "sc-plan"');
    expect(turn).toContain('BODY');
    expect(turn).toContain('build the thing');
  });

  it('an oversized skill body composes to a turn that stays UNDER the result cap', async () => {
    // The composed turn (wrapper included) must fit the cap the result
    // carries — otherwise the result formatter truncates a second time,
    // slicing the closing tags off and stacking two truncation marks.
    const { composeSkillTurn } = await import('../../backend/services/skill-tool.js');
    const cap = SKILL_RESULT_MAX_CHARS;
    const turn = composeSkillTurn('sc-plan', 'x'.repeat(cap + 5000), '', 'self');
    expect(turn.length).toBeLessThanOrEqual(cap);
    expect(turn).toContain('[skill instructions truncated');
    expect(turn).toContain('</skill_instructions>'); // the closing tag survives
  });
});
