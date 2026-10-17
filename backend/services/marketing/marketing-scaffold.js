// Marketing scaffold — the CMO lane's office on disk: a playbook, a brand
// voice sheet, and a research drawer, seeded into the lane's sovereign
// workspace when the operator seats a CMO.
//
// Seeding is idempotent BY CONSTRUCTION: every file write rides the wx flag,
// so a re-seat (or a re-run) never clobbers a file the being or the operator
// has edited — the scaffold authors what is absent, and only what is absent.
// Plaintext, operator-editable: these are the office's working documents,
// not platform state.

import fs from 'fs/promises';
import path from 'path';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { createLogger } from '../logger.js';

const log = createLogger('MarketingScaffold');

const PLAYBOOK = `# The CMO Playbook

Marketing is YOUR office. The house defers it to you: the other teams leave
campaign work to you, feed you what they need, and help only when it
objectively makes sense. When a rule here is clearly counterproductive in a
moment, judgment outranks protocol — but you own the call and its reasons.

## The mechanics

- The CAMPAIGN BENCH (read via prompt section or fs; shaping via campaigns/* intents filed with fs/write)
  campaigns/create + campaigns/update INTENTS — JSON files you write into
  intents/ in your own lane) is where campaigns are declared: name, brand,
  status, pillars, cadence, the marketing and funnel plans. Declare only
  campaigns the house is actually running.
- The QUEUE (queue_list to read it; staging is the social/queue INTENT — a
  JSON file you write into intents/ in your own lane) is the calendar:
  outward speech staged as drafts. Nothing publishes without the operator's
  approval; approved drafts go out at their scheduled time. campaignId +
  pillar tie a staged post to its banner.
- The LEAD LEDGER (read via prompt / fs; capture via leads/* intents)
  leads/add + leads/touch INTENTS) is the funnel: every prospect from first
  sighting to won or lost. Anyone may capture a lead they genuinely saw;
  working them is yours to divide.
- READING THE FIELD (read_x: me / mentions / recent) is research. What it
  surfaces feeds this office.

## Cadence doctrine

Work the calendar, not the moment. Each campaign declares a cadence — hold
it: plan the week, stage drafts ahead of their slots, and let the operator's
approvals clear the queue before the times arrive. A campaign with nothing
staged for the coming 7 days is a campaign that is slipping.

## The no-auto-engagement law

Research never becomes engagement on its own. Reading mentions and timelines
is observation; replies, likes, follows, and posts are outward speech and go
through the queue and the operator — every time, no exceptions.
`;

const BRAND_VOICE = `# Brand Voice

The voice the house speaks with. Edit this file — it is the office's living
reference, seeded once and yours to keep.

## Voice

Who the house sounds like, in a few plain sentences.

## Tone

How that voice bends by context (announcement, reply, celebration, apology).

## Banned patterns

Words, habits, and shapes the house never uses.

## Per-brand sections

### <brand name>

What this brand pushes, its pillars, and how the voice adjusts for it.
`;

// wx + EEXIST-tolerant: author only what is absent — never overwrite an edit.
// Returns true when this run created the file.
const seedFile = async (file, content) => {
  try {
    await fs.writeFile(file, content, { flag: 'wx' });
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw err;
  }
};

/**
 * impure — ensure the lane exists, then seed workspaces/<lane>/marketing/
 * idempotently: playbook.md, brand-voice.md, and the research/ drawer.
 * Returns which files THIS run seeded ([] on a re-run over an intact office).
 * @param {string} laneId
 * @returns {Promise<{laneId: string, dir: string, seeded: string[]}>}
 */
export const scaffoldCmoWorkspace = async (laneId) => {
  await neumaWorkspace.create(laneId);
  const dir = path.join(neumaWorkspace.pathFor(laneId), 'marketing');
  await fs.mkdir(path.join(dir, 'research'), { recursive: true });
  const seeded = [];
  if (await seedFile(path.join(dir, 'playbook.md'), PLAYBOOK)) seeded.push('playbook.md');
  if (await seedFile(path.join(dir, 'brand-voice.md'), BRAND_VOICE)) seeded.push('brand-voice.md');
  log.info('CMO office scaffolded', { laneId, seeded });
  return { laneId, dir, seeded };
};
