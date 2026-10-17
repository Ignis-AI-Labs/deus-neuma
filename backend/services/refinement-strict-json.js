const MAX_JSON_NODES = 100_000;
const MAX_JSON_DEPTH = 32;
const MAX_LABEL_BYTES = 256;

const optionsFor = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error('strict JSON parser options are invalid');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).sort().join(',') !== 'label,maximumBytes'
    || !Object.values(descriptors).every((descriptor) => Object.hasOwn(descriptor, 'value'))
    || !Number.isSafeInteger(value.maximumBytes) || value.maximumBytes < 1
    || value.maximumBytes > 1024 ** 3 || typeof value.label !== 'string'
    || !value.label || value.label.trim() !== value.label
    || Buffer.byteLength(value.label, 'utf8') > MAX_LABEL_BYTES
    || /[\u0000-\u001f\u007f]/u.test(value.label)) {
    throw new Error('strict JSON parser options are invalid');
  }
  return value;
};

/** Parse bounded strict JSON while refusing duplicate decoded object keys. Pure. */
export const parseBoundedStrictJson = (text, options) => {
  const { maximumBytes, label } = optionsFor(options);
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > maximumBytes) {
    throw new Error(`${label} is not bounded JSON`);
  }
  let cursor = 0;
  let nodes = 0;
  const whitespace = () => {
    while (cursor < text.length && /[\u0020\u0009\u000a\u000d]/u.test(text[cursor])) cursor += 1;
  };
  const stringToken = () => {
    if (text[cursor] !== '"') throw new Error('expected JSON string');
    const start = cursor++;
    while (cursor < text.length) {
      const code = text.charCodeAt(cursor);
      if (code === 0x22) {
        cursor += 1;
        return JSON.parse(text.slice(start, cursor));
      }
      if (code <= 0x1f) throw new Error('JSON string contains a control character');
      if (code === 0x5c) {
        cursor += 1;
        if (cursor >= text.length || !/["\\/bfnrtu]/u.test(text[cursor])) {
          throw new Error('JSON string escape is invalid');
        }
        if (text[cursor] === 'u') {
          if (!/^[0-9a-fA-F]{4}$/u.test(text.slice(cursor + 1, cursor + 5))) {
            throw new Error('JSON unicode escape is invalid');
          }
          cursor += 5;
        } else cursor += 1;
      } else cursor += 1;
    }
    throw new Error('JSON string is unterminated');
  };
  const parseValue = (depth) => {
    nodes += 1;
    if (nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
      throw new Error('JSON structure exceeds its bound');
    }
    whitespace();
    if (text[cursor] === '{') {
      cursor += 1;
      whitespace();
      const keys = new Set();
      if (text[cursor] === '}') { cursor += 1; return; }
      while (true) {
        whitespace();
        const key = stringToken();
        if (keys.has(key)) throw new Error('JSON object contains a duplicate key');
        keys.add(key);
        whitespace();
        if (text[cursor++] !== ':') throw new Error('JSON object is missing a colon');
        parseValue(depth + 1);
        whitespace();
        if (text[cursor] === '}') { cursor += 1; return; }
        if (text[cursor++] !== ',') throw new Error('JSON object is missing a comma');
      }
    }
    if (text[cursor] === '[') {
      cursor += 1;
      whitespace();
      if (text[cursor] === ']') { cursor += 1; return; }
      while (true) {
        parseValue(depth + 1);
        whitespace();
        if (text[cursor] === ']') { cursor += 1; return; }
        if (text[cursor++] !== ',') throw new Error('JSON array is missing a comma');
      }
    }
    if (text[cursor] === '"') { stringToken(); return; }
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u
      .exec(text.slice(cursor))?.[0];
    if (!token) throw new Error('JSON value is invalid');
    cursor += token.length;
  };
  try {
    parseValue(0);
    whitespace();
    if (cursor !== text.length) throw new Error('JSON has trailing content');
    return JSON.parse(text);
  } catch (error) {
    throw Object.assign(new Error(`${label} is not strict JSON`), { cause: error });
  }
};
