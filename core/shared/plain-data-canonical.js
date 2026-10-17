import crypto from 'node:crypto';
import { types as utilTypes } from 'node:util';

const SHA256 = /^[a-f0-9]{64}$/;
const AUTHORITY_DOMAIN = /^[a-z0-9][a-z0-9.-]{0,127}$/;
export const PLAIN_DATA_LIMITS = Object.freeze({
  maxDepth: 64,
  maxNodes: 250_000,
  maxStringBytes: 8 * 1024 * 1024,
  maxKeyBytes: 64 * 1024,
  maxOutputBytes: 32 * 1024 * 1024,
  rejectAliases: true,
});

const boundedOptions = (input = {}) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('plain-data options must be a trusted object');
  }
  const options = {
    ...PLAIN_DATA_LIMITS,
    field: '$',
    rejectKey: null,
    rejectString: null,
    ...input,
  };
  for (const name of [
    'maxDepth', 'maxNodes', 'maxStringBytes', 'maxKeyBytes', 'maxOutputBytes',
  ]) {
    const minimum = name === 'maxDepth' ? 0 : 1;
    if (!Number.isSafeInteger(options[name]) || options[name] < minimum) {
      throw new Error(`plain-data ${name} must be a safe integer at least ${minimum}`);
    }
  }
  if (typeof options.field !== 'string' || !options.field) {
    throw new Error('plain-data field must be a nonempty string');
  }
  if (typeof options.rejectAliases !== 'boolean') {
    throw new Error('plain-data rejectAliases must be boolean');
  }
  if (options.rejectKey !== null && typeof options.rejectKey !== 'function') {
    throw new Error('plain-data rejectKey must be a function');
  }
  if (options.rejectString !== null && typeof options.rejectString !== 'function') {
    throw new Error('plain-data rejectString must be a function');
  }
  return options;
};

const stringMetrics = (value, field) => {
  let utf8Bytes = 0;
  let jsonBytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        throw new Error(`${field} contains an unpaired surrogate`);
      }
      index += 1;
      utf8Bytes += 4;
      jsonBytes += 4;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error(`${field} contains an unpaired surrogate`);
    } else {
      utf8Bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : 3;
      if (code === 0x22 || code === 0x5c || code === 0x08 || code === 0x09
        || code === 0x0a || code === 0x0c || code === 0x0d) jsonBytes += 2;
      else if (code <= 0x1f) jsonBytes += 6;
      else jsonBytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : 3;
    }
  }
  return { utf8Bytes, jsonBytes };
};

