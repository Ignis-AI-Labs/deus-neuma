/**
 * The social skill pack ships in-repo (skills-packs/social) and must stay
 * installable through the REAL plugin installer into a REAL temp skills root
 * (RULE 0) — this is exactly the path a being's "activate" takes.
 *
 * Stage 2 of the being-tool-surface doctrine retired the post_to_x tool the
 * pack used to teach: posting is a filed INTENT now. The pack's teaching text
 * is pinned here so the skill a being summons never instructs a dead call —
 * the intent path itself is proven with real files and a real card in
 * test/integration/x-post-gate.test.js and intent-sweep.test.js.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { installPlugin } from '../../core/skills/plugin-install.js';
import { createSkillService } from '../../backend/services/skill-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACK_DIR = path.resolve(__dirname, '../../skills-packs/social');

describe('social skill pack — the being "activate" path', () => {
  it('installs through the real plugin installer and teaches the INTENT path, never a dead tool', async () => {
    const root = await createTempDir('social-pack');
    const report = await installPlugin(PACK_DIR, root);
    expect(report.plugin.name).toBe('social');
    expect(report.installed.map((i) => i.name)).toContain('x-post');
    expect(report.skipped).toEqual([]);

    const svc = createSkillService(root);
    const skills = await svc.listSkills();
    const xPost = skills.find((s) => s.name === 'x-post');
    expect(xPost.category).toBe('social');
    expect(xPost.description).toMatch(/social\/post/);

    const manifest = await svc.getSkill('x-post');
    expect(manifest.body).toMatch(/social\/post/);
    expect(manifest.body).toMatch(/280 characters/);
    // The retired tool names must never come back into the teaching text.
    expect(manifest.body).not.toMatch(/post_to_x/);
    expect(manifest.body).not.toMatch(/queue_post_to_/);
  });
});
