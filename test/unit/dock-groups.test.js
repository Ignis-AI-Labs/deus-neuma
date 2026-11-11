// dock-groups — the pure partition that organizes the dock's launchers into
// ordered sections. The rendering (Dock.jsx) is e2e-covered; this proves the
// partition logic: BANDS, the alphabet inside them, present-only filtering
// (reserved slots), and the never-hide guarantee for an unknown app.
//
// ⚠️ The membership rulings below (CHATS in WORKSPACE, STREAM/TEAMS/WORKFLOW in
// WORKSPACE) used to be pinned by POSITION. Position is no longer anyone's to
// choose — every section is alphabetical now (ruling, 2026-08-25) — so they are
// pinned by MEMBERSHIP and BAND instead, which is what those rulings were
// always actually about.
import { describe, expect, it } from 'vitest';
import { DOCK_GROUPS, groupDockApps, sectionActivity } from '../../frontend/app/windowing/dock-groups.js';

// Minimal stand-in entries — groupDockApps only cares about the id (first tuple
// element); the app object rides along untouched.
const entry = (id) => [id, { label: id.toUpperCase() }];

describe('groupDockApps', () => {
  it('places each app in its section, in the configured order', () => {
    const apps = ['wallet', 'files', 'chat', 'stats', 'teams', 'voice'].map(entry);
    const groups = groupDockApps(apps);
    expect(groups.map((g) => g.id)).toEqual(['neuma', 'workspace', 'knowledge', 'vault']);
    expect(groups.find((g) => g.id === 'neuma').items.map(([id]) => id)).toEqual(['voice']);
    // TALK · WORK · CRAFT — one present member each, in band order.
    expect(groups.find((g) => g.id === 'workspace').items.map(([id]) => id)).toEqual(['chat', 'teams', 'files']);
    expect(groups.find((g) => g.id === 'knowledge').items.map(([id]) => id)).toEqual(['stats']);
    expect(groups.find((g) => g.id === 'vault').items.map(([id]) => id)).toEqual(['wallet']);
  });

  it('places the SUBSTRATE HUD in its own engine section, before the vault', () => {
    const groups = groupDockApps(['substrate', 'wallet', 'chat'].map(entry));
    expect(groups.map((g) => g.id)).toEqual(['workspace', 'engine', 'vault']);
    expect(groups.find((g) => g.id === 'engine').items.map(([id]) => id)).toEqual(['substrate']);
  });

  // Design note, 2026-08-15: […] NEUMA keeps the being-facing surfaces; the working
  // surfaces live beside TODO and FILES. Pinned so they cannot drift back.
  it('puts STREAM, TEAMS and WORKFLOW in WORKSPACE — the ruling is MEMBERSHIP, not rank', () => {
    const groups = groupDockApps(['chat', 'chats', 'teams', 'workflow', 'voice', 'files'].map(entry));
    const neuma = groups.find((g) => g.id === 'neuma');
    const workspace = groups.find((g) => g.id === 'workspace');
    expect(neuma.items.map(([id]) => id)).toEqual(['voice']);
    expect(workspace.items.map(([id]) => id).sort())
      .toEqual(['chat', 'chats', 'files', 'teams', 'workflow']);
    // …and they land in the bands that say what you are reaching for.
    const bandOf = (id) => workspace.bands.find((b) => b.items.some(([i]) => i === id))?.label;
    expect(bandOf('chat')).toBe('TALK');
    expect(bandOf('teams')).toBe('WORK');
    expect(bandOf('workflow')).toBe('WORK');
    expect(bandOf('files')).toBe('CRAFT');
  });

  it('drops sections with no present apps (reserved slots stay invisible)', () => {
    // 'db' is configured under knowledge but not registered → knowledge shows
    // only its present members, and an all-absent section would not appear.
    const groups = groupDockApps([entry('skills'), entry('map')]);
    expect(groups.map((g) => g.id)).toEqual(['knowledge']);
    // Alphabetical by LABEL: the stand-in labels here are the upper-cased ids.
    expect(groups[0].items.map(([id]) => id)).toEqual(['map', 'skills']); // no 'db'
  });

  // Design note, 2026-07-27: […] KNOWLEDGE is what you consult ABOUT the work; a conversation
  // history IS the work. Pinned so it cannot drift back.
  it('puts CHATS in WORKSPACE, beside the other working surfaces', () => {
    const groups = groupDockApps([entry('chats'), entry('files'), entry('skills')]);
    const workspace = groups.find((g) => g.id === 'workspace');
    const knowledge = groups.find((g) => g.id === 'knowledge');
    expect(workspace.items.map(([id]) => id)).toContain('chats');
    expect(knowledge.items.map(([id]) => id)).not.toContain('chats');
    // It shares the TALK band with the live stream: a conversation history is
    // not consulted ABOUT the work, it IS the work.
    expect(workspace.bands.find((b) => b.label === 'TALK').items.map(([id]) => id)).toEqual(['chats']);
  });

  it('never hides an app the config does not know — it lands in a trailing group', () => {
    const groups = groupDockApps([entry('chat'), entry('brandnew')]);
    const more = groups.find((g) => g.id === 'more');
    expect(more).toBeTruthy();
    expect(more.label).toBeNull(); // trailing catch-all carries no section label
    expect(more.items.map(([id]) => id)).toEqual(['brandnew']);
    // every input app is represented exactly once across all sections
    const all = groups.flatMap((g) => g.items.map(([id]) => id));
    expect(all.sort()).toEqual(['brandnew', 'chat']);
  });

  it('the solo vault section carries no label (a lone launcher, not a named band)', () => {
    const vault = DOCK_GROUPS.find((g) => g.id === 'vault');
    expect(vault.label).toBeNull();
    expect(vault.apps).toEqual(['wallet']);
  });

  it('the config table is frozen — a shared registry, not a mutable global', () => {
    expect(Object.isFrozen(DOCK_GROUPS)).toBe(true);
    for (const g of DOCK_GROUPS) {
      expect(Object.isFrozen(g)).toBe(true);
      expect(Object.isFrozen(g.apps)).toBe(true);
      expect(Object.isFrozen(g.bands)).toBe(true);
      for (const b of g.bands) expect(Object.isFrozen(b.apps)).toBe(true);
    }
  });

});

