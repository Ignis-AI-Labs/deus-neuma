// Pure FunctionGemma grammar: recursive containers and paired <escape> strings.
// Invalid/incomplete calls are refused; resource bounds protect the shared decoder.
const START = '<start_function_call>';
const END = '<end_function_call>';
const ESCAPE = '<escape>';
const MAX_TEXT = 1024 * 1024;
const MAX_DEPTH = 64;

/** Find a block terminator outside escaped literals; return its end offset or -1. */
export const functionGemmaClose = (text, close) => {
  let cursor = 0;
  while (cursor < text.length) {
    const end = text.indexOf(close, cursor);
    if (end < 0) return -1;
    const escape = text.indexOf(ESCAPE, cursor);
    if (escape < 0 || escape > end) return end + close.length;
    const escapedEnd = text.indexOf(ESCAPE, escape + ESCAPE.length);
    if (escapedEnd < 0) return -1;
    cursor = escapedEnd + ESCAPE.length;
  }
  return -1;
};

const scalar = (raw) => {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw)) {
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error('Non-finite FunctionGemma number');
    return value;
  }
  return raw;
};

const parseArgs = (text) => {
  let cursor = 0;
  const fail = () => { throw new Error('Malformed FunctionGemma arguments'); };
  const space = () => { while (/\s/.test(text[cursor] || '') && cursor < text.length) cursor++; };
  const escaped = () => {
    cursor += ESCAPE.length;
    const end = text.indexOf(ESCAPE, cursor);
    if (end < 0) return fail();
    const value = text.slice(cursor, end);
    cursor = end + ESCAPE.length;
    return value;
  };
  const value = (depth) => {
    if (depth > MAX_DEPTH) return fail();
    space();
    if (text.startsWith(ESCAPE, cursor)) return escaped();
    const head = text[cursor];
    if (head === '{' || head === '[') {
      cursor++;
      const object = head === '{';
      const close = object ? '}' : ']';
      const result = object ? {} : [];
      space();
      if (text[cursor] === close) { cursor++; return Object.freeze(result); }
      for (;;) {
        space();
        let key;
        if (object) {
          if (text.startsWith(ESCAPE, cursor)) key = escaped();
          else {
            const start = cursor;
            while (cursor < text.length && !/[\s:{}[\],<>]/.test(text[cursor])) cursor++;
            key = text.slice(start, cursor);
          }
          space();
          if (!key || text[cursor++] !== ':' || Object.hasOwn(result, key)) return fail();
        }
        const item = value(depth + 1);
        if (object) Object.defineProperty(result, key, { value: item, enumerable: true });
        else result.push(item);
        space();
        if (text[cursor] === close) { cursor++; return Object.freeze(result); }
        if (text[cursor++] !== ',') return fail();
      }
    }
    const start = cursor;
    while (cursor < text.length && !/[,}\]]/.test(text[cursor])) cursor++;
    const raw = text.slice(start, cursor).trim();
    if (!raw || /[{}[<>]/.test(raw)) return fail();
    return scalar(raw);
  };
  const args = value(0);
  space();
  if (cursor !== text.length || !args || Array.isArray(args) || typeof args !== 'object') return fail();
  return args;
};

/** Decode complete calls without throwing or executing model-supplied text. */
export const parseFunctionGemmaCalls = (text) => {
  if (typeof text !== 'string' || text.length > MAX_TEXT) return Object.freeze([]);
  const calls = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf(START, cursor);
    if (start < 0) break;
    const contentStart = start + START.length;
    const length = functionGemmaClose(text.slice(contentStart), END);
    if (length < 0) break;
    cursor = contentStart + length;
    const content = text.slice(contentStart, cursor - END.length).trim();
    const head = /^call:([A-Za-z0-9_-]+)\s*/.exec(content);
    if (!head) continue;
    try {
      const tail = content.slice(head[0].length);
      const args = tail ? parseArgs(tail) : Object.freeze({});
      calls.push(Object.freeze({ name: head[1], args }));
    } catch { /* malformed call is not an executable act */ }
  }
  return Object.freeze(calls);
};
