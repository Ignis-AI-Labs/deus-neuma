/**
 * mapview/channels — PURE channel-site extraction. Given one source file's
 * text, find every message-channel touch: WS frames, Electron IPC, emitters,
 * DOM CustomEvents, dispatch helpers and dispatch tables. Split out of
 * extract.js under the size law (the same move that carried buildUsage into
 * reach.js) — extract.js imports from here, never the reverse.
 *
 * Regex-based on purpose, same doctrine as extract.js: message-type literals
 * are highly regular, which keeps this dependency-free.
 */

/** The 1-based line number of a character index in text. Pure. */
export const lineOf = (text, index) => {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
};

/**
 * Channel sites: [{ name, role: 'producer'|'consumer', line }]. Covers WS
 * (type:'ns:verb' / case 'ns:verb': / .send / .on), Electron IPC (.invoke /
 * .handle), emitters, and object-key dispatch maps ('ns:verb':). Pure.
 */
export const extractChannels = (text) => {
  const out = [];
  const scan = (re, role, group) => {
    let m;
    while ((m = re.exec(text))) out.push({ name: m[group], role, line: lineOf(text, m.index) });
  };
  scan(/\btype\s*:\s*['"]([a-z][\w-]*(?::[\w-]+)+)['"]/gi, 'producer', 1);
  scan(/\bcase\s+['"]([a-z][\w-]*(?::[\w-]+)+)['"]\s*:/gi, 'consumer', 1);
  scan(/\.type\s*===?\s*['"]([a-z][\w-]*(?::[\w-]+)+)['"]/gi, 'consumer', 1);
  // .sendSync is the synchronous Electron IPC producer; CustomEvent is the DOM
  // producer paired with addEventListener — both were false "severed" without these.
  scan(/\.(send|sendSync|emit|publish|broadcast|invoke)\(\s*['"]([a-z][\w-]*(?::[\w-]+)+)['"]/gi, 'producer', 2);
  // DISPATCH HELPER: `send(connection, 'ns:verb', payload)` — a bare function,
  // with the channel as a LATER argument, wrapping the real socket write. The
  // patterns above only see a METHOD whose FIRST argument is the channel, so
  // this whole idiom was invisible: council-session.js emits eight channels this
  // way and the entire (shipped, live-proven) COUNCIL feature reported as dead
  // listeners. A false "disconnected" on working code is the finding that
  // teaches an operator to stop trusting the map, so it costs more than a miss.
  // Kept tight: a send-ish callee, then a channel-shaped literal within the
  // first two arguments — no `.` before the name, so methods stay with the
  // pattern above and are not double-counted.
  scan(/(?<![.\w])(?:send|emit|publish|broadcast|dispatch)\w*\(\s*[^()'"`,]{1,60},\s*['"]([a-z][\w-]*(?::[\w-]+)+)['"]/gi, 'producer', 1);
  // …and the same bare helpers with the channel as the FIRST argument
  // (`send('ns:verb', payload)` — held-word.js emits the queue channels this
  // way), which neither the method pattern (needs a `.`) nor the helper
  // pattern above (needs a leading socket argument) could see.
  scan(/(?<![.\w])(?:send|emit|publish|broadcast|dispatch)\w*\(\s*['"]([a-z][\w-]*(?::[\w-]+)+)['"]/gi, 'producer', 1);
  scan(/\bCustomEvent\(\s*['"]([a-z][\w-]*(?::[\w-]+)+)['"]/gi, 'producer', 1);
  scan(/\.(on|once|subscribe|addEventListener|handle|handleOnce)\(\s*['"]([a-z][\w-]*(?::[\w-]+)+)['"]/gi, 'consumer', 2);
  // DISPATCH TABLE: `['ns:verb', handler]` tuples subscribed generically
  // (`entries.forEach(([ch, on]) => ws.on(ch, on))`). stream-message-handlers.js
  // registers ~30 channels this way and every one read as "no consumer" —
  // 21 of the 25 no-consumer findings in the 2026-08-20 triage were this one
  // shape. The second element must start a reference (identifier or inline
  // function), never a string — a string tuple is data, not a registration.
  scan(/\[\s*['"]([a-z][\w-]*(?::[\w-]+)+)['"]\s*,\s*[A-Za-z_$(]/gi, 'consumer', 1);
  // Object-key dispatch maps — but NOT a ternary's consequent (`ok ? 'a:b' :
  // fallback`), which is a reason-code VALUE the colon made look like a key.
  // Two refinement reason codes and a benchmark disposition string were
  // reported as consumed-but-never-emitted channels through that misread.
  scan(/(?<!\?\s{0,40})['"]([a-z][\w-]*(?::[\w-]+)+)['"]\s*:/gi, 'consumer', 1);
  // De-dupe sites that overlap (case + object-key can land on the same line).
  const uniq = new Map();
  for (const s of out) uniq.set(`${s.name}:${s.line}:${s.role}`, s);
  return [...uniq.values()];
};
