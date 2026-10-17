/**
 * mapview/extract — PURE per-file extraction. Given one source file's path and
 * text, pull out the architecture signals it declares: imports, function
 * definitions, HTTP routes (Express method calls + mounts, Next.js route files),
 * and channel sites (owned by channels.js, assembled into extractFile here).
 * No IO here — the impure walk lives in scan.js; the cross-file assembly in
 * graph.js.
 *
 * Regex-based on purpose: route registration and message-type literals are
 * highly regular, which keeps this dependency-free. AST hardening is a later pass.
 */
import { extractModuleRefs, extractReexports } from './imports.js';
import { extractChannels, lineOf } from './channels.js';

export { resolveImportCandidates } from './imports.js';

export const CODE_EXT = Object.freeze(new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']));
const METHODS = Object.freeze(['get', 'post', 'put', 'delete', 'patch', 'all', 'options', 'head']);

/** Escape a string for literal use inside a RegExp. Pure. */
const escapeReLocal = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Next.js App Router: a file named route.* under an `app/` tree IS a route, its
 * URL path derived from the directory (`[x]` → `:x`, `[...x]` → `*`, `(group)`
 * dirs drop out). Returns the path, or null when not a route file. Pure.
 */
const nextRoutePath = (relFile) => {
  const parts = relFile.split('/');
  if (!/^route\.[jt]sx?$/.test(parts[parts.length - 1])) return null;
  const appIdx = parts.lastIndexOf('app');
  if (appIdx < 0) return null;
  const segs = parts.slice(appIdx + 1, -1)
    .filter((s) => !(s.startsWith('(') && s.endsWith(')')))
    .map((s) => s.replace(/^\[\.\.\.[^\]]+\]$/, '*').replace(/^\[([^\]]+)\]$/, ':$1'));
  return '/' + segs.join('/');
};

const isRouterObj = (obj) => obj === 'app' || obj === 'router' || /router$/i.test(obj) || /^route/i.test(obj);
const isRoutePath = (p) => p === '*' || p.startsWith('/');

/**
 * A defined unit is a function, a method, or a class — the map must show all
 * three or it understates what the code actually declares. Reserved words that
 * can precede a `(… ) {` block and would otherwise be mis-read as a method.
 */
const NON_METHOD_KEYWORDS = Object.freeze(new Set([
  'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'do', 'else',
  'with', 'try', 'finally', 'typeof', 'void', 'delete', 'await', 'yield', 'new',
  'in', 'of', 'case', 'throw',
]));

/** Deterministic string hash (djb2), prefixed with length so collisions between
 * two genuinely-different bodies are astronomically unlikely. Pure. */
