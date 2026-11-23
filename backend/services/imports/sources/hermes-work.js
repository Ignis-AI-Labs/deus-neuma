// Hermes Agent's work in progress, read against the real ~/.hermes (docs/work/assistant-import.md):
//   sessions/session_*.json {session_id, model, session_start, messages: [{role, content}]}
//   cron/jobs.json          {jobs: [{id, name, prompt, skills, schedule_display, enabled,
//                            last_run_at, deliver}]} — the shape its own cron/jobs.py writes
// (its memories, SOUL.md and skills are read in assistant-sources.js). impure (reads the disk)
import path from 'node:path';
import { fileNames, readPlain } from '../folder-read.js';

const SESSION_MAX = 50_000_000;

/** A Hermes message's words: a string as it is, a list of parts by their text. Pure. */
const hermesText = (content) => (typeof content === 'string' ? content
  : Array.isArray(content) ? content.map((p) => (typeof p === 'string' ? p : p?.text || '')).filter(Boolean).join('\n\n') : '');

/** A Hermes job as a scheduled entry. Pure. */
export const hermesJob = (j) => ({
  name: j.name || j.id, schedule: j.schedule_display || j.schedule?.display || '', prompt: j.prompt || '',
  enabled: j.enabled !== false, lastRun: j.last_run_at || null,
  deliver: j.deliver == null ? null : typeof j.deliver === 'string' ? j.deliver : JSON.stringify(j.deliver),
  skills: Array.isArray(j.skills) ? j.skills : j.skill ? [j.skill] : [],
});

/**
 * Hermes's sessions and scheduled jobs. impure
 * @param {string} root - ~/.hermes or a profile
 */
export const readHermesWork = async (root) => {
  const skipped = [];
  const conversations = [];
  for (const name of await fileNames(path.join(root, 'sessions'), /^session_.*\.json$/)) {
    const got = await readPlain(path.join(root, 'sessions', name), SESSION_MAX);
    if (!got) continue;
    if (got.skipped) { skipped.push({ file: `sessions/${name}`, why: got.skipped }); continue; }
    let s;
    try { s = JSON.parse(got.text); } catch { skipped.push({ file: `sessions/${name}`, why: 'not readable JSON' }); continue; }
    conversations.push({
      id: s.session_id || name, title: '', started: s.session_start,
      messages: (s.messages || []).filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ who: m.role === 'user' ? 'you' : 'assistant', text: hermesText(m.content) }))
        .filter((m) => m.text.trim()),
    });
  }
  const jobs = await readPlain(path.join(root, 'cron', 'jobs.json'));
  let scheduled = [];
  if (jobs?.text) {
    try {
      const data = JSON.parse(jobs.text);
      scheduled = (Array.isArray(data) ? data : data.jobs || []).map(hermesJob);
    } catch {
      skipped.push({ file: 'cron/jobs.json', why: 'not readable JSON' });
    }
  }
  return { conversations, scheduled, skipped };
};
