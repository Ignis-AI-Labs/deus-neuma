// vault-notes.test.js — the pure grammar of the knowledge vault: note
// render/parse roundtrip, claude-mem row transforms, and the incremental
// sync planner. Pure functions, real inputs, real outputs — no mock
// anywhere (RULE 0).

import { describe, it, expect } from 'vitest';
import { hashText, parseNote, renderNote, slugify } from '../../core/vault/note.js';
import {
  buildNotes, observationLinkName, observationNote, summaryLinkName, summaryNote,
} from '../../core/vault/claude-mem-notes.js';
import { planSync } from '../../core/vault/sync-plan.js';

// Row shapes copied from the real claude-mem store (observations /
// session_summaries tables) — JSON-string columns and all.
const OBS_ROW = {
  id: 14255,
  memory_session_id: '1a00c6a1-af68-41f0-9ef4-2558fb066a4e',
  project: 'neuma',
  type: 'discovery',
  title: 'CLI architecture uses yargs with modular command registration pattern',
  subtitle: 'Neuma CLI built on yargs with seven subcommands',
  narrative: 'The neuma CLI follows a testable architecture pattern.',
  facts: '["CLI entry point is cli/index.js","Seven subcommands available"]',
  concepts: '["how-it-works","pattern"]',
  files_read: '["cli/index.js","cli/lib/dispatch.js"]',
  files_modified: '[]',
  created_at: '2026-07-05T19:46:07.831Z',
  content_hash: '63f4552121c37d65',
};

const SUMMARY_ROW = {
  id: 1155,
  memory_session_id: '1a00c6a1-af68-41f0-9ef4-2558fb066a4e',
  project: 'neuma',
  request: 'Documenting vision for team runs as shared family memories',
  investigated: 'How team trial runs are persisted.',
  learned: 'Scorecards remember team runs but beings do not.',
  completed: 'Created memory file documenting the vision.',
  next_steps: 'Restart backend and run TRIAL tab.',
  notes: 'Connected multiple architectural threads.',
  created_at: '2026-07-05T19:44:41.324Z',
};

describe('note grammar', () => {
  it('roundtrips frontmatter and body through render → parse', () => {
    const note = {
      frontmatter: { id: 'obs-1', title: 'has: colon and "quotes"', tags: ['a-tag', 'b tag'] },
      body: '# Heading\n\nBody with [[wikilink]] and `code`.',
    };
    const { frontmatter, body } = parseNote(renderNote(note));
    expect(frontmatter.id).toBe('obs-1');
    expect(frontmatter.title).toBe('has: colon and "quotes"');
    expect(frontmatter.tags).toEqual(['a-tag', 'b tag']);
    expect(body.trimEnd()).toBe(note.body);
  });

  it('stamps body_hash matching the body it rendered', () => {
    const rendered = renderNote({ frontmatter: { id: 'x' }, body: 'the body' });
    const { frontmatter, body } = parseNote(rendered);
    expect(frontmatter.body_hash).toBe(hashText(body.replace(/\n$/, '')));
  });

  it('detects a hand edit as a hash mismatch', () => {
    const rendered = renderNote({ frontmatter: { id: 'x' }, body: 'original body' });
    const edited = rendered.replace('original body', 'edited by a human');
    const { frontmatter, body } = parseNote(edited);
    expect(hashText(body.replace(/\n$/, ''))).not.toBe(frontmatter.body_hash);
  });

  it('never throws on frontmatter-less or malformed text', () => {
    expect(parseNote('just prose, no frontmatter').body).toBe('just prose, no frontmatter');
    expect(parseNote('---\n%%%garbage\n---\nbody').body).toBe('body');
  });

  it('slugifies titles into portable filenames', () => {
    expect(slugify('CLI architecture uses yargs!')).toBe('cli-architecture-uses-yargs');
    expect(slugify('  ---  ')).toBe('untitled');
    expect(slugify('x'.repeat(100)).length).toBeLessThanOrEqual(60);
  });
});

