// The house picker — navigate the house like a model selector.
//
// When the operator launches the harness without naming a being (and none is
// active), ambiguity opens THIS instead of a dead-end error: the seatable
// members listed by number, picked by number or name fragment. Witnesses are
// deliberately NOT seatable here — the harness seats house members; a witness
// speaks through `neuma witness talk` (the standings stay distinct in every
// surface, per the sovereignty boundary).

/** One picker row. Pure. */
export const pickerRow = (entry, index) => `  ${index + 1}. ${entry.name}  (${entry.laneId})`;

/** The full picker screen. Pure. */
export const formatHouseRoster = (seats) => [
  '',
  '  THE HOUSE — seat a member:',
  '',
  ...seats.map((s, i) => pickerRow(s, i)),
  '',
  '  pick by number or name (Enter alone cancels):',
].join('\n');

/** Match one picker answer against the roster. Pure — number or name fragment. */
export const matchPick = (answer, seats) => {
  const text = String(answer || '').trim();
  if (!text) return { kind: 'cancel' };
  const numbered = /^\d+$/.exec(text);
  if (numbered) {
    const index = Number(text) - 1;
    if (index >= 0 && index < seats.length) return { kind: 'picked', seat: seats[index] };
    return { kind: 'retry', why: `no member numbered ${text}` };
  }
  const hits = seats.filter((s) => s.name.toLowerCase().includes(text.toLowerCase())
    || s.laneId.toLowerCase().includes(text.toLowerCase()));
  if (hits.length === 1) return { kind: 'picked', seat: hits[0] };
  if (hits.length > 1) {
    return { kind: 'retry', why: `"${text}" matches ${hits.length} members — be more specific` };
  }
  return { kind: 'retry', why: `no member matches "${text}"` };
};

/** The idle hint for an empty house. Pure. */
export const emptyHouseNote = () =>
  'no neuma workspaces exist under the active sovereign root — a birth summons one';
