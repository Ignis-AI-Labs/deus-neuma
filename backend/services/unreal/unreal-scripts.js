// The Python the Unreal wire sends into the editor, and the readers of what comes back. Every
// function here is pure: text in, text or data out. The wire itself is unreal-remote.js.
//
// The editor answers a Python call with its log lines. A script that has something to say prints
// ONE line that starts with MARK and carries JSON, so an answer is never fished out of free log text.

export const MARK = 'NEUMA-UNREAL ';

/** A Python string literal for any text. JSON's escapes are a subset of Python's. Pure. */
export const pyString = (text) => JSON.stringify(String(text ?? ''));

const say = (expression) => `print(${pyString(MARK)} + json.dumps(${expression}))\n`;

/** Which editor, which project, which level is open, how many actors it holds. Pure. */
export const statusScript = () => [
  'import unreal, json',
  'w = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()',
  'a = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()',
  say("{'engine': unreal.SystemLibrary.get_engine_version(), 'project': unreal.Paths.convert_relative_path_to_full(unreal.Paths.get_project_file_path()), 'level': w.get_path_name() if w else None, 'actors': len(a)}"),
].join('\n');

/** Ask the level viewport for a picture at this size, written to this file a few frames later. Pure. */
export const screenshotScript = (path, width, height) => [
  'import unreal',
  `unreal.AutomationLibrary.take_high_res_screenshot(${Number(width) | 0}, ${Number(height) | 0}, ${pyString(path)})`,
  '',
].join('\n');

/** Every toolset Epic registered, by name, with how many tools each holds. Pure. */
export const toolsetIndexScript = () => [
  'import unreal, json',
  'j = json.loads(unreal.ToolsetRegistry.get_all_toolset_json_schemas())',
  say("[{'name': t.get('name'), 'tools': len(t.get('tools') or [])} for t in j]"),
].join('\n');

/** One toolset whole: its description and every tool with its inputs and its read/write mark. Pure. */
export const toolsetScript = (toolset) => [
  'import unreal, json',
  'j = json.loads(unreal.ToolsetRegistry.get_all_toolset_json_schemas())',
  `m = [t for t in j if t.get('name') == ${pyString(toolset)}]`,
  say('m[0] if m else None'),
].join('\n');

/** Is this one tool marked read or write by Epic? Answers {found, accessMode}. Pure. */
export const toolAccessScript = (toolset, tool) => [
  'import unreal, json',
  'j = json.loads(unreal.ToolsetRegistry.get_all_toolset_json_schemas())',
  `full = ${pyString(`${toolset}.${tool}`)}`,
  `m = [x for t in j if t.get('name') == ${pyString(toolset)} for x in (t.get('tools') or []) if x.get('name') in (full, ${pyString(tool)})]`,
  say("{'found': bool(m), 'accessMode': ((m[0].get('annotations') or {}).get('accessMode') if m else None)}"),
].join('\n');

/** Start one Epic tool. It answers some frames later, so the pending answer is kept under `key`. Pure. */
export const toolStartScript = (key, toolset, tool, args) => [
  'import unreal, builtins',
  `setattr(builtins, ${pyString(key)}, unreal.ToolsetRegistry.execute_tool(${pyString(toolset)}, ${pyString(tool)}, ${pyString(JSON.stringify(args ?? {}))}))`,
  '',
].join('\n');

/** Ask whether the tool started under `key` has answered; a finished answer is taken and forgotten. Pure. */
export const toolPollScript = (key) => [
  'import builtins, json',
  `r = getattr(builtins, ${pyString(key)}, None)`,
  "o = {'done': True, 'error': 'the call was lost (the editor restarted?)', 'value': ''} if r is None else {'done': bool(r.is_complete), 'error': str(r.error), 'value': str(r.value)}",
  `if r is not None and o['done']: delattr(builtins, ${pyString(key)})`,
  say('o'),
].join('\n');

/** The editor's log lines as plain text lines; errors and warnings keep their mark. Pure. */
export const logLines = (logOutput) => (Array.isArray(logOutput) ? logOutput : []).map((line) => {
  const text = String(line?.Output ?? '').replace(/\s+$/, '');
  return line?.Type === 'Error' ? `! ${text}` : line?.Type === 'Warning' ? `~ ${text}` : text;
});

/** The JSON a script said on its MARK line; undefined when it said nothing (the script failed). Pure. */
export const markedAnswer = (lines) => {
  const line = (Array.isArray(lines) ? lines : []).find((l) => typeof l === 'string' && l.startsWith(MARK));
  if (line === undefined) return undefined;
  try { return JSON.parse(line.slice(MARK.length)); } catch { return undefined; }
};

/**
 * An Epic tool's answer for reading. Epic wraps most answers as {returnValue: "<json text>"}; the
 * inner JSON is opened so it reads as data, and anything else is left exactly as it came. Pure.
 */
export const openToolAnswer = (value) => {
  const parse = (text) => { try { return JSON.parse(text); } catch { return text; } };
  const outer = typeof value === 'string' ? parse(value) : value;
  if (outer && typeof outer === 'object' && !Array.isArray(outer) && typeof outer.returnValue === 'string') {
    return { ...outer, returnValue: parse(outer.returnValue) };
  }
  return outer;
};

/**
 * One window of a long text and what lies beyond it, so nothing is cut without saying so. Pure.
 * @returns {{text: string, from: number, end: number, total: number, more: boolean}}
 */
export const windowOf = (whole, from = 0, size = 12_000) => {
  const full = String(whole ?? '');
  const start = Math.min(Math.max(0, Number.isFinite(Number(from)) ? Math.floor(Number(from)) : 0), full.length);
  const end = Math.min(full.length, start + size);
  return { text: full.slice(start, end), from: start, end, total: full.length, more: end < full.length };
};

/** A window as the being reads it: the text, then exactly how much is left and how to read it. Pure. */
export const renderWindow = (win) => (win.more
  ? `${win.text}\n[characters ${win.from}–${win.end} of ${win.total}; unreal_more {from: ${win.end}} reads on]`
  : win.from > 0 ? `${win.text}\n[characters ${win.from}–${win.end} of ${win.total}; the end]` : win.text);

/** The port the editor's Remote Control listens on: NEUMA_UNREAL_PORT, or Unreal's own default. Pure. */
export const unrealPort = (env = {}) => {
  const port = Number(env.NEUMA_UNREAL_PORT);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : 30010;
};
