/**
 * ONE ARGUMENT CHECK FOR EVERY TOOL (tool fluency, Design note, 2026-11-12: […]). Before this, each handler read its
 * own fields and defaulted what it did not find — a model that wrote
 * fs/edit {[…]: [{[…], […]}]} heard […], and a misnamed
 * optional field ran silently on its default (~100 such defaults in 38 tool
 * files, census 2026-11-12). Every call is now read against the schema the
 * model was shown, once, before any handler:
 *
 * - REPAIRED, silently: the same name in another spelling style (`old_text`
 *   → `oldText`), the names other harnesses give the same field (`file_path`,
 *   `old_string`, `cmd`), and values in a type that reads exactly (`"5"` → 5,
 *   `"true"` → true, a JSON-string array, one value where a list is asked).
 * - REFUSED, with what to write instead: a required field missing, a value of
 *   the wrong type, a value outside its choices, a field that is a near miss
 *   of one the call left out ("did you mean"), any extra field where the
 *   schema closes the object.
 * - Any other extra field passes, as before; the benchmark trail keeps every
 *   name the model wrote, so a census can say whether that should tighten.
 *
 * Pure.
 */
import { signatureOf } from '../../core/runtime/tool-signature.js';
import { distance } from './tool-hud.js';

const MAX_PROBLEMS = 6;
const MAX_DEPTH = 4;

// What other harnesses and model families name a field we name otherwise —
// read as ours only when the schema declares OUR name and the call left it out.
const ALIASES = Object.freeze({
  path: ['file_path', 'filepath', 'file', 'filename', 'file_name', 'target_file'],
  oldText: ['old_string', 'old_str', 'oldstring', 'old_text'],
  newText: ['new_string', 'new_str', 'newstring', 'new_text'],
  command: ['cmd', 'shell_command', 'bash_command'],
  query: ['search_query', 'search_term'],
  url: ['uri', 'link', 'href'],
  content: ['file_content', 'contents', 'file_text'],
});

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const fold = (name) => String(name).toLowerCase().replace(/[_\-\s]/g, '');
const typesOf = (prop) => (Array.isArray(prop?.type) ? prop.type : prop?.type ? [prop.type] : []);
const at = (where, key) => (where ? `${where}.${key}` : key);

const typeOfValue = (v) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
};
const fits = (type, v) => {
  const actual = typeOfValue(v);
  return type === actual || (type === 'number' && actual === 'integer');
};

// pure — the value read as `type` when it reads exactly; undefined when it does not
const coerce = (type, v, prop) => {
  if (typeof v === 'string') {
    const s = v.trim();
    if ((type === 'number' && /^-?\d+(\.\d+)?$/.test(s)) || (type === 'integer' && /^-?\d+$/.test(s))) return Number(s);
    if (type === 'boolean' && /^(true|false)$/i.test(s)) return s.toLowerCase() === 'true';
    if ((type === 'array' && s.startsWith('[')) || (type === 'object' && s.startsWith('{'))) {
      try { const parsed = JSON.parse(s); return fits(type, parsed) ? parsed : undefined; } catch { return undefined; }
    }
  }
  if (type === 'string' && (typeof v === 'number' || typeof v === 'boolean')) return String(v);
  // one value where a list is asked: the list of that one value
  if (type === 'array' && !Array.isArray(v) && v !== null && typesOf(prop?.items).some((t) => fits(t, v))) return [v];
  return undefined;
};

// pure — the declared field an unknown name was meant as, and whether reading it as that is safe
const meantAs = (key, props, args) => {
  const open = Object.keys(props).filter((name) => args[name] === undefined);
  const same = open.filter((name) => fold(name) === fold(key));
  if (same.length === 1) return { name: same[0], repair: true };
  const alias = open.filter((name) => (ALIASES[name] ?? []).includes(key.toLowerCase()));
  if (alias.length === 1) return { name: alias[0], repair: true };
  const k = fold(key);
  const near = open.filter((name) => {
    const n = fold(name);
    return (k.length >= 2 && (n.startsWith(k) || k.startsWith(n))) || distance(k, n) <= Math.max(1, Math.floor(n.length / 4));
  });
  return near.length >= 1 ? { name: near[0], repair: false } : null;
};

