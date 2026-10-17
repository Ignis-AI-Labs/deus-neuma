/**
 * Recover legacy display previews only, before compiling a fresh silo.
 * UTF-16 slicing once split emoji in tool chips. Source history stays intact;
 * authored speech and identity still cross the strict canonical validator.
 * @param {Object<string, Array<Object>>} sessions
 * @returns {{sessions: Object, repairs: Array<Object>}} Copied previews and provenance.
 */
export const repairSessionToolText = (sessions) => {
  const repairs = [];
  const repaired = Object.fromEntries(Object.entries(sessions).map(([sessionId, rows]) => [
    sessionId,
    Array.isArray(rows) ? rows.map((row, rowIndex) => {
      if (!Array.isArray(row?.tools)) return row;
      return { ...row, tools: row.tools.map((tool, toolIndex) => {
        let result = tool;
        for (const field of ['summary', 'detail']) {
          if (typeof tool?.[field] !== 'string') continue;
          const text = tool[field].toWellFormed();
          if (text === tool[field]) continue;
          result = { ...result, [field]: text };
          repairs.push({ sessionId, row: rowIndex, tool: toolIndex, field, replacement: 'U+FFFD' });
        }
        return result;
      }) };
    }) : rows,
  ]));
  return Object.freeze({ sessions: repaired, repairs: Object.freeze(repairs) });
};
