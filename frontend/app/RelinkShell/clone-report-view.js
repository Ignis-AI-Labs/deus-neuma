// clone-report-view — the WATCH line shadow clones send back when they finish in the background, read into parts (Founder,
// 2026-11-19, three clones' whole reports drawn as one run of raw text: […]). The being reads the whole report (backend/routes/portal-watch-delivery.js watchThought,
// shadow-clone.js cloneReport); the desk draws a line a clone — what it was for, whether it reached its goal, its first
// words — with every report whole one press away, rendered. Pure.

const HEAD = /^\[A WATCH YOU SET[^\]]*\]\s*Word from your (.+?) working in the background:\s*/s;
const TAIL = /\s*Tell your operator what they did and found, take up what they left for you, and carry on\.\s*$/;
const BLOCK = /^── CLONE (\d+): (.+?) ──$/m;

const firstLine = (s, max = 160) => {
  const plain = String(s ?? '').replace(/\*\*|__|`/g, '').replace(/^#+\s*/gm, '').replace(/\s+/g, ' ').trim();
  const sentence = (plain.match(/^.+?[.!?](?=\s|$)/) ?? [plain])[0];
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
};

/** pure — whether a clone says it reached its goal: 'reached', 'not-reached', 'stopped', or null when it does not say. */
const goalVerdict = (report) => {
  const top = String(report ?? '').slice(0, 300).replace(/\*\*/g, '');
  if (/^DID NOT FINISH/i.test(top.trim())) return 'stopped';
  if (/\b(goal (was )?not (yet )?reached|did not reach (my|the) goal|not reached)\b/i.test(top)) return 'not-reached';
  if (/\b(goal (was )?(reached|met|achieved|done)|reached (my|the) goal)\b/i.test(top)) return 'reached';
  return null;
};
export const VERDICT_WORDS = Object.freeze({ reached: 'GOAL REACHED', 'not-reached': 'GOAL NOT REACHED', stopped: 'DID NOT FINISH' });

/** pure — "1981" seconds as a person says it. */
export const tookWords = (seconds) => {
  const s = Number(seconds);
  if (!Number.isFinite(s)) return null;
  if (s < 90) return `${Math.round(s)}S`;
  const m = Math.round(s / 60);
  return m < 90 ? `${m} MIN` : `${Math.floor(m / 60)} H ${m % 60} MIN`;
};

/**
 * pure — a clones' WATCH text in parts, or null when it is not one.
 * @returns {null | {label: string, seconds: ?number, together: ?number, record: ?string,
 *   clones: Array<{index: number, title: string, goal: ?string, report: string, verdict: ?string, summary: string}>}}
 */
export const cloneReportOf = (text) => {
  const t = String(text ?? '');
  const head = HEAD.exec(t);
  if (!head || !BLOCK.test(t)) return null;
  const body = t.slice(head[0].length).replace(TAIL, '');
  const parts = body.split(BLOCK);
  const intro = parts[0];
  const clones = [];
  for (let i = 1; i + 2 < parts.length + 1; i += 3) {
    const raw = String(parts[i + 2] ?? '').trim();
    const goal = /^Goal: (.+)$/m.exec(raw)?.[1]?.trim() ?? null;
    const report = goal ? raw.replace(/^Goal: .+\n?/m, '').trim() : raw;
    clones.push({ index: Number(parts[i]), title: parts[i + 1].trim(), goal, report, verdict: goalVerdict(report), summary: firstLine(report.replace(/^\s*(\*\*)?\s*goal (was )?(not )?(yet )?(reached|met|achieved)\s*[.:!—-]*\s*(\*\*)?\s*/i, '')) || firstLine(report) });
  }
  const seconds = /reported in (\d+)s/.exec(intro)?.[1];
  const together = /\((\d+) at once at most\)/.exec(intro)?.[1];
  const record = /kept whole in (\S+?)\.?\s*$/m.exec(intro)?.[1] ?? null;
  return { label: head[1], seconds: seconds ? Number(seconds) : null, together: together ? Number(together) : null, record, clones };
};
