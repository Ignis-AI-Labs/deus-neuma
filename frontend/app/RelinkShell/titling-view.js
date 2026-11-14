// titling-view — what a batch titling job says on the desk (deus-neuma #28): how far it has got,
// about how long is left, and how it ended. Pure.

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * About how long the job has left, from its own pace so far; '' until two chats have landed (the
 * batch waits behind live turns, so one chat says little about the rest). Pure.
 * @param {{done: number, total: number, startedAt: string}} job
 * @param {number} nowMs
 */
export const timeLeft = (job, nowMs) => {
  if (!job || job.done < 2 || job.done >= job.total) return '';
  const each = (nowMs - Date.parse(job.startedAt)) / job.done;
  const left = Math.round((each * (job.total - job.done)) / 1000);
  if (!Number.isFinite(left) || left <= 0) return '';
  return left < 60 ? `ABOUT ${left} S LEFT` : `ABOUT ${Math.round(left / 60)} MIN LEFT`;
};

/**
 * The line under the list: progress while it runs, then how it ended; a request that failed says
 * so (it used to read as "nothing to name"). `what` names the things: ['CHAT', 'CHATS']. Pure.
 * @param {?object} job
 * @param {?string} error - a start that failed
 * @param {number} nowMs
 * @param {[string, string]} what
 */
export const titlingNote = (job, error, nowMs, what = ['CHAT', 'CHATS']) => {
  if (error) return `TITLING FAILED — ${String(error).toUpperCase()}`;
  if (!job) return '';
  const named = plural(job.titled, ...what);
  if (job.state === 'running') return [`NAMING ${job.done} / ${job.total}`, timeLeft(job, nowMs)].filter(Boolean).join(' · ');
  if (job.state === 'failed') return `TITLING FAILED — ${String(job.error || 'unknown').toUpperCase()}`;
  if (job.state === 'cancelled') return `STOPPED — NAMED ${named}`;
  if (job.skipped === job.total && job.skipReason === 'no-route') return 'NO MODEL TO NAME WITH — CONNECT ONE IN SUBSTRATE';
  // nothing pending, or only chats with no words said in them
  if (job.titled === 0 && job.failed === 0) return 'NOTHING TO NAME';
  return job.failed > 0 ? `NAMED ${named} · ${job.failed} FAILED` : `NAMED ${named}`;
};
