// Pure: tool-shaped safety patterns inspect fs destinations, not authored prose.
import { scanBalancedJson } from '../../core/runtime/tool-call-parser.js';
import { filesystemTargets } from './fs-tool-targets.js';

/** Project only strict, complete known filesystem envelopes. Unknown/malformed
 * text stays unchanged. Non-tool checks always see the original response. */
export const projectFilesystemToolText = (text, safeArgs) => {
  const head = /\[TOOL:\s*(fs|filesystem)\/([\w-]+)\s*(?=\{)/g;
  let output = '';
  let cursor = 0;
  let match;
  while ((match = head.exec(text))) {
    const start = head.lastIndex;
    const raw = scanBalancedJson(text, start);
    if (!raw) continue;
    const closer = /^\s*\]/.exec(text.slice(start + raw.length));
    if (!closer) continue;
    let args;
    try { args = JSON.parse(raw); } catch { continue; }
    const targets = filesystemTargets(match[1], match[2], args);
    if (!targets) continue;
    const end = start + raw.length + closer[0].length;
    const safe = safeArgs?.(match[1], match[2], args)?.safe === true;
    output += text.slice(cursor, match.index)
      + `[TOOL: ${match[1]}/${match[2]} ${JSON.stringify({ paths: safe ? [] : targets })}]`;
    cursor = end;
    head.lastIndex = end;
  }
  return output + text.slice(cursor);
};