describe('claude-mem transforms', () => {
  it('shapes an observation row into a linked, tagged note', () => {
    const note = observationNote(OBS_ROW, summaryLinkName(SUMMARY_ROW));
    expect(note.relPath).toBe(`observations/neuma/${observationLinkName(OBS_ROW)}.md`);
    expect(note.sourceHash).toBe('63f4552121c37d65');
    expect(note.frontmatter.tags).toEqual(['claude-mem', 'discovery', 'how-it-works', 'pattern']);
    expect(note.body).toContain('# CLI architecture uses yargs');
    expect(note.body).toContain('- CLI entry point is cli/index.js');
    expect(note.body).toContain('`cli/lib/dispatch.js`');
    expect(note.body).toContain(`**Session:** [[${summaryLinkName(SUMMARY_ROW)}]]`);
  });

  it('degrades malformed JSON columns to empty lists, never a throw', () => {
    const note = observationNote({ ...OBS_ROW, facts: '{broken', concepts: null });
    expect(note.frontmatter.tags).toEqual(['claude-mem', 'discovery']);
    expect(note.body).not.toContain('## Facts');
  });

  it('shapes a session summary into a MOC linking its observations', () => {
    const note = summaryNote(SUMMARY_ROW, [
      { linkName: observationLinkName(OBS_ROW), title: OBS_ROW.title },
    ]);
    expect(note.relPath).toBe(`sessions/neuma/${summaryLinkName(SUMMARY_ROW)}.md`);
    expect(note.body).toContain('## Learned');
    expect(note.body).toContain(`[[${observationLinkName(OBS_ROW)}|${OBS_ROW.title}]]`);
  });

  it('cross-links observations and summaries by memory_session_id', () => {
    const notes = buildNotes({ observations: [OBS_ROW], summaries: [SUMMARY_ROW] });
    expect(notes).toHaveLength(2);
    expect(notes[0].body).toContain(`[[${summaryLinkName(SUMMARY_ROW)}]]`);
    expect(notes[1].body).toContain(`[[${observationLinkName(OBS_ROW)}`);
  });

  it('leaves observations unlinked when their session has no summary', () => {
    const notes = buildNotes({ observations: [{ ...OBS_ROW, memory_session_id: 'other' }], summaries: [SUMMARY_ROW] });
    expect(notes[0].body).not.toContain('**Session:**');
  });
});

describe('planSync', () => {
  const note = { relPath: 'observations/neuma/1-a.md', sourceHash: 'aaaa' };
  const clean = { sourceHash: 'aaaa', stampedBodyHash: 'h1', actualBodyHash: 'h1' };

  it('creates what is absent, skips what is unchanged', () => {
    const plan = planSync([note, { ...note, relPath: 'observations/neuma/2-b.md' }],
      new Map([[note.relPath, clean]]));
    expect(plan.creates.map((n) => n.relPath)).toEqual(['observations/neuma/2-b.md']);
    expect(plan.unchanged).toBe(1);
    expect(plan.updates).toEqual([]);
  });

  it('updates when the source changed and the note is untouched', () => {
    const plan = planSync([{ ...note, sourceHash: 'bbbb' }], new Map([[note.relPath, clean]]));
    expect(plan.updates).toHaveLength(1);
  });

  it('preserves hand-edited notes even when the source changed', () => {
    const edited = { sourceHash: 'aaaa', stampedBodyHash: 'h1', actualBodyHash: 'DIFFERENT' };
    const plan = planSync([{ ...note, sourceHash: 'bbbb' }], new Map([[note.relPath, edited]]));
    expect(plan.preserved).toEqual([note.relPath]);
    expect(plan.updates).toEqual([]);
  });

  it('regenerates hand-edited notes only under force', () => {
    const edited = { sourceHash: 'aaaa', stampedBodyHash: 'h1', actualBodyHash: 'DIFFERENT' };
    const plan = planSync([note], new Map([[note.relPath, edited]]), { force: true });
    expect(plan.updates).toHaveLength(1);
    expect(plan.preserved).toEqual([]);
  });
});
