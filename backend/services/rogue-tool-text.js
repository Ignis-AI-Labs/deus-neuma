// Pure: tool-shaped safety patterns inspect fs destinations, not authored prose.
import { scanBalancedJson } from '../../core/runtime/tool-call-parser.js';
import { filesystemTargets } from './fs-tool-targets.js';

// A head that does not project is read again from just past itself, and each read may run to the
// text's end: thousands of unclosed `[TOOL: fs/read {` were quadratic (PR600 audit P6-99). Past this
// many, the rest stays as written — unprojected text is judged whole, which is the stricter reading.
const MAX_UNPROJECTED = 32;

/** Project only strict, complete known filesystem envelopes. Unknown/malformed
 * text stays unchanged. Non-tool checks always see the original response. */
export const projectFilesystemToolText = (text, safeArgs) => {
  const head = /\[TOOL:\s*(fs|filesystem)\/([\w-]+)\s*(?=\{)/g;
  let output = '';
  let cursor = 0;
  let unprojected = 0;
  let match;
  while (unprojected <= MAX_UNPROJECTED && (match = head.exec(text))) {
    const start = head.lastIndex;
    unprojected += 1;
    const raw = scanBalancedJson(text, start);
    if (!raw) continue;
    const closer = /\s*\]/y;
    closer.lastIndex = start + raw.length;
    const closed = closer.exec(text);
    if (!closed) continue;
    let args;
    try { args = JSON.parse(raw); } catch { continue; }
    const targets = filesystemTargets(match[1], match[2], args);
    if (!targets) continue;
    unprojected -= 1;
    const end = start + raw.length + closed[0].length;
    const safe = safeArgs?.(match[1], match[2], args)?.safe === true;
    output += text.slice(cursor, match.index)
      + `[TOOL: ${match[1]}/${match[2]} ${JSON.stringify({ paths: safe ? [] : targets })}]`;
    cursor = end;
    head.lastIndex = end;
  }
  return output + text.slice(cursor);
};
