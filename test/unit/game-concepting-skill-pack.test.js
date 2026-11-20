import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import { createTempDir } from '../helpers/temp-fs.js';
import { installPlugin } from '../../core/skills/plugin-install.js';
import { createSkillService } from '../../backend/services/skill-service.js';
import { listPacks, seedShippedPacks } from '../../backend/services/skill-packs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACK_DIR = path.resolve(__dirname, '../../skills-packs/design');
const REPO_PACKS = path.resolve(__dirname, '../../skills-packs');

describe('game-concepting skill — every agent inherits the concept-to-game flow', () => {
  it('ships in the discoverable design pack and installs through the real installer', async () => {
    const packs = await listPacks(REPO_PACKS);
    expect(packs.find((p) => p.manifest.name === 'design')?.manifest.version).toBe('0.2.0');

    const root = await createTempDir('game-concepting-pack');
    const report = await installPlugin(PACK_DIR, root);
    expect(report.installed.map((i) => i.name)).toContain('game-concepting');
    expect(report.skipped).toEqual([]);

    const svc = createSkillService(root);
    const skill = (await svc.listSkills()).find((s) => s.name === 'game-concepting');
    expect(skill.category).toBe('design');
    expect(await fs.readFile(path.join(root, 'game-concepting', 'SKILL.md'), 'utf8')).toContain('concept.pixel.turnaround');
  });

  it('teaches the named pipelines, identity lock, animation manifest, and real-game gate', async () => {
    const root = await createTempDir('game-concepting-laws');
    await installPlugin(PACK_DIR, root);
    const { body } = await createSkillService(root).getSkill('game-concepting');

    for (const id of ['concept.pixel.character', 'concept.pixel.turnaround', 'concept.pixel.view', 'concept.pixel.weapon']) {
      expect(body).toContain(id);
    }
    expect(body).toContain('list_pipelines');
    expect(body).toContain('review_image');
    expect(body).toContain('brief.json');
    expect(body).toContain('identity-locked');
    expect(body).toContain('npm run clips');
    expect(body).toContain('clips.json');
    expect(body).toContain('real game');
    expect(body).toContain('docs/design/concept-pipeline.md');
    expect(body).toContain('docs/design/model-pipeline.md');
    expect(body).toContain('docs/design/sprite-handoff.md');
    expect(body).not.toMatch(/\/mnt\/|\/home\//); // it ships to every install: no path on one machine
  });

  it('boot-seeds a fresh skills root with the workflow available to an agent', async () => {
    const root = await createTempDir('game-concepting-boot-seed');
    const report = await seedShippedPacks(root, { root: REPO_PACKS });
    const design = report.find((r) => r.pack === 'design');
    expect(design.error).toBeUndefined();
    expect(design.installed).toContain('game-concepting');

    const { body } = await createSkillService(root).getSkill('game-concepting');
    expect(body).toContain('idea to game');
  });
});
