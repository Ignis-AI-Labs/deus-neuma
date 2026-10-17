/**
 * Storage warning display logic — pure. The heartbeat pushes a
 * storage:warning frame every cycle the workspace home's headroom is
 * low/critical; these decide what the witness reads and when repeating
 * frames deserve a repeated announcement (a long sitting must not fill
 * the chat with the same warning every pulse).
 */

// pure — the witness-facing line for a storage assessment frame
export const storageWarningText = (data) => {
  const free = typeof data?.freeGB === 'number'
    ? `${data.freeGB} GB free`
    : 'unmeasurable space';
  if (data?.level === 'critical') {
    return `Storage critical — ${free} at the workspace home. Writes are about to fail and memory can be lost. Free space or grow the workspace home now.`;
  }
  return `Storage low — ${free} at the workspace home (${data?.recommendedGB ?? 10} GB recommended). Consider freeing space or growing the workspace home.`;
};

// pure — announce the first warning, any level change, and each further
// whole-gigabyte drop; stay silent for a repeat of the same picture
export const shouldAnnounceStorage = (prev, next) => {
  if (!next) return false;
  if (!prev) return true;
  if (prev.level !== next.level) return true;
  const prevGB = typeof prev.freeGB === 'number' ? Math.floor(prev.freeGB) : null;
  const nextGB = typeof next.freeGB === 'number' ? Math.floor(next.freeGB) : null;
  return prevGB !== null && nextGB !== null && nextGB < prevGB;
};
