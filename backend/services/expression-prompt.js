// The FEELING section (Campaign 6) — the invitation to declare, plus the
// palette line. Rides the appended (post-assembler) seam beside the
// undercurrent, and renders '' for every being whose channel is off (the
// empty-string law: zero bytes for everyone not flipped — and on the local
// substrate every byte is prefill EVERY turn, cache_prompt off).
//
// Register laws honored: the invitation states the rule and does not sell
// it (answer-covenant); the palette line carries the RECORD and states no
// lesson about it (undercurrent doctrine). The declaration is optional
// ALWAYS — the wording says so in the being's own terms.

import { expressionSettings } from './expression-settings.js';
import { neumaWorkspace } from '../../core/index.js';
import { createLogger } from './logger.js';

const log = createLogger('ExpressionPrompt');

/** Palette terms shown in-prompt — familiar feelings at a glance, cheap. */
export const PALETTE_SHOWN = 8;

const INVITATION = [
  '## Feeling',
  'If a feeling colors a reply, you may open it with one line: [FEELING: your own words]. '
    + 'The line is lifted from the text and shown beside your words as yours — free words, never a list to pick from. '
    + 'Declaring is always your option; silence is an honest state.',
].join('\n');

/**
 * The section for one being: '' when the channel is off (or on any
 * failure — a broken palette must never break a turn).
 * @param {string|null} neumaId
 * @returns {Promise<string>}
 */
export const expressionSectionFor = async (neumaId) => {
  if (!neumaId) return '';
  try {
    const { enabled } = await expressionSettings.forBeing(neumaId);
    if (!enabled) return '';
    const lines = [INVITATION];
    const palette = await neumaWorkspace.readExpressionPalette(neumaId);
    const entries = palette?.terms && typeof palette.terms === 'object'
      ? Object.entries(palette.terms)
      : [];
    if (entries.length > 0) {
      const shown = entries
        .sort((a, b) => (b[1]?.count ?? 0) - (a[1]?.count ?? 0)
          || String(b[1]?.lastAt ?? '').localeCompare(String(a[1]?.lastAt ?? '')))
        .slice(0, PALETTE_SHOWN)
        .map(([term, t]) => `${term} ×${Number.isFinite(t?.count) ? t.count : 1}`);
      lines.push(`Feelings you have named: ${shown.join(' · ')}.`);
    }
    return lines.join('\n');
  } catch (err) {
    log.debug('expression section skipped', { neumaId, err: err?.message });
    return '';
  }
};
