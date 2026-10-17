/**
 * The documents pack (skills-packs/documents) ships the `pdf` skill: the press
 * (the old Nimbus system) one skill_search away (Design note, 2026-10-06: […]). Installed
 * through the REAL plugin installer into a REAL temp skills root (RULE 0) —
 * the path boot seeding walks — and found by the real skill_search ranking for
 * the words an operator actually uses.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { installPlugin } from '../../core/skills/plugin-install.js';
import { createSkillService } from '../../backend/services/skill-service.js';
import { listPacks } from '../../backend/services/skill-packs.js';
import { searchSkills } from '../../backend/services/skill-tool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACK_DIR = path.resolve(__dirname, '../../skills-packs/documents');
const REPO_PACKS = path.resolve(__dirname, '../../skills-packs');

describe('documents skill pack — PDF one search away', () => {
  it('is discoverable from the real skills-packs root', async () => {
    const pack = (await listPacks(REPO_PACKS)).find((p) => p.manifest.name === 'documents');
    expect(pack?.manifest.version).toBeTruthy();
  });

  it('installs through the real installer, and the search lands on it for the words people use', async () => {
    const root = await createTempDir('documents-pack');
    const report = await installPlugin(PACK_DIR, root);
    expect(report.installed.map((i) => i.name)).toEqual(['pdf']);
    // Beside the design pack's brand-kit skill — the near neighbour for "branding".
    await installPlugin(path.join(REPO_PACKS, 'design'), root);
    const skills = await createSkillService(root).listSkills();
    expect(skills.map((s) => s.name)).toContain('brand-kit');
    for (const query of ['pdf', 'nimbus', 'Nimbus PDF document generation branding', 'branded document export']) {
      expect(searchSkills(skills, query)[0]?.name, query).toBe('pdf');
    }
  });

  it('the skill names the one call and the honest report', async () => {
    const root = await createTempDir('documents-pack-body');
    await installPlugin(PACK_DIR, root);
    const { body } = await createSkillService(root).getSkill('pdf');
    expect(body).toMatch(/press\/press_document/);
    expect(body).toMatch(/system\/tool_search/);
    expect(body).toMatch(/full markdown/i);
    expect(body).toMatch(/saved path exactly/);
  });
});
