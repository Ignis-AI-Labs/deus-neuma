// taskbar (en) — the desk's taskbar and launcher (docs/work/os-taskbar-launcher.md).

export default Object.freeze({
  aria: 'Taskbar',
  launcher: 'Open the launcher (Ctrl+Space)',
  search: 'Search apps…',
  noMatch: 'No app matches “{{q}}”',
  cats: Object.freeze({
    beings: 'BEINGS',
    work: 'WORK',
    create: 'CREATE',
    reach: 'REACH',
    know: 'KNOW',
    system: 'SYSTEM',
    other: 'OTHER',
  }),
  pin: 'Pin to the taskbar',
  unpin: 'Unpin from the taskbar',
  newInstance: 'New {{app}}',
  close: 'Close',
  closeAll: 'Close all {{app}} windows',
  showNames: 'Show names',
  iconsOnly: 'Icons only',
  position: 'Taskbar position',
  edges: Object.freeze({
    bottom: 'Bottom',
    left: 'Left',
    top: 'Top',
  }),
  newDesk: 'New desk window',
  tray: 'System',
  pinned: 'Pinned',
  open: 'Open',
});