const hashStr = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${s.length}:${(h >>> 0).toString(36)}`;
};

/**
 * A fingerprint of a definition's BODY (whitespace-collapsed), used to tell a
 * genuine copy-paste duplicate apart from a coincidental same name. Brace-matching
 * runs over the MASKED text (so a `}` inside a string never ends the body early),
 * but the hash is taken over the ORIGINAL body slice — so string CONSTANTS are part
 * of the fingerprint and two functions with the same shape but different constants
 * do NOT collide (zero false "exact copy"). Comments differ → different fingerprint
 * (strict, no over-claiming). Scans from the name past the parameter list / arrow to
 * the body. Returns null when no body is found. Pure.
 *
 * Bounded limitation: a TypeScript return-type annotation between the params `)`
 * and the body `{` (`function f(): Ret { … }`) mis-locates the body — a false SPLIT
 * (two identical fns with different return types won't match), never a false exact-
 * copy. The prime directive holds; the neuma repo is JS-only. AST hardening later.
 */
const bodyFingerprint = (masked, original, fromIdx) => {
  const n = masked.length;
  const limit = Math.min(n, fromIdx + 20000); // bound the scan
  let k = fromIdx, depth = 0, seenParen = false;
  for (; k < limit; k++) {
    const c = masked[k];
    if (c === '(') { depth++; seenParen = true; }
    else if (c === ')') { depth--; if (depth === 0 && seenParen) { k++; break; } }
    else if (c === '=' && masked[k + 1] === '>' && depth === 0) break; // no-paren single-arg arrow
    else if (c === ';' && depth === 0) return null; // no body
    else if (c === '{' && depth === 0 && !seenParen) break; // body brace with no params seen
  }
  while (k < n && /\s/.test(masked[k])) k++;
  if (masked[k] === '=' && masked[k + 1] === '>') { k += 2; while (k < n && /\s/.test(masked[k])) k++; }
  if (masked[k] === '{') {
    let d = 0, e = k;
    for (; e < n; e++) { const c = masked[e]; if (c === '{') d++; else if (c === '}') { d--; if (d === 0) { e++; break; } } }
    return hashStr(original.slice(k, e).replace(/\s+/g, ' ').trim());
  }
  // arrow expression body — to the next `;` or newline at bracket-depth 0
  let e = k, d = 0;
  for (; e < n; e++) { const c = masked[e]; if (c === '(' || c === '[') d++; else if (c === ')' || c === ']') d--; else if ((c === ';' || c === '\n') && d <= 0) break; }
  const body = original.slice(k, e).replace(/\s+/g, ' ').trim();
  return body ? hashStr(body) : null;
};

/**
 * Top-level function definitions: [{ name, line, exported, kind:'function', sig }].
 * `sig` is a body fingerprint (see bodyFingerprint) used by the duplicate detector;
 * it is stripped before the graph is returned. Class methods and class declarations
 * are extracted separately (extractClasses / extractMethods). Pure.
 */
const extractFunctions = (text, masked) => {
  const out = [];
  const seen = new Set();
  const push = (name, idx, exported) => {
    const key = name + ':' + idx;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, line: lineOf(text, idx), exported, kind: 'function', sig: bodyFingerprint(masked, text, idx) });
  };
  // A `(?:^|\n)`-anchored match starts AT the newline, whose line index is the
  // line before the definition — advance past it so the reported line is the
  // def's own (classes/methods below apply the same correction).
  const at = (mm) => mm.index + (mm[0].startsWith('\n') ? 1 : 0);
  let m;
  const decl = /(?:^|\n)([ \t]*)(export\s+(?:default\s+)?)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g;
  while ((m = decl.exec(text))) push(m[3], at(m), Boolean(m[2]));
  const arrow = /(?:^|\n)([ \t]*)(export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g;
  while ((m = arrow.exec(text))) push(m[3], at(m), Boolean(m[2]));
  const fexpr = /(?:^|\n)([ \t]*)(export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\b/g;
  while ((m = fexpr.exec(text))) push(m[3], at(m), Boolean(m[2]));
  return out;
};

/**
 * Class declarations: [{ name, line, exported, extends, kind:'class' }]. The
 * `class Name` form is unambiguous, so this is exact (no false positives). Pure.
 */
const extractClasses = (text) => {
  const out = [];
  const re = /(?:^|\n)[ \t]*(export\s+(?:default\s+)?)?class\s+([A-Za-z_$][\w$]*)(?:\s+extends\s+([A-Za-z_$][\w$.]*))?/g;
  let m;
  while ((m = re.exec(text))) {
    out.push({ name: m[2], line: lineOf(text, m.index + (m[0].startsWith('\n') ? 1 : 0)), exported: Boolean(m[1]), extends: m[3] || null, kind: 'class' });
  }
  return out;
};

/**
 * Method / object-shorthand definitions: [{ name, line, kind:'method' }]. Matched
 * by the strict `<indent> name(args) {` shape — member expressions (a leading
 * `.`), colon-form handlers (`k: () =>`), and control-flow keywords are excluded,
 * so this stays conservative (a genuine def missed before a false one invented).
 * Single-line signatures only; multi-line parameter lists are a known blind spot.
 * Comments are not stripped, so a method-shaped line inside a block comment could
 * in principle be counted — verified not to occur in this repo, and bounded by the
 * same […] caveat as the rest of the file.
 * `skipLines` are already claimed by extractFunctions (indented top-level fns) so
 * a definition is never counted twice. Pure.
 */
const extractMethods = (text, skipLines) => {
  const out = [];
  const seen = new Set();
  const re = /(?:^|\n)[ \t]+(?:static\s+)?(?:async\s+)?(?:(?:get|set)\s+)?\*?\s*([A-Za-z_$][\w$]*)\s*\([^)\n]*\)\s*\{/g;
  let m;
  while ((m = re.exec(text))) {
    const name = m[1];
    if (NON_METHOD_KEYWORDS.has(name)) continue;
    const line = lineOf(text, m.index + (m[0].startsWith('\n') ? 1 : 0));
    if (skipLines.has(line)) continue;
    const key = name + ':' + line;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, line, exported: false, kind: 'method' });
  }
  return out;
};

/**
 * Outbound egress vocabulary — the calls that reach OUTSIDE the app. Kept to
 * low-false-positive, unambiguous forms: global fetch (not `.fetch` methods),
 * ethers RPC providers, an outbound WebSocket client, and MCP client transports.
 */
const EGRESS_PATTERNS = Object.freeze([
  // global fetch, including window./globalThis./self.-qualified forms, but NOT a
  // `.fetch` method on some other object (db.fetch, this.fetch).
  { kind: 'http', re: /(?<![.\w])(?:(?:window|globalThis|self)\.)?fetch\s*\(/g },
  { kind: 'rpc', re: /\b(?:JsonRpcProvider|WebSocketProvider|JsonRpcBatchProvider|getDefaultProvider)\s*\(/g },
  { kind: 'ws-client', re: /\bnew\s+WebSocket\s*\(/g },
  { kind: 'mcp', re: /\bnew\s+(?:StdioClientTransport|SSEClientTransport|StreamableHTTPClientTransport)\s*\(/g },
]);

/**
 * Is the char index inside a line comment? Line-scoped: true if the line starts
 * with `//` or ` *` (block-comment body), or a `//` precedes the index that is
 * NOT the `//` of a `scheme://` URL nor a `//` inside a string/template literal
 * (those are stripped first, so a real egress on a line with a `'…//…'` string is
 * not hidden). Bounded blind spots (same regex-based caveat as the rest of the
 * file): multi-line block comments opened on a prior line, and a `//` inside a
 * regex literal. Pure.
 */
const isCommented = (text, idx) => {
  const lineStart = text.lastIndexOf('\n', idx - 1) + 1;
  const before = text.slice(lineStart, idx);
  const trimmed = before.trimStart();
  if (trimmed.startsWith('//') || trimmed.startsWith('*')) return true;
  // Strip string/template literals and scheme:// URLs before the `//` test so a
  // `//` INSIDE a string (a path, a URL) is never mistaken for a comment (which
  // would hide a real egress) — only a genuine trailing `// comment` counts.
  const stripped = before
    .replace(/'[^']*'/g, '').replace(/"[^"]*"/g, '').replace(/`[^`]*`/g, '')
    .replace(/[a-z][\w+.-]*:\/\//gi, '');
  return stripped.includes('//');
};

/**
 * Blank the CONTENTS of comments, string/template literals, and regex literals so
 * a code token that only appears inside one — `"call fetch(x)"`, `// fs.readFile`,
 * `/fetch(x)/` — is never matched as a real call. Template `${…}` interpolations
 * are treated as CODE (not blanked), so a genuine call inside one IS still seen.
 *
 * A single LEFT-TO-RIGHT stateful scan is the only correct way: a regex mask trips
 * on an apostrophe inside a comment (`// don't`), opening a bogus string span that
 * swallows real code after it. The scan enters comment state first, so such
 * apostrophes are inert. Length- and newline-preserving (interior chars → spaces,
 * newlines kept; only string/regex delimiters are retained — comment delimiters
 * are blanked with their body, which is harmless since length holds), so a masked
 * index maps to the exact same line/column in the original — lineOf and host
 * extraction read the original text. Pure.
 */
// A `/` begins a regex (not division) when the last significant code token is an
// expression-start: an operator, an open bracket, or a keyword like return/typeof.
const REGEX_PREV_CH = new Set(['(', ',', '=', ':', '[', '{', ';', '!', '&', '|', '?', '+', '-', '*', '%', '<', '>', '~', '^']);
const REGEX_PREV_KW = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'do', 'else', 'yield', 'await', 'case']);
export const maskNonCode = (text) => {
  const out = text.split('');
  const n = text.length;
  const blank1 = (k) => { if (out[k] !== '\n') out[k] = ' '; };
  const tmpl = []; // stack: brace-depth of each open template's interpolation (0 = in literal part)
  let i = 0, prevCh = '', prevWord = '';
  while (i < n) {
    const c = text[i], c2 = text[i + 1];
    // Inside a template's literal part: blank text, but honor `${` (→ code) and the closing backtick.
    if (tmpl.length && tmpl[tmpl.length - 1] === 0) {
      if (c === '\\') { blank1(i); if (i + 1 < n) blank1(i + 1); i += 2; continue; }
      if (c === '`') { tmpl.pop(); i++; prevCh = '`'; prevWord = ''; continue; }
      if (c === '$' && c2 === '{') { tmpl[tmpl.length - 1] = 1; i += 2; prevCh = '{'; prevWord = ''; continue; }
      blank1(i); i++; continue;
    }
    // Code mode (top-of-repo, or inside a `${…}` interpolation with depth > 0).
    if (c === '/' && c2 === '/') { let j = i + 2; while (j < n && text[j] !== '\n') j++; for (let k = i; k < j; k++) blank1(k); i = j; continue; }
    if (c === '/' && c2 === '*') { let j = i + 2; while (j < n && !(text[j] === '*' && text[j + 1] === '/')) j++; j = Math.min(n, j + 2); for (let k = i; k < j; k++) blank1(k); i = j; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n) { if (text[j] === '\\') { j += 2; continue; } if (text[j] === c) { j++; break; } j++; }
      for (let k = i + 1; k < j - 1; k++) blank1(k); i = j; prevCh = c; prevWord = ''; continue;
    }
    if (c === '`') { tmpl.push(0); i++; prevCh = '`'; prevWord = ''; continue; }
    if (c === '/' && (prevCh === '' || REGEX_PREV_CH.has(prevCh) || REGEX_PREV_KW.has(prevWord))) {
      let j = i + 1, inClass = false;
      while (j < n) {
        const ch = text[j];
        if (ch === '\\') { j += 2; continue; }
        if (ch === '\n') break; // unterminated regex can't cross a line — treat the `/` as division
        if (ch === '[') inClass = true; else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) { j++; break; }
        j++;
      }
      for (let k = i + 1; k < j - 1; k++) blank1(k); i = j; prevCh = '/'; prevWord = ''; continue;
    }
    // Track `${…}` brace depth so the interpolation's matching `}` returns to the template.
    if (tmpl.length) {
      if (c === '{') tmpl[tmpl.length - 1]++;
      else if (c === '}') { tmpl[tmpl.length - 1]--; if (tmpl[tmpl.length - 1] === 0) { i++; prevCh = '}'; prevWord = ''; continue; } }
    }
    if (!/\s/.test(c)) { prevCh = c; prevWord = /[A-Za-z_$]/.test(c) ? prevWord + c : ''; }
    i++;
  }
  return out.join('');
};

