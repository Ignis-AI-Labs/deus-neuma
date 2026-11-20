// machine-holders-shape.js — the pure half of the machine map: naming a
// process by WHAT IT IS, and folding raw readings into "who holds what".
//
// Why naming needs its own code (found 2026-11-20): the house mind held 68.9 GB
// of a 97.9 GB card and every list called it `/proc/self/fd/3`, because the
// server is launched through a passed file handle. Dictation, the voice engine
// and the image engine were bare `python` paths. A list that cannot say what a
// holder IS cannot help anyone decide what to unload.
//
// Pure: facts in, plain objects out. The reads live in machine-holders.js.

const base = (p) => String(p || '').split('/').filter(Boolean).pop() || '';
const DESKTOP = Object.freeze({
  kwin_wayland: 'Desktop (window compositor)', kwin_x11: 'Desktop (window compositor)', 'gnome-shell': 'Desktop (shell)',
  plasmashell: 'Desktop (shell)', Xorg: 'Desktop (display server)', Xwayland: 'Desktop (display server)',
  code: 'VS Code', brave: 'Brave browser', chrome: 'Chrome browser', chromium: 'Chromium browser', firefox: 'Firefox browser',
  Telegram: 'Telegram', 'telegram-desktop': 'Telegram', electron: 'Electron app', obs: 'OBS', steam: 'Steam', discord: 'Discord',
});

/** The value after a flag in an argv list (`--port 8089`, `-m file`), or null. Pure. */
export const argAfter = (argv, ...flags) => {
  const i = (argv || []).findIndex((a) => flags.includes(a));
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};

/**
 * What one process IS. `kind` sorts it; `label` is its name in words; `detail`
 * says which (the model file, the port); `ours` marks what this platform
 * started or manages, so the operator and a being can tell what they may
 * unload from what merely shares the machine. Pure.
 *
 * @param {{pid:number, exe?:(string|null), argv?:string[], cwd?:(string|null), comm?:(string|null),
 *   modelFile?:(string|null)}} proc - modelFile: the model a server holds when
 *   its argv names it only by a passed handle (resolved by the reader)
 * @param {{mindPids?:number[], enginePid?:(number|null), repoRoot?:string}} [known]
 * @returns {{kind:string, label:string, detail:(string|null), ours:boolean}}
 */