describe('sectionActivity', () => {
  const ids = ['chat', 'voice', 'house'];

  it('is focused when the focused window is one of the section apps', () => {
    expect(sectionActivity(ids, ['chat', 'files'], 'chat')).toBe('focused');
  });

  it('is open when a section app is open but not the focused one', () => {
    expect(sectionActivity(ids, ['house', 'files'], 'files')).toBe('open');
  });

  it('is closed when no section app is open', () => {
    expect(sectionActivity(ids, ['files', 'terminal'], 'files')).toBe('closed');
    expect(sectionActivity(ids, [], null)).toBe('closed');
  });

  it('a focused app outside the section does not mark it focused', () => {
    // focusedId is in another section → this section is at most "open"
    expect(sectionActivity(ids, ['chat'], 'wallet')).toBe('open');
  });

  it('compares in app-id space — callers must base-map instance ids first', () => {
    // The dock maps `terminal#2` → `terminal` (appIdOf) before calling; a raw
    // instance id would silently fail both checks.
    expect(sectionActivity(['terminal'], ['terminal'], 'terminal')).toBe('focused');
    expect(sectionActivity(['terminal'], ['terminal#2'], 'terminal#2')).toBe('closed');
  });
});

describe('groupDockApps — pure partition', () => {
  it('is a pure partition — no app appears in two sections', () => {
    const ids = ['chat', 'voice', 'avatar', 'house', 'refinement', 'teams',
      'files', 'terminal', 'chats', 'stats', 'skills', 'contextmap', 'map', 'wallet'];
    const groups = groupDockApps(ids.map(entry));
    const placed = groups.flatMap((g) => g.items.map(([id]) => id));
    expect(placed.length).toBe(ids.length);
    expect(new Set(placed).size).toBe(ids.length);
    expect(groups.some((g) => g.id === 'more')).toBe(false); // all known → no catch-all
  });
});