const reflectContainer = (value, field) => {
  let proxy;
  try {
    proxy = utilTypes.isProxy(value);
  } catch {
    throw new Error(`${field} refused plain-data proxy inspection`);
  }
  if (proxy) throw new Error(`${field} must be a data-only non-Proxy container`);
  let array;
  let prototype;
  try {
    array = Array.isArray(value);
    prototype = Reflect.getPrototypeOf(value);
  } catch {
    throw new Error(`${field} refused plain-data prototype inspection`);
  }
  if (array ? prototype !== Array.prototype
    : prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${field} must be an Array or plain/null-prototype record`);
  }
  let keys;
  let descriptors;
  try {
    keys = Reflect.ownKeys(value);
    descriptors = keys.map((key) => Reflect.getOwnPropertyDescriptor(value, key));
  } catch {
    throw new Error(`${field} refused plain-data own-property inspection`);
  }
  const entries = [];
  let length = null;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const descriptor = descriptors[index];
    if (typeof key !== 'string') throw new Error(`${field} contains a symbol key`);
    if (!descriptor || !('value' in descriptor)) {
      throw new Error(`${field} properties must be own data descriptors`);
    }
    if (array && key === 'length') length = descriptor.value;
    else {
      if (!descriptor.enumerable) {
        throw new Error(`${field} properties must be enumerable data values`);
      }
      entries.push({ key, value: descriptor.value });
    }
  }
  if (array && (!Number.isSafeInteger(length) || length < 0 || entries.length !== length
    || entries.some(({ key }, index) => key !== String(index)))) {
    throw new Error(`${field} contains a sparse or non-JSON array`);
  }
  return { array, entries };
};


const rejection = (policy, value, field) => {
  const reason = policy?.(value, field);
  if (reason) throw new Error(`${field} ${typeof reason === 'string' ? reason : 'is rejected'}`);
};

const inspectPlainData = (root, input, collectText) => {
  const options = boundedOptions(input);
  const stack = [{ kind: 'value', value: root, depth: 0, field: options.field }];
  const active = new WeakSet();
  const observed = new WeakSet();
  const containers = [];
  const parts = collectText ? [] : null;
  let scheduledNodes = 1;
  let outputBytes = 0;
  const append = (text, bytes = text.length) => {
    if (bytes > options.maxOutputBytes - outputBytes) {
      throw new Error(`${options.field} exceeds the plain-data UTF-8 output limit`);
    }
    outputBytes += bytes;
    if (parts) parts.push(text);
  };
  const appendQuoted = (value, bytes, suffix = '') => {
    if (bytes + suffix.length > options.maxOutputBytes - outputBytes) {
      throw new Error(`${options.field} exceeds the plain-data UTF-8 output limit`);
    }
    outputBytes += bytes + suffix.length;
    if (parts) {
      parts.push(JSON.stringify(value));
      if (suffix) parts.push(suffix);
    }
  };
  while (stack.length) {
    const frame = stack.pop();
    if (frame.kind === 'leave') {
      active.delete(frame.value);
      continue;
    }
    if (frame.kind === 'token') {
      append(frame.text);
      continue;
    }
    if (frame.kind === 'key') {
      appendQuoted(frame.value, frame.jsonBytes, ':');
      continue;
    }
    const { value, depth, field } = frame;
    if (depth > options.maxDepth) throw new Error(`${field} exceeds the plain-data depth limit`);
    if (value === null) append('null');
    else if (typeof value === 'string') {
      const metrics = stringMetrics(value, field);
      if (metrics.utf8Bytes > options.maxStringBytes) {
        throw new Error(`${field} exceeds the plain-data string limit`);
      }
      rejection(options.rejectString, value, field);
      appendQuoted(value, metrics.jsonBytes);
    } else if (typeof value === 'boolean') append(value ? 'true' : 'false');
    else if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error(`${field} must be a finite JSON number`);
      append(JSON.stringify(value));
    } else if (typeof value !== 'object') {
      throw new Error(`${field} is not an RFC 8785 JSON value`);
    } else {
      if (active.has(value)) throw new Error(`${field} contains a cycle`);
      if (observed.has(value) && options.rejectAliases) {
        throw new Error(`${field} contains a shared-object alias`);
      }
      const reflected = reflectContainer(value, field);
      observed.add(value);
      active.add(value);
      containers.push({ value, field });
      scheduledNodes += reflected.entries.length;
      if (scheduledNodes > options.maxNodes) {
        throw new Error(`${options.field} exceeds the plain-data node limit`);
      }
      if (reflected.entries.length && depth >= options.maxDepth) {
        throw new Error(`${field} exceeds the plain-data depth limit`);
      }
      const entries = reflected.array ? reflected.entries : reflected.entries.map((entry) => {
        const keyField = `${field}.${entry.key}`;
        const metrics = stringMetrics(entry.key, `${field} key`);
        if (metrics.utf8Bytes > options.maxKeyBytes) {
          throw new Error(`${field} contains an oversized JSON key`);
        }
        rejection(options.rejectKey, entry.key, keyField);
        return { ...entry, field: keyField, jsonBytes: metrics.jsonBytes };
      }).sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
      append(reflected.array ? '[' : '{');
      stack.push({ kind: 'leave', value });
      stack.push({ kind: 'token', text: reflected.array ? ']' : '}' });
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        stack.push({
          kind: 'value',
          value: entry.value,
          depth: depth + 1,
          field: reflected.array ? `${field}[${index}]` : entry.field,
        });
        if (!reflected.array) {
          stack.push({ kind: 'key', value: entry.key, jsonBytes: entry.jsonBytes });
        }
        if (index > 0) stack.push({ kind: 'token', text: ',' });
      }
    }
  }
  return { containers, text: parts?.join('') ?? null };
};

export const assertBoundedPlainData = (value, options = {}) => {
  inspectPlainData(value, options, false);
  return value;
};

export const canonicalJson = (value, options = {}) =>
  inspectPlainData(value, options, true).text;

export const canonicalSha256 = (value, options = {}) => crypto
  .createHash('sha256')
  .update(canonicalJson(value, options), 'utf8')
  .digest('hex');

export const canonicalAuthoritySha256 = (
  value,
  { domain, schemaVersion, ...options },
) => {
  if (typeof domain !== 'string' || !AUTHORITY_DOMAIN.test(domain)) {
    throw new Error('canonical authority domain is invalid');
  }
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > 0xffffffff) {
    throw new Error('canonical authority schemaVersion must be a positive uint32');
  }
  return canonicalSha256({ domain, schemaVersion, value }, options);
};

export const isSha256 = (value) => typeof value === 'string' && SHA256.test(value);

export const deepFreezePlainData = (value, options = {}) => {
  const { containers } = inspectPlainData(value, options, false);
  for (let index = containers.length - 1; index >= 0; index -= 1) {
    const container = containers[index];
    try {
      Object.freeze(container.value);
    } catch {
      throw new Error(`${container.field} refused plain-data freezing`);
    }
  }
  return value;
};

// The non-mutating rebuild variant of deepFreezePlainData: returns frozen
// copies and leaves the input graph untouched.
export const freezeJson = (value) => {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeJson));
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, freezeJson(child)]),
    ));
  }
  return value;
};