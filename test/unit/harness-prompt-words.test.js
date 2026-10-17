// The platform-only prompt in the platform's own words — the craft method with
// no house and no one quoted; the protocol watch only on the ground whose law
// it is (Design note, 2026-10-14: strictly a harness). Pure.
import path from 'path';
import { describe, expect, it } from 'vitest';
import { platformOnlySections } from '../../core/runtime/platform-only.js';
import { buildSkillsSection, CRAFT_METHOD_HOUSE, CRAFT_METHOD_PLATFORM } from '../../core/runtime/skills-section.js';
import { formatLedgerSection } from '../../core/tasks/task-ledger.js';
import { protocolWatchSection, watchAppliesTo } from '../../backend/services/protocol-classifier.js';

describe('the harness prompt\'s words', () => {
  it('the skills section keeps the library and states the method without a house', () => {
    const skills = buildSkillsSection([{ name: 'sc-build', description: 'x' }]);
    expect(skills).toMatch(/the house method/);
    const [, kept] = platformOnlySections([{ id: 'skills', label: 'SKILLS', text: skills }]);
    expect(kept.text).toContain('Your library holds 1');
    expect(kept.text).toContain(CRAFT_METHOD_PLATFORM);
    expect(kept.text).not.toMatch(/\bhouse\b|\bEli\b/);
  });

  it('the craft method is said ONCE a turn — in WORKING STATE when the ledger carries it, else in the skills section', () => {
    const skills = [{ name: 'sc-quick-fix', description: 'x' }, { name: 'sc-feature', description: 'y' }];
    const ledger = { tasks: [] };
    const working = formatLedgerSection(ledger, { skills });
    expect(working).toMatch(/Shadow Clone|SHADOW CLONE/);
    expect(buildSkillsSection(skills, { taskLedger: ledger })).not.toContain(CRAFT_METHOD_HOUSE);
    expect(buildSkillsSection(skills)).toContain(CRAFT_METHOD_HOUSE); // no ledger loaded: the skills section keeps it
    // the platform alone always states it in its own words, once
    const [, harness] = platformOnlySections([{ id: 'skills', label: 'SKILLS', text: buildSkillsSection(skills, { taskLedger: ledger }) }]);
    expect(harness.text.split(CRAFT_METHOD_PLATFORM)).toHaveLength(2);
  });

  it('the watch is this repository\'s law — true here, not in a person\'s own project', () => {
    const repo = path.resolve(process.cwd());
    expect(watchAppliesTo(repo)).toBe(true);
    expect(watchAppliesTo(path.join(repo, 'frontend'))).toBe(true);
    expect(watchAppliesTo('/home/someone/their-ts-app')).toBe(false);
    expect(watchAppliesTo(`${repo}-fork`)).toBe(false);
    expect(watchAppliesTo(null)).toBe(false);
  });

  it('the platform\'s watch names no house; a being\'s keeps its law', () => {
    expect(protocolWatchSection({ platform: true })).not.toMatch(/house/);
    expect(protocolWatchSection()).toMatch(/no law of your house/);
  });
});