// The stand-in entries above label an app by its upper-cased id, which is fine
// for the mechanism but NOT for the real menu: the operator reads 'REPO MAP',
// never 'map', and 'RECORD', never 'stats'. These use the registry's real
// labels, so they pin what the dock actually renders.
const real = (pairs) => Object.entries(pairs).map(([id, label]) => [id, { label }]);

describe('the ordering law, with the labels the operator actually reads', () => {
  it('WORKSPACE is four bands, alphabetical inside each', () => {
    const [ws] = groupDockApps(real({
      chat: 'STREAM', chats: 'CHATS', teams: 'TEAMS',
      todo: 'TASKS', workflow: 'WORKFLOW', comfyui: 'COMFY', files: 'FILES',
      gallery: 'GALLERY', terminal: 'TERMINAL', security: 'SECURITY', legal: 'LEGAL', witnesses: 'WITNESSES',
    })).filter((g) => g.id === 'workspace');

    expect(ws.bands.map((b) => b.label)).toEqual(['TALK', 'WORK', 'CRAFT', 'WATCH']);
    const labels = (name) => ws.bands.find((b) => b.label === name).items.map(([, a]) => a.label);
    expect(labels('TALK')).toEqual(['CHATS', 'STREAM']);
    expect(labels('WORK')).toEqual(['TASKS', 'TEAMS', 'WORKFLOW']);
    expect(labels('CRAFT')).toEqual(['COMFY', 'FILES', 'GALLERY', 'TERMINAL']);
    expect(labels('WATCH')).toEqual(['LEGAL', 'SECURITY', 'WITNESSES']);
    // No band is big enough to be a wall again — that was the whole complaint.
    for (const b of ws.bands) expect(b.items.length).toBeLessThanOrEqual(4);
  });

  it('sorts by the LABEL, never the id — REPO MAP and RECORD prove which', () => {
    // By id the order would be contextmap, db, map, sheet, skills, stats.
    // By label it is CONTEXT MAP, DATA, RECORD, REPO MAP, SHEET, SKILLS.
    const [k] = groupDockApps(real({
      contextmap: 'CONTEXT MAP', db: 'DATA', map: 'REPO MAP',
      sheet: 'SHEET', skills: 'SKILLS', stats: 'RECORD',
    })).filter((g) => g.id === 'knowledge');
    expect(k.items.map(([, a]) => a.label))
      .toEqual(['CONTEXT MAP', 'DATA', 'RECORD', 'REPO MAP', 'SHEET', 'SKILLS']);
    expect(k.items.map(([id]) => id)).not.toEqual(['contextmap', 'db', 'map', 'sheet', 'skills', 'stats']);
  });

  it('a section small enough to scan carries ONE unnamed band — no header over a short list', () => {
    const [n] = groupDockApps(real({
      avatar: 'AVATAR', house: 'HOUSE', innerlife: 'INNER LIFE', refinement: 'NITE',
      sovereignty: 'SOVEREIGNTY', vessel: 'VESSEL', voice: 'VOICE',
    })).filter((g) => g.id === 'neuma');
    expect(n.bands).toHaveLength(1);
    expect(n.bands[0].label).toBeNull();
    expect(n.items.map(([, a]) => a.label))
      .toEqual(['AVATAR', 'HOUSE', 'INNER LIFE', 'NITE', 'SOVEREIGNTY', 'VESSEL', 'VOICE']);
  });

  it('an empty band never leaves its header hanging over nothing', () => {
    // Only CRAFT members present — TALK, WORK and WATCH must not render.
    const [ws] = groupDockApps(real({ files: 'FILES', terminal: 'TERMINAL' }))
      .filter((g) => g.id === 'workspace');
    expect(ws.bands.map((b) => b.label)).toEqual(['CRAFT']);
  });

  it('every band member is a real section member — bands and apps cannot drift apart', () => {
    for (const g of DOCK_GROUPS) {
      expect(g.bands.flatMap((b) => b.apps)).toEqual([...g.apps]);
    }
  });
});
