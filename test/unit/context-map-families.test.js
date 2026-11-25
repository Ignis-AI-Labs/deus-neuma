/**
 * EVERY SECTION HAS A FAMILY ON THE CONTEXT MAP (context-anatomy.js FAMILY_OF) — Design note, 2026-11-20: […] 29 of the sections the platform sends fell to OTHER —
 * the office briefings, the position map, the sovereignty gateway, the house post, the true name, the witness's
 * sealed identity among them. This reads the files that name prompt sections, every way they name one, and fails on
 * a section the map would not know.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { familyOf } from '../../frontend/app/RelinkShell/context-anatomy.js';
import { besideTurnSections, toolDefinitionsOf } from '../../backend/services/wire-sections.js';

// The files that name a section a request carries (each was checked by hand for its naming form on 2026-11-20).
const SECTION_SOURCES = [
  'core/runtime/prompt-assembler.js', 'core/runtime/identity-bundle.js', 'core/runtime/platform-only.js',
  'backend/services/turn-envelope.js', 'backend/services/turn-context-carry.js', 'backend/services/portal-stream.js',
  'backend/services/portal-turn-prompt.js', 'backend/services/witness-turn-context.js', 'backend/services/witness-prompt.js',
];
const NAMING = [
  /\bid: '([a-zA-Z0-9]+)'/g, // { id: 'croOffice', label: 'MERCATOR OFFICE', … }
  /\bpush(?:Identity)?\(\s*'([a-zA-Z0-9]+)'/g, // push('covenant', 'THE ANSWER', …) — witness-prompt.js
  /\bpushSection\(\s*[a-zA-Z]+,\s*'([a-zA-Z0-9]+)'/g, // pushSection(core, 'sealedIdentity', …) — identity-bundle.js
];
const namedIn = (file) => {
  const text = fs.readFileSync(path.resolve(file), 'utf8');
  return NAMING.flatMap((re) => [...text.matchAll(re)].map((m) => m[1]));
};

describe('the context map knows every section the platform sends', () => {
  test('no named section falls to OTHER', () => {
    const ids = [...new Set(SECTION_SOURCES.flatMap(namedIn))];
    // The scan is reading what it should: sections from every builder, the office briefings among them.
    expect(ids).toEqual(expect.arrayContaining(['identity', 'croOffice', 'positionMap', 'sovereignty', 'sealedIdentity', 'covenant', 'harnessFrame', 'currentTurn']));
    expect(ids.length).toBeGreaterThan(60);
    expect(ids.filter((id) => familyOf(id) === 'other')).toEqual([]);
  });

  test('nor does anything else that rides the wire: tool definitions, earlier images, finished actions, the echo, a sender\'s results, tool rounds', () => {
    const wire = [
      { role: 'system', content: 's' },
      { role: 'user', content: [{ type: 'text', text: 'earlier' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] },
      { role: 'user', content: 'Recent completed actions before the queued message arrived: …' },
      { role: 'user', content: 'Answer in the format shown.' },
      { role: 'user', content: 'the words' },
      { role: 'tool', content: '{"ok":true}' },
    ];
    const beside = besideTurnSections(wire, { transcript: 0, priorImages: [wire[1]], queued: [wire[2]], echo: [wire[3]] });
    const tools = toolDefinitionsOf({ _toolsOnWire: [{ type: 'function', function: { name: 'files_read' } }] });
    const ids = [...beside, ...tools].map((s) => s.id);
    expect(ids).toEqual(['priorImages', 'queuedActions', 'formatEcho', 'callerTail', 'toolDefinitions']);
    expect([...ids, 'toolRound3', 'fold2'].filter((id) => familyOf(id) === 'other')).toEqual([]);
  });
});