// pure, but for the problems list it fills — one value against its schema; returns the value as read
const checkValue = (prop, value, where, problems, depth) => {
  const types = typesOf(prop);
  let v = value;
  if (types.length > 0 && !types.some((t) => fits(t, v))) {
    const read = types.map((t) => coerce(t, v, prop)).find((c) => c !== undefined);
    if (read === undefined) {
      problems.push(`${where} must be ${types.join(' or ')}, not ${typeOfValue(v)}`);
      return v;
    }
    v = read;
  }
  if (Array.isArray(prop?.enum) && !prop.enum.includes(v)) {
    const same = typeof v === 'string' ? prop.enum.find((e) => typeof e === 'string' && e.toLowerCase() === v.toLowerCase()) : undefined;
    if (same === undefined) problems.push(`${where} must be one of ${prop.enum.map((e) => JSON.stringify(e)).join(', ')}`);
    else v = same;
  }
  if (depth >= MAX_DEPTH) return v;
  if (Array.isArray(v) && plain(prop?.items)) return v.map((item, i) => checkValue(prop.items, item, `${where}[${i}]`, problems, depth + 1));
  if (plain(v) && plain(prop?.properties)) return checkObject(prop, v, where, problems, depth + 1);
  return v;
};

// pure, but for the problems list it fills — an object against an object schema; returns the repaired copy
function checkObject(schema, args, where, problems, depth) {
  const props = schema.properties;
  const before = problems.length;
  const out = {};
  const unknown = [];
  for (const [key, value] of Object.entries(args)) {
    if (value === null && !(key in props && typesOf(props[key]).includes('null'))) continue; // null = left out
    if (key in props) out[key] = value; else unknown.push(key);
  }
  for (const key of unknown) {
    const meant = meantAs(key, props, out);
    if (meant?.repair) out[meant.name] = args[key];
    else if (meant) problems.push(`${at(where, key)} is not a field — did you mean ${at(where, meant.name)}?`);
    else if (schema.additionalProperties === false) problems.push(`${at(where, key)} is not a field`);
    else out[key] = args[key];
  }
  for (const name of Array.isArray(schema.required) ? schema.required : []) {
    if (out[name] === undefined && !unknown.some((k) => meantAs(k, props, out)?.name === name)) problems.push(`${at(where, name)} is required`);
  }
  for (const [key, value] of Object.entries(out)) {
    if (key in props) out[key] = checkValue(props[key], value, at(where, key), problems, depth);
  }
  // a nested object that did not fit is shown whole, once per shape (edits[] takes {oldText, newText})
  if (where && problems.length > before) problems.push(`${where.replace(/\[\d+\]/g, '[]')} takes ${signatureOf(schema)}`);
  return out;
}

/**
 * pure — a call's arguments read against the schema the model was shown.
 * @param {object|undefined} inputSchema the tool's advertised schema
 * @param {*} args the call's arguments
 * @returns {{args: *, problems: string[]}} the repaired arguments, and what does not fit (empty = runs)
 */
export const fitToolArgs = (inputSchema, args) => {
  if (!plain(inputSchema) || !plain(inputSchema.properties) || !plain(args)) return { args, problems: [] };
  const problems = [];
  const repaired = checkObject(inputSchema, args, '', problems, 0);
  return { args: repaired, problems: [...new Set(problems)] };
};

/**
 * pure — what the model hears when its call does not fit: every problem, then
 * the whole signature, so one reply is enough to write the call right.
 * @param {string} toolId `server/tool`
 * @param {object} inputSchema
 * @param {string[]} problems
 */
export const argsRefusalText = (toolId, inputSchema, problems) => {
  const shown = problems.slice(0, MAX_PROBLEMS);
  const more = problems.length > shown.length ? ` (and ${problems.length - shown.length} more)` : '';
  return `${toolId} did not run — its arguments do not fit: ${shown.join('; ')}${more}. `
    + `${toolId} takes ${signatureOf(inputSchema)} (? = optional).`;
};
