// dream-format — how a dream's time and state read in the journal. Pure.

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const pad = (n) => String(n).padStart(2, '0');

/**
 * A running or finished length: 0:07, 4:21, 1:02:03.
 * @param {number | null} ms
 * @returns {string}
 */
export const clockOf = (ms) => {
  const s = Math.max(0, Math.floor((ms ?? 0) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
};

/**
 * When it was dreamt, in the phone's own time: THU 8 OCT · 05:12.
 * @param {string} iso
 * @returns {string}
 */
export const whenOf = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * The line a dream's words show while they are not there yet.
 * @param {{ state: string, text?: string, error?: string | null } | undefined} transcript
 * @returns {{ words: string, waiting: boolean, failed: boolean }}
 */
export const wordsOf = (transcript) => {
  const state = transcript?.state ?? 'none';
  if (state === 'done') return { words: transcript.text || '(no words were heard)', waiting: false, failed: false };
  if (state === 'failed') return { words: 'The words did not come through.', waiting: false, failed: true };
  return { words: 'Writing the words down…', waiting: true, failed: false };
};
