/**
 * The standing capability surface: the tool HUD and the skill menu.
 *
 * Both builders are pure, so these call them with real-shaped catalogs and read
 * the real rendered text — no mock exists or is needed. The contracts under
 * guard are the two that make a compact surface safe: an exact callable
 * identifier must still be derivable from the index, and the skill pointer
 * must name the library and both doors to it — loaded only when asked (Founder,
 * 2026-10-04: load on demand).
 */
import { describe, expect, it } from 'vitest';
import { buildToolsSection } from '../../core/runtime/tools-section.js';
import { buildSkillsSection } from '../../core/runtime/skills-section.js';

const TOOLS = Object.freeze([
  { server: 'filesystem', name: 'read_file', description: 'Read a file', access: 'allowed' },
  { server: 'filesystem', name: 'write_file', description: 'Write a file', access: 'approval_required' },
  { server: 'filesystem', name: 'delete_file', description: 'Delete a file', access: 'denied' },
  { server: 'web', name: 'web_search', description: 'Search the web', access: 'allowed' },
  { server: 'skill', name: 'use_skill', description: 'Summon a skill', access: 'allowed' },
]);

const LONG_DESCRIPTION = 'Render a front-end concept as real HTML variations on one contact sheet BEFORE any code is written. Use whenever a UI piece is being created or changed.';

describe('THE TOOL HUD (the native path, 2026-10-14) — as little as possible, always the same', () => {
  const section = buildToolsSection(TOOLS, null, false, true);

  it('names the two doors with a worked call — the exact callable form is in the prompt verbatim', () => {
    expect(section).toContain('system/call {"tool": "server/name", "args": {…}}');
    expect(section).toContain('system/tool_search');
  });

  it('names the families once — never every tool, never a description', () => {
    expect(section).toContain('Your tool families: filesystem · web · skill');
    for (const tool of TOOLS) expect(section).not.toContain(tool.description);
    expect(section).not.toContain('read_file write_file');
  });

  it('a held tool is named by its exact id; asking tools are said once, not listed', () => {
    expect(section).toContain('HELD THIS TURN (your operator is observing — these will not act): filesystem/delete_file');
    expect(section).toContain('Some tools ask your operator first');
    expect(section).not.toContain('filesystem/write_file');
  });

  it('the usual tools — the being\'s experience — ride by signature', () => {
    const usual = [{ server: 'filesystem', name: 'read_file', inputSchema: { type: 'object', properties: { path: {} }, required: ['path'] } }];
    expect(buildToolsSection(TOOLS, null, false, true, false, usual)).toContain('Your usual tools — call them directly: filesystem/read_file {path}');
  });

  it('renders nothing at all when no tool rides', () => {
    expect(buildToolsSection([], null, false, true)).toBe('');
    expect(buildToolsSection(null, null, false, true)).toBe('');
  });

  it('an open folder is named as the ground — no hand is wired for it', () => {
    const grounded = buildToolsSection(TOOLS, '/home/op/project', false, true);
    expect(grounded).toContain('YOUR GROUND: /home/op/project');
    expect(grounded).not.toContain('ALWAYS WIRED');
  });
});

describe('the skill pointer', () => {
  const skills = [
    { name: 'sc-echo', description: 'Enter echo paired-review mode' },
    { name: 'design-variations', description: LONG_DESCRIPTION },
  ];
  const section = buildSkillsSection(skills);

  it('loads no skill into the prompt — neither names nor descriptions', () => {
    expect(section).not.toContain('sc-echo');
    expect(section).not.toContain('design-variations');
    expect(section).not.toContain(LONG_DESCRIPTION);
  });

  it('names the library size and both doors to it', () => {
    // A being must know the library exists and how to reach it — otherwise
    // load-on-demand is a library nobody can open.
    expect(section).toContain('Your library holds 2; none is loaded until you ask for it');
    expect(section).toContain('skill/skill_search');
    expect(section).toContain('skill/use_skill');
  });

  it('renders nothing at all for an empty library', () => {
    expect(buildSkillsSection([])).toBe('');
    expect(buildSkillsSection(null)).toBe('');
  });
});
