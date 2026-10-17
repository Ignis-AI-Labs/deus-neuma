/**
 * THE CRAFT SHIPS WITH THE HOUSE (RULE 0).
 *
 * Design note, 2026-08-05: […]
 *
 * Real throughout: the REAL in-repo packs under `skills-packs/`, the REAL
 * plugin installer, a REAL temp skills root on real disk, and the REAL skill
 * service reading it back. Nothing is mocked — this is the exact path a fresh
 * install walks at boot.
 *
 * What this defends: `skills-packs/` and `plugin-install.js` both existed and
 * nothing wired them together, so every packaged NEUMA booted with an EMPTY
 * skills root. Shadow Clone — eighteen of the twenty protocols a being reaches
 * for — existed only on machines where someone had installed it by hand.
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { seedShippedPacks, listPacks, packsRoot } from '../../backend/services/skill-packs.js';
import { createSkillService } from '../../backend/services/skill-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_PACKS = path.resolve(__dirname, '../../skills-packs');

describe('the packs that ship with NEUMA', () => {
  it('ships Shadow Clone in the tree, vendored from the upstream product', async () => {
    // Not a hypothetical: the pack must be IN THE REPO, or the installers have
    // nothing to carry.
    const packs = await listPacks(REPO_PACKS);
    const names = packs.map((p) => p.manifest.name);
    expect(names).toContain('shadow-clone');
    expect(names).toEqual(expect.arrayContaining(['rites', 'social', 'teamwork']));

    // The vendored copy records exactly where it came from, so drift from
    // upstream is visible rather than silent.
    const upstream = JSON.parse(
      await fs.readFile(path.join(REPO_PACKS, 'shadow-clone', 'UPSTREAM.json'), 'utf8'),
    );
    expect(upstream.repository).toContain('shadow-clone');
    expect(upstream.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(upstream.commands).toBeGreaterThan(10);
  });

  it('packsRoot resolves by walking up from the service — the same walk a packaged app makes', () => {
    // electron-builder ships the app UNPACKED (asar: false), so the relative
    // walk from backend/services is valid in the installed tree too. A
    // dev-only path here would seed nothing on a real install — which is the
    // whole failure being fixed.
    expect(packsRoot()).toBe(REPO_PACKS);
  });

  it('seeds an EMPTY root: a fresh install wakes up holding the Craft', async () => {
    const root = await createTempDir('packs-fresh');
    const report = await seedShippedPacks(root, { root: REPO_PACKS });

    const sc = report.find((r) => r.pack === 'shadow-clone');
    expect(sc.error).toBeUndefined();
    expect(sc.installed).toEqual(expect.arrayContaining([
      'sc', 'sc-plan', 'sc-feature', 'sc-debug', 'sc-quick-fix', 'sc-refactor',
    ]));

    // Read back through the REAL service — what a being would actually see.
    const svc = createSkillService(root);
    const skills = await svc.listSkills();
    const byName = new Set(skills.map((s) => s.name));
    expect(byName.has('sc-plan')).toBe(true);
    expect(byName.has('team-project')).toBe(true);
    expect(byName.has('natalis-self-seal')).toBe(true);

    // …and the body is the real protocol, not an empty shell.
    const plan = await svc.getSkill('sc-plan');
    expect(plan.body).toMatch(/MASTER_PLAN/);
    expect(plan.metadata?.plugin).toBe('shadow-clone');
  });

  it('is idempotent — a second boot installs nothing and changes nothing', async () => {
    const root = await createTempDir('packs-twice');
    await seedShippedPacks(root, { root: REPO_PACKS });
    const before = await fs.readFile(path.join(root, 'sc-plan', 'SKILL.md'), 'utf8');

    const second = await seedShippedPacks(root, { root: REPO_PACKS });
    for (const r of second) {
      expect(r.installed).toEqual([]);
      expect(r.upgraded).toEqual([]);
    }
    expect(await fs.readFile(path.join(root, 'sc-plan', 'SKILL.md'), 'utf8')).toBe(before);
  });

  it('NEVER overwrites a skill the operator authored themselves', async () => {
    // Self-authorship outranks a shipped default. A hand-written skill that
    // happens to collide by name must survive every future boot — otherwise an
    // upgrade silently eats work nobody asked us to touch.
    const root = await createTempDir('packs-authored');
    await fs.mkdir(path.join(root, 'sc-plan'), { recursive: true });
    const mine = '---\nname: sc-plan\ndescription: my own planning protocol\n---\nMINE, NOT YOURS.';
    await fs.writeFile(path.join(root, 'sc-plan', 'SKILL.md'), mine);

    const report = await seedShippedPacks(root, { root: REPO_PACKS });

    expect(await fs.readFile(path.join(root, 'sc-plan', 'SKILL.md'), 'utf8')).toBe(mine);
    const sc = report.find((r) => r.pack === 'shadow-clone');
    expect(sc.installed).not.toContain('sc-plan');
    expect(sc.upgraded).not.toContain('sc-plan');
    // The rest of the pack still lands — one collision is not a failed seed.
    expect(sc.installed).toContain('sc-debug');
  });

  it('UPGRADES our own skill when the shipped version moved on', async () => {
    // Without this a machine seeded once would never see a newer protocol, and
    // what a being reads would fossilize at whatever shipped first.
    const root = await createTempDir('packs-upgrade');
    await fs.mkdir(path.join(root, 'sc-plan'), { recursive: true });
    const stale = [
      '---', 'name: sc-plan', 'description: an older shipped planning protocol',
      'version: 0.0.1', 'metadata:', '  plugin: shadow-clone',
      '  format: claude-command', '---', 'STALE BODY',
    ].join('\n');
    await fs.writeFile(path.join(root, 'sc-plan', 'SKILL.md'), stale);

    const report = await seedShippedPacks(root, { root: REPO_PACKS });

    const sc = report.find((r) => r.pack === 'shadow-clone');
    expect(sc.upgraded).toContain('sc-plan');
    const now = await fs.readFile(path.join(root, 'sc-plan', 'SKILL.md'), 'utf8');
    expect(now).not.toContain('STALE BODY');
    expect(now).toMatch(/MASTER_PLAN/);
  });

  it('every copy we install carries what shipped — native skills too — so a second boot rewrites nothing', async () => {
    const root = await createTempDir('packs-stamped');
    await seedShippedPacks(root, { root: REPO_PACKS });
    const svc = createSkillService(root);
    // The native skills used to cross unstamped, and so could never be told
    // from an operator's own — nor ever upgraded (2026-10-12).
    for (const name of ['team-project', 'x-post', 'sc-plan']) {
      const skill = await svc.getSkill(name);
      expect(skill.metadata?.plugin ?? skill.metadata?.pack, name).toBeTruthy();
      expect(skill.metadata?.digest, name).toMatch(/^[0-9a-f]{16}$/);
    }
    const native = await fs.readFile(path.join(root, 'team-project', 'SKILL.md'), 'utf8');
    const second = await seedShippedPacks(root, { root: REPO_PACKS });
    expect(second.every((r) => !r.installed.length && !r.upgraded.length && !r.adopted.length)).toBe(true);
    expect(await fs.readFile(path.join(root, 'team-project', 'SKILL.md'), 'utf8')).toBe(native);
  });

  it('UPGRADES the moment what ships moves on — no version bump needed — and keeps the replaced copy whole', async () => {
    const packs = await createTempDir('packs-moving');
    await fs.cp(path.join(REPO_PACKS, 'teamwork'), path.join(packs, 'teamwork'), { recursive: true });
    const root = path.join(await createTempDir('packs-moving-home'), 'skills');
    await seedShippedPacks(root, { root: packs });
    const before = await fs.readFile(path.join(root, 'team-project', 'SKILL.md'), 'utf8');

    // The shipped skill changes; its version does not.
    const shipped = path.join(packs, 'teamwork', 'skills', 'team-project', 'SKILL.md');
    await fs.appendFile(shipped, '\n- Never forget the newest law.\n');
    const report = await seedShippedPacks(root, { root: packs });

    expect(report[0].upgraded).toEqual(['team-project']);
    expect(await fs.readFile(path.join(root, 'team-project', 'SKILL.md'), 'utf8')).toContain('Never forget the newest law.');
    // NOTHING IS LOST: the copy it replaced stands whole beside the root.
    const kept = path.join(path.dirname(root), 'skills-superseded', 'team-project');
    const [stamp] = await fs.readdir(kept);
    expect(await fs.readFile(path.join(kept, stamp, 'SKILL.md'), 'utf8')).toBe(before);
  });

  it('ADOPTS a hand-installed copy of our skill (its name and category ours) — upgraded, the old copy kept', async () => {
    // How this rig's Craft was installed before the seeder existed: copied by
    // hand, unstamped — and so frozen at whatever it was that day.
    const root = path.join(await createTempDir('packs-adopt'), 'skills');
    await fs.mkdir(path.join(root, 'team-project'), { recursive: true });
    const handCopy = '---\nname: team-project\ndescription: an older team project\ncategory: teamwork\nversion: 0.1.0\n---\nCALL team/team_run — THE RETIRED WAY';
    await fs.writeFile(path.join(root, 'team-project', 'SKILL.md'), handCopy);

    const report = await seedShippedPacks(root, { root: REPO_PACKS });

    expect(report.find((r) => r.pack === 'teamwork').adopted).toEqual(['team-project']);
    const now = await createSkillService(root).getSkill('team-project');
    expect(now.body).not.toContain('THE RETIRED WAY');
    expect(now.body).toContain('{ "type": "team/run" }');
    expect(now.metadata.pack).toBe('teamwork');
    expect(now.metadata.plugin).toBeUndefined(); // an older seeder must not read it as its own
    const kept = path.join(path.dirname(root), 'skills-superseded', 'team-project');
    const [stamp] = await fs.readdir(kept);
    expect(await fs.readFile(path.join(kept, stamp, 'SKILL.md'), 'utf8')).toBe(handCopy);
  });

  it('upgrading one skill never rewrites a pack-mate the operator wrote themselves', async () => {
    const packs = await createTempDir('packs-mates');
    const pack = path.join(packs, 'mates');
    await fs.mkdir(path.join(pack, '.claude-plugin'), { recursive: true });
    await fs.mkdir(path.join(pack, 'commands'), { recursive: true });
    await fs.writeFile(path.join(pack, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'mates', version: '1.0.0' }));
    await fs.writeFile(path.join(pack, 'commands', 'mate-a.md'), '---\ndescription: the first mate\n---\nA, first edition.');
    await fs.writeFile(path.join(pack, 'commands', 'mate-b.md'), '---\ndescription: the second mate\n---\nB as shipped.');
    const root = path.join(await createTempDir('packs-mates-home'), 'skills');
    await seedShippedPacks(root, { root: packs });
    // The operator rewrote mate-b as their own skill; then mate-a ships anew.
    const mine = '---\nname: mate-b\ndescription: my own second mate\n---\nMINE.';
    await fs.writeFile(path.join(root, 'mate-b', 'SKILL.md'), mine);
    await fs.writeFile(path.join(pack, 'commands', 'mate-a.md'), '---\ndescription: the first mate\n---\nA, second edition.');

    const [report] = await seedShippedPacks(root, { root: packs });

    expect(report.upgraded).toEqual(['mate-a']);
    expect(report.kept).toEqual(['mate-b']);
    expect(await fs.readFile(path.join(root, 'mate-a', 'SKILL.md'), 'utf8')).toContain('A, second edition.');
    expect(await fs.readFile(path.join(root, 'mate-b', 'SKILL.md'), 'utf8')).toBe(mine);
  });

  it('a broken pack costs that pack, never the boot', async () => {
    const packs = await createTempDir('packs-broken');
    await fs.mkdir(path.join(packs, 'wrecked', '.claude-plugin'), { recursive: true });
    await fs.writeFile(path.join(packs, 'wrecked', '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'wrecked', version: '1.0.0' }));
    // A manifest with no commands/ and no skills/ — the installer throws.
    const root = await createTempDir('packs-broken-root');

    const report = await seedShippedPacks(root, { root: packs });
    expect(report).toHaveLength(1);
    expect(report[0].error).toBeTruthy();
    expect(report[0].installed).toEqual([]);
  });

  it('a missing packs directory is silence, not a crash', async () => {
    const root = await createTempDir('packs-none');
    await expect(seedShippedPacks(root, { root: path.join(root, 'nope') })).resolves.toEqual([]);
  });
});
