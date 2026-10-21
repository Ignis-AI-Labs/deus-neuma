// agenda-for-being.js — the house calendar as a being reads it (the
// calendar_read tool). A being helping its operator keep their time — the
// Optio first — reads the operator's schedule and every member's, plans
// around it, and moves what stands on the operator's list through
// tasks/operator-update (those lines carry the id it takes). Pure.

const KIND = Object.freeze({
  task: 'TASK', 'run-due': 'RUN DUE', run: 'TEAM RUN', charge: 'CHARGE', post: 'POST', wake: 'HOUSE WAKE',
  quiet: 'QUIET HOURS', security: 'SECURITY WATCH', legal: 'LEGAL WATCH', meditation: 'MEDITATION', vessel: 'VESSEL PLAN', bench: 'BENCHMARK',
});
const FIXED = Object.freeze({ me: 'OPERATOR', house: 'HOUSE', machine: 'MACHINE' });

/** The lane a `who` names: the operator, the house, the machine, a lane id, or a member's name (any case). */
export const laneOfWho = (who, lanes, names) => {
  const want = String(who || '').trim().toLowerCase();
  if (!want) return null;
  if (['operator', 'me', 'my operator'].includes(want)) return 'me';
  const hit = lanes.find((l) => l.id.toLowerCase() === want || String(names.get(l.id) || '').toLowerCase() === want);
  return hit ? hit.id : undefined;
};

const dayHead = (key) => {
  const d = new Date(`${key}T00:00:00`);
  return `${d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()} ${key}`;
};

// an operator-list task's own id, for tasks/operator-update (prefix 8)
const operatorTaskId = (item) => (item.source === 'task' && item.lane === 'me' ? String(item.id).split(':')[2]?.slice(0, 8) : null);

/**
 * @param {{from: string, to: string, lanes: Array<{id: string}>, items: Array<object>, standing: Array<object>, gaps: Array<object>}} agenda
 * @param {Map<string, string>} names - lane id → display name
 * @param {{lane?: ?string}} [opts] - one row only, or everyone
 * @returns {string}
 */
export const formatAgendaForBeing = (agenda, names, { lane = null } = {}) => {
  const nameOf = (id) => FIXED[id] || names.get(id) || id;
  const items = lane ? agenda.items.filter((i) => i.lane === lane) : agenda.items;
  const head = `HOUSE CALENDAR ${agenda.from} → ${agenda.to} (local time) · ${lane ? nameOf(lane) : 'everyone'}`;
  if (!items.length) return `${head}\nNothing scheduled in this window.`;
  const lines = [head, '(~ = expected — worked out from a rhythm, not on record yet; [id] = on your operator\'s list: movable with tasks/operator-update, removable with tasks/operator-drop at their yes)'];
  let day = null;
  for (const item of items) {
    if (item.day !== day) { day = item.day; lines.push('', dayHead(day)); }
    const when = item.time ? (item.endTime ? `${item.time}–${item.endTime}` : item.time) : 'all day';
    const id = operatorTaskId(item);
    const status = item.status ? ` (${item.status})` : '';
    lines.push(`  ${when.padEnd(11)} ${item.projected ? '~ ' : ''}${nameOf(item.lane)} · ${KIND[item.source] || item.source} · ${item.title}${item.channel ? ` [${item.channel}]` : ''}${id ? ` [${id}]` : ''}${status}${item.held ? ` — waits: ${item.held}` : ''}`);
  }
  if (agenda.gaps.length) lines.push('', `NOT READ (missing, not empty): ${agenda.gaps.map((g) => g.source).join(', ')}`);
  return lines.join('\n');
};
