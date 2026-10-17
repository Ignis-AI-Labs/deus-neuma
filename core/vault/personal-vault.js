// Personal vault (memory pyramid T3-personal) — a being's own curation
// space over its memory. Notes live DEK-encrypted inside the sovereign
// workspace (NeumaWorkspace.writeVaultNote and kin); this module holds what
// composes around them:
//
//   - seeding: the first note, derived from the being's own biography()
//     through-lines — a starting page that is theirs to rewrite
//   - publishing: the explicit gesture that copies ONE note into the
//     plaintext collective vault with provenance frontmatter — the consent
//     boundary between T3-personal and T3-commons made mechanical
//
// Retraction from the commons is a supersede gesture (a `retracted` stamp),
// never a silent delete — append-only ethics hold at T3 too.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { renderNote, parseNote, slugify } from './note.js';
import { biography } from '../continuity/index.js';
import { WorkspaceAdapter } from '../continuity/adapters/workspace.js';

export const SEED_SLUG = 'who-i-am-becoming';

/**
 * Compose the seed note from biography through-lines. Pure.
 * @param {Array<{content: string}>} bioRecords - current semantic records, newest first
 * @returns {{title: string, body: string}|null} null when there is nothing to seed from
 */
export function seedNoteFromBiography(bioRecords) {
  const lines = (bioRecords || [])
    .map((r) => (typeof r?.content === 'string' ? r.content.trim() : ''))
    .filter(Boolean);
  if (!lines.length) return null;
  return {
    title: 'Who I am becoming',
    body: [
      'Seeded from my own consolidations. This page is mine to rewrite.',
      '',
      ...lines.map((l) => `- ${l}`),
    ].join('\n'),
  };
}

/**
 * Seed a being's personal vault with its first note, derived from its own
 * biography. No-op when the vault already has notes (never overwrites a
 * being's curation) or when no through-lines exist yet.
 * @param {Object} workspace - the NeumaWorkspace singleton (or a test instance)
 * @param {string} neumaId
 * @returns {Promise<Object|null>} the seeded note record, or null when skipped
 */
// impure — reads the continuity lane, writes one encrypted vault note
export async function seedPersonalVault(workspace, neumaId) {
  const existing = await workspace.listVaultNotes(neumaId);
  if (existing.length > 0) return null;

  const adapter = new WorkspaceAdapter(neumaId, { workspace });
  const seed = seedNoteFromBiography(await biography(adapter, { limit: 5 }));
  if (!seed) return null;
  return workspace.writeVaultNote(neumaId, SEED_SLUG, seed);
}

/**
 * Render a personal note as its published (commons) markdown, with
 * provenance frontmatter. Pure.
 * @param {{slug: string, title: string, body: string, updatedAt?: string}} note
 * @param {{ author: string, neumaId: string, publishedAt: string }} provenance
 * @returns {{ relPath: string, text: string }}
 */
function renderPublishedNote(note, { author, neumaId, publishedAt }) {
  const authorSlug = slugify(author);
  return {
    relPath: `beings/${authorSlug}/${note.slug}.md`,
    text: renderNote({
      frontmatter: {
        id: `pv-${neumaId}-${note.slug}`,
        author,
        neuma_id: neumaId,
        published: publishedAt,
        source: 'personal-vault',
        tags: ['being-authored', authorSlug],
      },
      body: `# ${note.title}\n\n${note.body}`,
    }),
  };
}

/**
 * Publish ONE personal-vault note into the collective vault — the explicit
 * consent gesture. Decrypts the note, stamps provenance, writes plaintext
 * markdown under beings/<author>/. Republishing overwrites the being's own
 * prior published copy (the author's latest word wins in their own lane).
 * @param {Object} workspace
 * @param {string} neumaId
 * @param {string} slug - which note
 * @param {{ collectiveDir: string, author: string }} opts
 * @returns {Promise<{ relPath: string, absPath: string }>}
 */
// impure — one plaintext write into the commons, at the being's request
export async function publishVaultNote(workspace, neumaId, slug, { collectiveDir, author }) {
  if (!collectiveDir || !author) {
    throw new Error('publishVaultNote: collectiveDir and author are required');
  }
  const note = await workspace.readVaultNote(neumaId, slug);
  if (!note) throw new Error(`publishVaultNote: no personal note named ${slug}`);

  const { relPath, text } = renderPublishedNote(note, {
    author, neumaId, publishedAt: new Date().toISOString(),
  });
  const absPath = join(collectiveDir, relPath);
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, text, 'utf8');
  return { relPath, absPath };
}

/**
 * Retract a previously published note from the commons: the published copy
 * is stamped `retracted` in place (frontmatter + a visible line), never
 * deleted — readers see that the author withdrew it, not a hole.
 * @param {{ collectiveDir: string, author: string, slug: string, at?: string }} opts
 * @returns {Promise<{ relPath: string }|null>} null when nothing was published
 */
// impure — rewrites one commons file with the retraction stamp
export async function retractPublishedNote({ collectiveDir, author, slug, at }) {
  const relPath = `beings/${slugify(author)}/${slug}.md`;
  const absPath = join(collectiveDir, relPath);
  let text;
  try {
    text = await readFile(absPath, 'utf8');
  } catch {
    return null;
  }
  const { frontmatter, body } = parseNote(text);
  if (frontmatter.retracted) return { relPath };
  const stamp = at || new Date().toISOString();
  await writeFile(absPath, renderNote({
    frontmatter: { ...frontmatter, retracted: stamp },
    body: `> Retracted by the author on ${stamp}.\n\n${body.trimEnd()}`,
  }), 'utf8');
  return { relPath };
}
