/**
 * The library lookup (`skill/skill_search`) — the door to what the standing
 * menu abbreviates.
 *
 * Real filesystem throughout (RULE 0): real skill files in a real temp skills
 * root, read by the real skill service singleton the portal uses, resolved by
 * the real `searchSkillLibrary`. Nothing is stubbed, and the ranking half is a
 * pure function called with real inputs.
 */
import fs from 'fs/promises';
import path from 'path';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';

const SKILLS = [
  {
    name: 'sc-debug',
    description: 'Shadow Clone debug mode — systematic root-cause analysis and bug resolution with hardening',
    body: 'Find the root cause before changing anything.',
  },
  {
    name: 'sc-docs',
    description: 'Shadow Clone docs mode — generate or refresh documentation for work currently in scope. Audience-aware, anti-marketing.',
    body: 'Write for the person who reads it later.',
  },
  {
    name: 'design-variations',
    description: 'Render a front-end concept as real HTML variations on one contact sheet BEFORE any code is written. Use whenever a UI piece is being created or changed.',
    body: 'Open the contact sheet in a browser.',
  },
];

let craft;

const writeSkillsRoot = async (root) => {
  for (const skill of SKILLS) {
    const dir = path.join(root, skill.name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'SKILL.md'),
      `---\nname: ${skill.name}\ndescription: ${JSON.stringify(skill.description)}\n---\n${skill.body}\n`);
  }
};

beforeEach(async () => {
  const root = await createTempDir('skill-search-');
  await writeSkillsRoot(root);
  // The service singleton binds its root at import time, so the root must be
  // declared before the module graph loads — real service, real files.
  vi.resetModules();
  process.env.NEUMA_SKILLS_ROOT = root;
  craft = await import('../../backend/services/skill-tool.js');
});

describe('searchSkills (pure ranking)', () => {
  it('puts an exact name first, ahead of a description that also matches it', () => {
    const found = craft.searchSkills(SKILLS, 'sc-docs');
    expect(found[0].name).toBe('sc-docs');
  });

  it('finds a skill by the work rather than the name', () => {
    const found = craft.searchSkills(SKILLS, 'root cause of a bug');
    expect(found[0].name).toBe('sc-debug');
  });

  it('finds a trigger that lives past the menu hook bound', () => {
    // […] sits at character 100+ of the
    // description — the part the standing menu cuts. The lookup still reaches it.
    const found = craft.searchSkills(SKILLS, 'UI piece changed');
    expect(found.map((s) => s.name)).toContain('design-variations');
  });

  it('answers nothing for a query that matches nothing, and never throws', () => {
    expect(craft.searchSkills(SKILLS, 'quantum tractor repair')).toEqual([]);
    expect(craft.searchSkills(SKILLS, '   ')).toEqual([]);
    expect(craft.searchSkills(null, 'sc-debug')).toEqual([]);
  });

  it('honours a caller limit and clamps an abusive one', () => {
    expect(craft.searchSkills(SKILLS, 'shadow clone', 1)).toHaveLength(1);
    expect(craft.searchSkills(SKILLS, 'shadow clone', 9_999).length)
      .toBeLessThanOrEqual(craft.SKILL_SEARCH_LIMIT_MAX);
  });
});

describe('searchSkillLibrary (real skills root)', () => {
  it('returns the FULL description, not the menu hook', async () => {
    const { result, event } = await craft.searchSkillLibrary({ query: 'UI variations' });
    expect(result.status).toBe('ok');
    const payload = JSON.parse(result.content);
    const hit = payload.skills.find((s) => s.name === 'design-variations');
    expect(hit).toBeDefined();
    // The whole description, ellipsis-free — the trailing trigger included.
    expect(hit.description).toBe(SKILLS[2].description);
    expect(hit.description).not.toContain('…');
    expect(event.status).toBe('ok');
    expect(event.detail).toContain('design-variations');
  });

  it('names the real library when a query matches nothing', async () => {
    const { result } = await craft.searchSkillLibrary({ query: 'quantum tractor repair' });
    const payload = JSON.parse(result.content);
    expect(payload.skills).toEqual([]);
    expect(payload.yourSkills.sort()).toEqual(['design-variations', 'sc-debug', 'sc-docs']);
  });

  it('refuses an empty query as an error the being can act on', async () => {
    const { result } = await craft.searchSkillLibrary({});
    expect(result.status).toBe('error');
    expect(result.error).toContain('query');
  });

  it('is a look, not a summons: no instructions body comes back', async () => {
    const { result } = await craft.searchSkillLibrary({ query: 'sc-debug' });
    expect(result.content).not.toContain('Find the root cause before changing anything');
    expect(result.content).not.toContain('<skill_instructions>');
  });

  it('is recognised as the lookup, and still as a skill-server call', () => {
    const match = { server: 'skill', toolName: 'skill_search', tool: 'skill/skill_search' };
    expect(craft.isSkillSearchTool(match)).toBe(true);
    expect(craft.isSkillTool(match)).toBe(true);
    expect(craft.isSkillSearchTool({ server: 'skill', toolName: 'use_skill' })).toBe(false);
  });
});