export const identifyProcess = (proc, known = {}) => {
  const argv = proc?.argv || [];
  const line = argv.join(' ');
  const exe = proc?.exe || argv[0] || '';
  const file = base(exe).replace(/ \(deleted\)$/, '');
  // A program installed under its version number (".../versions/2.1.322") is named by what the system calls it.
  const name = (/^[\d.]+$/.test(file) ? proc?.comm : file) || proc?.comm || `pid ${proc?.pid}`;
  const port = argAfter(argv, '--port', '-p');
  const at = port ? `port ${port}` : null;
  const join = (...parts) => parts.filter(Boolean).join(' · ') || null;

  if (/llama-server/.test(exe) || /llama-server/.test(argv[0] || '')) {
    const named = argAfter(argv, '--model', '-m');
    const model = proc.modelFile || (named && !named.startsWith('/proc/') ? named : null);
    const mind = (known.mindPids || []).includes(proc.pid);
    return { kind: mind ? 'mind' : 'model-server', label: mind ? 'The mind (language model)' : 'A language model server', detail: join(base(model), at), ours: mind };
  }
  if (/(^|\/)main\.py$/.test(argv[1] || '') && (/comfy/i.test(argv[1]) || /comfy/i.test(proc?.cwd || ''))) {
    const ours = proc.pid === known.enginePid;
    return { kind: 'image-engine', label: 'Image engine (ComfyUI)', detail: join(at, ours ? null : 'not started by this platform'), ours };
  }
  const voice = /\/voice-engines\/([^/]+)\//.exec(line);
  if (voice) return { kind: 'voice', label: `Voice engine (${voice[1]})`, detail: at, ours: true };
  if (/\/ears\//.test(line)) return { kind: 'dictation', label: 'Dictation (ears)', detail: null, ours: false };
  if (/ollama/.test(name)) return { kind: 'model-server', label: 'Ollama (model server)', detail: at, ours: false };
  if (/\.lmstudio\//.test(exe) || /lm-studio|lmstudio/i.test(name)) return { kind: 'model-server', label: 'LM Studio', detail: null, ours: false };
  if (known.repoRoot && (proc?.cwd === known.repoRoot || line.includes(`${known.repoRoot}/backend/`)) && /^node/.test(name)) {
    const script = argv.find((a) => /\.(m?js)$/.test(a));
    return { kind: 'platform', label: 'This platform', detail: script ? base(script) : null, ours: true };
  }
  if (name === 'electron' && known.repoRoot && (proc?.cwd === known.repoRoot || line.includes(known.repoRoot))) {
    return { kind: 'platform', label: 'This platform (desk window)', detail: null, ours: true };
  }
  if (name === 'electron') return { kind: 'desktop', label: 'Electron app', detail: base(proc?.cwd) || null, ours: false };
  if (DESKTOP[name]) return { kind: 'desktop', label: DESKTOP[name], detail: null, ours: false };
  if (/^python/.test(name)) {
    const script = argv.slice(1).find((a) => !a.startsWith('-'));
    return { kind: 'other', label: script ? `python · ${base(script)}` : 'python', detail: at, ours: false };
  }
  return { kind: 'other', label: name, detail: at, ours: false };
};

/** `nvidia-smi --query-compute-apps=pid,used_memory` rows → [{pid, vramMB}]. Pure. */
export const parseGpuHolders = (csv) => String(csv || '').split('\n')
  .map((row) => row.split(',').map((c) => c.trim()))
  .filter((c) => c.length >= 2 && /^\d+$/.test(c[0]) && /^\d+/.test(c[1]))
  .map((c) => ({ pid: Number(c[0]), vramMB: Number.parseInt(c[1], 10) }));

/** `/proc/meminfo` → MB figures, or null fields when a line is absent. Pure. */
export const parseMeminfo = (text) => {
  const kb = (key) => { const m = new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(text || ''); return m ? Math.round(Number(m[1]) / 1024) : null; };
  const totalMB = kb('MemTotal'); const availableMB = kb('MemAvailable');
  const swapTotalMB = kb('SwapTotal'); const swapFreeMB = kb('SwapFree');
  return {
    totalMB, availableMB,
    usedMB: totalMB !== null && availableMB !== null ? totalMB - availableMB : null,
    swapTotalMB, swapUsedMB: swapTotalMB !== null && swapFreeMB !== null ? swapTotalMB - swapFreeMB : null,
  };
};

/** `/proc/stat` → per-core {busy, total} jiffies, by core number. Pure. */
export const parseCoreTimes = (text) => {
  const cores = [];
  for (const m of String(text || '').matchAll(/^cpu(\d+)\s+(.+)$/gm)) {
    const f = m[2].trim().split(/\s+/).map(Number);
    const idle = (f[3] || 0) + (f[4] || 0);
    const total = f.slice(0, 8).reduce((a, b) => a + (b || 0), 0);
    cores[Number(m[1])] = { busy: total - idle, total };
  }
  return cores;
};

/**
 * `/proc/<pid>/stat` → the jiffies it has run and the core it last ran on.
 * The name field may hold spaces and brackets, so fields are counted from the
 * LAST ")". Null when the line is not a stat line. Pure.
 */
export const parseProcStat = (text) => {
  const end = String(text || '').lastIndexOf(')');
  if (end < 0) return null;
  const f = text.slice(end + 2).trim().split(/\s+/);
  const jiffies = Number(f[11]) + Number(f[12]);
  const core = Number(f[36]);
  return Number.isFinite(jiffies) ? { jiffies, core: Number.isFinite(core) ? core : null } : null;
};

/** `/proc/<pid>/status` → resident and swapped MB (0 for a kernel thread). Pure. */
export const parseProcStatus = (text) => {
  const kb = (key) => { const m = new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(text || ''); return m ? Number(m[1]) / 1024 : 0; };
  return { ramMB: Math.round(kb('VmRSS')), swapMB: Math.round(kb('VmSwap')) };
};

/** Per-core busy share (0…100) between two readings of the core times. Pure. */
export const coreLoads = (before, after) => after.map((a, i) => {
  const b = before[i];
  if (!a || !b || a.total <= b.total) return 0;
  return Math.max(0, Math.min(100, Math.round(((a.busy - b.busy) / (a.total - b.total)) * 100)));
});

/**
 * Fold processes that are one thing (a browser's forty helpers, a model
 * server's threads) into one holder each, largest first by `by`. A holder
 * keeps its pids, and every figure is the sum of its processes. Pure.
 * @param {Array<{pid:number, identity:Object, vramMB?:number, ramMB?:number, swapMB?:number, cpu?:number, cores?:number[]}>} processes - cores: the cores its busy threads ran on
 * @param {'vramMB'|'ramMB'|'cpu'} by
 * @returns {Array<{label:string, kind:string, detail:(string|null), ours:boolean, pids:number[], vramMB:number, ramMB:number, swapMB:number, cpu:number, cores:number[]}>}
 */
export const foldHolders = (processes, by) => {
  const holders = new Map();
  for (const p of processes) {
    const key = `${p.identity.kind}|${p.identity.label}|${p.identity.detail ?? ''}`;
    if (!holders.has(key)) holders.set(key, { ...p.identity, pids: [], vramMB: 0, ramMB: 0, swapMB: 0, cpu: 0, cores: new Set() });
    const h = holders.get(key);
    h.pids.push(p.pid);
    h.vramMB += p.vramMB || 0; h.ramMB += p.ramMB || 0; h.swapMB += p.swapMB || 0; h.cpu += p.cpu || 0;
    for (const core of p.cores || []) h.cores.add(core);
  }
  return [...holders.values()]
    .filter((h) => h[by] > 0)
    .map((h) => ({ ...h, cpu: Math.round(h.cpu * 10) / 10, cores: [...h.cores].sort((a, b) => a - b), pids: h.pids.sort((a, b) => a - b) }))
    .sort((a, b) => b[by] - a[by] || (a.label < b.label ? -1 : 1));
};

const gb = (mb) => (Number.isFinite(mb) ? `${(mb / 1024).toFixed(1)} GB` : 'unread');
const what = (h) => `${h.label}${h.detail ? ` (${h.detail})` : ''}`;

/**
 * The map as a being reads it. Pure.
 * @param {Object} map - readMachineHolders output
 * @returns {string}
 */
export const shapeMachineHolders = (map) => {
  const out = [];
  if (map.gpu) {
    out.push(`GPU — ${map.gpu.name || 'unnamed'}: ${gb(map.gpu.usedMB)} of ${gb(map.gpu.totalMB)} held, ${gb(map.gpu.freeMB)} free${Number.isFinite(map.gpu.loadPct) ? `, ${map.gpu.loadPct}% busy` : ''}.`);
    map.gpu.holders.forEach((h, i) => out.push(`${i + 1}. ${gb(h.vramMB)} — ${what(h)}${h.ours ? ' · this platform\'s' : ''}${h.lever ? ` · ${h.lever}` : ''}`));
    if (map.gpu.unattributedMB > 256) out.push(`   ${gb(map.gpu.unattributedMB)} held by nothing the driver names (driver overhead, or a process this account cannot see).`);
  } else {
    out.push(`GPU — ${map.gpuWhy || 'no reading'}.`);
  }
  out.push('');
  if (map.ram) {
    out.push(`MEMORY — ${gb(map.ram.usedMB)} of ${gb(map.ram.totalMB)} in use, ${gb(map.ram.availableMB)} available${map.ram.swapUsedMB ? `, ${gb(map.ram.swapUsedMB)} in swap` : ''}.`);
    (map.ram.holders || []).forEach((h, i) => out.push(`${i + 1}. ${gb(h.ramMB)} — ${what(h)}${h.pids.length > 1 ? ` · ${h.pids.length} processes` : ''}${h.swapMB > 64 ? ` · ${gb(h.swapMB)} swapped` : ''}${h.ours ? ' · this platform\'s' : ''}`));
    if (map.ram.holdersWhy) out.push(`   ${map.ram.holdersWhy}`);
  }
  out.push('');
  if (map.cpu) {
    const busy = map.cpu.cores.filter((c) => c.loadPct >= 50);
    out.push(`CPU — ${map.cpu.name || 'unnamed'}, ${map.cpu.cores.length} cores: ${map.cpu.loadPct}% busy overall${Number.isFinite(map.cpu.load1) ? `, load ${map.cpu.load1}` : ''}.`);
    out.push(busy.length
      ? `Busy cores (50% or more): ${busy.map((c) => `#${c.core} ${c.loadPct}%${c.holder ? ` ${c.holder}` : ''}`).join(', ')}.`
      : 'No core is over 50% busy.');
    (map.cpu.holders || []).forEach((h, i) => out.push(`${i + 1}. ${h.cpu}% of one core — ${what(h)}${h.cores.length ? ` · on core${h.cores.length > 1 ? 's' : ''} ${h.cores.join(', ')}` : ''}`));
    if (map.cpu.holdersWhy) out.push(`   ${map.cpu.holdersWhy}`);
  }
  out.push('', `Read at ${map.readAt}. A holder marked "this platform's" was started or is managed here; the rest only share the machine.`);
  return out.join('\n');
};
