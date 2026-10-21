/**
 * The design skill pack ships in-repo (skills-packs/design) and must stay
 * installable through the REAL plugin installer into a REAL temp skills root
 * (RULE 0) — the exact path the boot seeding walks. Also pins the skill's
 * own laws: the contact-sheet template and the LINE & CYCLE binding ship
 * beside the skill, and the ratify-before-code law is stated where a being
 * or agent will actually read it.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import { createTempDir } from '../helpers/temp-fs.js';
import { installPlugin } from '../../core/skills/plugin-install.js';
import { createSkillService } from '../../backend/services/skill-service.js';
import { listPacks } from '../../backend/services/skill-packs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACK_DIR = path.resolve(__dirname, '../../skills-packs/design');
const REPO_PACKS = path.resolve(__dirname, '../../skills-packs');

describe('design skill pack — the bench ships with the house', () => {
  it('is discoverable from the REAL skills-packs root', async () => {
    const packs = await listPacks(REPO_PACKS);
    const design = packs.find((p) => p.manifest.name === 'design');
    expect(design).toBeTruthy();
    expect(design.manifest.version).toBeTruthy();
  });

  it('installs through the real installer, reference files and all', async () => {
    const root = await createTempDir('design-pack');
    const report = await installPlugin(PACK_DIR, root);
    expect(report.plugin.name).toBe('design');
    expect(report.installed.map((i) => i.name)).toContain('design-variations');
    expect(report.skipped).toEqual([]);

    // The whole skill directory crosses — the skill is useless without its
    // binding reference and its review-surface template.
    const dir = path.join(root, 'design-variations');
    expect(await fs.readFile(path.join(dir, 'line-and-cycle.md'), 'utf8')).toContain('#5FE9FF');
    expect(await fs.readFile(path.join(dir, 'contact-sheet.html'), 'utf8')).toContain('RATIFICATION IS A WORD');

    const svc = createSkillService(root);
    const skill = (await svc.listSkills()).find((s) => s.name === 'design-variations');
    expect(skill.category).toBe('design');
  });

  it('the skill text carries the laws the bench exists to enforce', async () => {
    const root = await createTempDir('design-pack-laws');
    await installPlugin(PACK_DIR, root);
    const svc = createSkillService(root);
    const { body } = await svc.getSkill('design-variations');
    // Ratify-before-code — the whole point (ruling, 2026-08-10).
    expect(body).toMatch(/No real code before a ratified variant/);
    // Bound to the language, reference shipped beside the skill.
    expect(body).toMatch(/line-and-cycle\.md/);
    expect(body).toMatch(/contact-sheet\.html/);
    // Honest limits — variations are mockups, not live data.
    expect(body).toMatch(/static mockups/);
  });
});
