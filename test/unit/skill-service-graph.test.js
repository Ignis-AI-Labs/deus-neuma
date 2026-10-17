/**
 * Skill service graph exposure — listSkills carries the tree UI's edges
 * (authored dependencies + registry-computed unlocks). Real filesystem
 * throughout (RULE 0): real SKILL.md files in a real temp root, scanned by
 * the real registry.
 */
import fs from 'fs/promises';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { createSkillService } from '../../backend/services/skill-service.js';

const writeSkill = async (root, name, { deps = [], category = 'craft' } = {}) => {
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  const depLine = deps.length ? `dependencies:\n${deps.map((d) => `  - ${d}`).join('\n')}\n` : '';
  await fs.writeFile(path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name} instructions\ncategory: ${category}\n${depLine}---\nBody of ${name}.\n`);
};

describe('skill service — graph edges for the tree', () => {
  it('lists dependencies as authored and unlocks as computed reverse edges', async () => {
    const root = await createTempDir('skills-graph');
    await writeSkill(root, 'base');
    await writeSkill(root, 'mid', { deps: ['base'] });
    await writeSkill(root, 'leaf', { deps: ['mid'] });

    const svc = createSkillService(root);
    const skills = await svc.listSkills();
    const byName = Object.fromEntries(skills.map((s) => [s.name, s]));

    expect(byName.base.dependencies).toEqual([]);
    expect(byName.base.unlocks).toEqual(['mid']);
    expect(byName.mid.dependencies).toEqual(['base']);
    expect(byName.mid.unlocks).toEqual(['leaf']);
    expect(byName.leaf.dependencies).toEqual(['mid']);
    expect(byName.leaf.unlocks).toEqual([]);
  });

  it('keeps the menu fields intact alongside the new edges', async () => {
    const root = await createTempDir('skills-graph-menu');
    await writeSkill(root, 'solo');

    const svc = createSkillService(root);
    const [solo] = await svc.listSkills();
    expect(solo).toEqual({
      name: 'solo',
      description: 'solo instructions',
      category: 'craft',
      version: null,
      plugin: null,
      dependencies: [],
      unlocks: [],
    });
  });
});