/**
 * The literal target HOST when a call's first argument is a plain URL string
 * (`fetch('https://api.x/…')`), else null. Templates/variables stay null — a
 * dynamic target is reported as unknown, never guessed. Pure.
 */
const hostFromArg = (text, parenIdx) => {
  const after = text.slice(parenIdx + 1, parenIdx + 300);
  const lit = after.match(/^\s*['"]([^'"]*)['"]/);
  if (!lit) return null;
  const url = lit[1].match(/^[a-z][\w+.-]*:\/\/([^/?#]+)/i);
  return url ? url[1] : null;
};

/**
 * Outbound/external connection sites: [{ kind, line, host }]. Detects egress that
 * the route/channel/call graphs never showed — the app's whole external surface.
 * Commented-out sites are skipped so a `// new JsonRpcProvider(...)` example never
 * invents a live connection. Pure.
 */
const extractExternal = (text, masked) => {
  const out = [];
  for (const { kind, re } of EGRESS_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(masked))) {
      if (isCommented(text, m.index)) continue;
      const parenIdx = m.index + m[0].length - 1; // the '(' is the match's last char
      // host/line read the ORIGINAL text — masking is length-preserving so indices align
      out.push({ kind, line: lineOf(text, m.index), host: hostFromArg(text, parenIdx) });
    }
  }
  return out.sort((a, b) => a.line - b.line);
};

// Filesystem operations by intent. The map shows which modules touch DISK and
// whether they read or write it — another connection route the code graph hides.
const STORAGE_OPS = Object.freeze(new Map([
  ...['readFile', 'readFileSync', 'readdir', 'readdirSync', 'access', 'accessSync',
    'stat', 'statSync', 'lstat', 'lstatSync', 'realpath', 'readlink', 'opendir',
    'createReadStream', 'exists', 'existsSync'].map((op) => [op, 'read']),
  ...['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'mkdir', 'mkdirSync',
    'rm', 'rmSync', 'rmdir', 'rmdirSync', 'unlink', 'unlinkSync', 'rename', 'renameSync',
    'copyFile', 'copyFileSync', 'createWriteStream', 'mkdtemp', 'mkdtempSync', 'truncate',
    'symlink'].map((op) => [op, 'write']),
]));
const isFsSpec = (spec) => /^(node:)?fs(\/promises)?$/.test(spec);

/**
 * Filesystem access sites: [{ kind: 'read'|'write', line }]. IMPORT-ANCHORED —
 * resolves which binding IS the fs module (default/namespace import) vs which ops
 * were named-imported directly, so `fs.readFile(` and a bare `readFile(` (imported
 * from fs) both count while an unrelated `obj.stat(` never does. Commented sites
 * are skipped. `import * as fs` is a bounded blind spot (extractImports doesn't
 * capture the star form). Pure.
 */
const extractStorage = (text, imports, masked) => {
  const nsBindings = new Set(); // `fs`, `fsp` — used as `fs.readFile(`
  const directOps = [];         // named-imported ops — used as `readFile(`
  for (const imp of imports) {
    // A nameless ref (`import 'node:fs'`, a bare `require('fs')`) binds nothing
    // that could later be called, so it names no storage site.
    if (!imp.varName || !isFsSpec(imp.spec)) continue;
    if (STORAGE_OPS.has(imp.varName)) directOps.push(imp.varName);
    else nsBindings.add(imp.varName);
  }
  if (!nsBindings.size && !directOps.length) return [];
  const out = [];
  const add = (kind, idx) => { if (!isCommented(text, idx)) out.push({ kind, line: lineOf(text, idx) }); };
  const opAlt = [...STORAGE_OPS.keys()].join('|');
  for (const b of nsBindings) {
    // (?<![.\w]) so `this.fs.writeFile` (an instance property) is not mistaken for
    // the imported `fs` module binding.
    const re = new RegExp(`(?<![.\\w])${escapeReLocal(b)}\\.(${opAlt})\\s*\\(`, 'g');
    let m;
    while ((m = re.exec(masked))) add(STORAGE_OPS.get(m[1]), m.index);
  }
  for (const op of new Set(directOps)) {
    const re = new RegExp(`(?<![.\\w])${escapeReLocal(op)}\\s*\\(`, 'g');
    let m;
    while ((m = re.exec(masked))) add(STORAGE_OPS.get(op), m.index);
  }
  return out.sort((a, b) => a.line - b.line);
};

/**
 * Environment-variable dependencies: [{ name, line }]. `process.env.FOO` yields the
 * literal var name; `process.env[expr]` yields name=null (a dynamic read — the var
 * is only known at runtime, so it is reported as unknown, never guessed). Matched
 * against the masked text so a `process.env.X` inside a string/comment is not a
 * real dependency. Pure.
 */
const extractEnv = (text, masked) => {
  const out = [];
  // (?<![.\w]) so `obj.process.env.X` (a property chain, not the global) is excluded.
  // Matched on MASKED text so a process.env.X inside a string/comment does not count.
  const dotName = /(?<![.\w])process\.env\.([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = dotName.exec(masked))) out.push({ name: m[1], line: lineOf(text, m.index) });
  // Bracket access: a string-literal key IS a known name (read from the ORIGINAL
  // text — the mask blanks string contents); a variable key is dynamic (null).
  const bracket = /(?<![.\w])process\.env\s*\[/g;
  while ((m = bracket.exec(masked))) {
    const key = text.slice(m.index).match(/^process\.env\s*\[\s*(['"])([^'"]*)\1/);
    out.push({ name: key ? key[2] : null, line: lineOf(text, m.index) });
  }
  // A bare `process.env` not followed by `.` or `[` is a destructure or alias-
  // assignment (`const { X } = process.env`): a real env read whose var name can't
  // be resolved without dataflow — surfaced as dynamic (null) so it is never HIDDEN.
  const bare = /(?<![.\w])process\.env\b(?!\s*[.[])/g;
  while ((m = bare.exec(masked))) out.push({ name: null, line: lineOf(text, m.index) });
  return out.sort((a, b) => a.line - b.line);
};

/**
 * Middleware applications: [{ name, line, scope }]. Two Express forms, matched on
 * MASKED text (a name inside a string/comment does not count):
 *  - router/app level: `X.use(mwFn)` where the first arg is an identifier or member
 *    (`requireAuth`, `express.json`), NOT a path string (that is a mount → a route).
 *  - per-route: `X.get('/p', mwFn, …handler)` — the identifier between path and the
 *    next comma. Reveals the request pipeline and, notably, the auth surface. Pure.
 */
const extractMiddleware = (text, masked) => {
  const out = [];
  // A leading middleware is an identifier followed by a comma AND another argument
  // (the `(?=\s*[^)\s])` lookahead means a handler followed by a trailing comma then
  // `)` — Prettier's trailingComma:all — is NOT mistaken for middleware). The run
  // stops at the handler / mounted router (followed by `)` or a `(` call).
  const mwStep = /^\s*([A-Za-z_$][\w$]*)\s*,(?=\s*[^)\s])/;
  const captureRun = (from, line, scope) => {
    let rest = masked.slice(from, from + 800), step;
    while ((step = rest.match(mwStep))) { out.push({ name: step[1], line, scope }); rest = rest.slice(step[0].length); }
  };
  let m;
  // A. router-level: X.use(mwFn). A bare identifier that is itself router-like is a
  //    root MOUNT (app.use(userRouter)), not middleware — skip it (isRouterObj).
  const useFnRe = /\b(?:app|router|[A-Za-z_$][\w$]*[Rr]outer)\.use\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)/g;
  while ((m = useFnRe.exec(masked))) { if (isRouterObj(m[1])) continue; out.push({ name: m[1], line: lineOf(text, m.index), scope: 'router' }); }
  // B. path-scoped mount-time middleware: X.use('/path', mw, …, router) — capture the
  //    middleware run; the trailing router (followed by `)` or `(`) stops the run.
  const usePathRe = /\b(?:app|router|[A-Za-z_$][\w$]*[Rr]outer)\.use\(\s*['"][^'"]*['"]\s*,/g;
  while ((m = usePathRe.exec(masked))) captureRun(m.index + m[0].length, lineOf(text, m.index), 'router');
  // C. per-route: X.method('/path', mw, …handler). X MUST be router-like, else a
  //    plain `config.get('key', fallback, opts)` would invent middleware (isRouterObj).
  const routeRe = /\b([A-Za-z_$][\w$]*)\.(?:get|post|put|delete|patch|all|options|head)\(\s*['"][^'"]*['"]\s*,/g;
  while ((m = routeRe.exec(masked))) { if (!isRouterObj(m[1])) continue; captureRun(m.index + m[0].length, lineOf(text, m.index), 'route'); }
  return out.sort((a, b) => a.line - b.line);
};

/** Every defined unit in the file — functions, classes, and methods. Pure. */
const extractDefinitions = (text, masked) => {
  const functions = extractFunctions(text, masked);
  const classes = extractClasses(text);
  const fnLines = new Set(functions.map((f) => f.line));
  const methods = extractMethods(text, fnLines);
  return [...functions, ...classes, ...methods];
};

/** Express method-call routes on router-like objects: [{ method, path, line, obj }]. Pure. */
const extractMethodRoutes = (text) => {
  const out = [];
  const re = new RegExp(`\\b(\\w+)\\.(${METHODS.join('|')})\\(\\s*['"\\\`]([^'"\\\`]+)['"\\\`]`, 'g');
  let m;
  while ((m = re.exec(text))) {
    const [, obj, method, routePath] = m;
    if (!isRouterObj(obj) || !isRoutePath(routePath)) continue;
    out.push({ method: method.toUpperCase(), path: routePath, line: lineOf(text, m.index), obj });
  }
  return out;
};

/** Next.js route-file method exports for the file's derived path, or []. Pure. */
const extractNextRoutes = (text, relFile) => {
  const nextPath = nextRoutePath(relFile);
  if (nextPath === null) return [];
  const out = [];
  const re = /export\s+(?:async\s+)?(?:function\s+|const\s+)(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/g;
  let m;
  while ((m = re.exec(text))) {
    out.push({ method: m[1], path: nextPath, prefix: '/' + (nextPath.split('/')[1] || ''), line: lineOf(text, m.index) });
  }
  return out;
};

/** app.use('/prefix', xRouter) mounts: [{ prefix, varName, factory, line }]. Pure. */
const extractMounts = (text) => {
  const out = [];
  const re = /\b(\w+)\.use\(\s*['"]([^'"]+)['"]\s*,\s*([^)]*)\)/g;
  let m;
  while ((m = re.exec(text))) {
    const prefix = m[2];
    const line = lineOf(text, m.index);
    for (const im of m[3].matchAll(/\b([A-Za-z_]\w*)\b(\s*\()?/g)) {
      const name = im[1];
      if (im[2]) out.push({ prefix, varName: name, factory: true, line });
      else if (!['express', 'req', 'res', 'next'].includes(name)) out.push({ prefix, varName: name, factory: false, line });
    }
  }
  return out;
};

/**
 * Extract every architecture signal from one file. Pure.
 * @returns {{ imports, functions, routes, nextRoutes, mounts, channels }}
 */
export const extractFile = (relFile, text, absFile, root, { aliases = null } = {}) => {
  const masked = maskNonCode(text); // computed once, shared by the code-token extractors
  const imports = extractModuleRefs(text, masked, absFile, root, aliases);
  return {
    imports,
    reexports: extractReexports(text, masked, absFile, root, aliases),
    external: extractExternal(text, masked),
    storage: extractStorage(text, imports, masked),
    env: extractEnv(text, masked),
    middleware: extractMiddleware(text, masked),
    functions: extractDefinitions(text, masked),
    routes: extractMethodRoutes(text),
    nextRoutes: extractNextRoutes(text, relFile),
    mounts: extractMounts(text),
    channels: extractChannels(text),
  };
};
