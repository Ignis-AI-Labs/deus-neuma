// settings (en) — the Settings window's own copy, source catalog.
// Values are the strings the UI renders today, VERBATIM (curly quotes and
// all): the suite pins many of them, and extraction is not an edit pass.
// Grouped per section; interpolation slots ride {{double braces}}.

export default Object.freeze({
  tablistAria: 'Settings sections',
  tabs: Object.freeze({
    general: 'GENERAL',
    look: 'LOOK',
    memory: 'MEMORY',
    models: 'MODELS',
    api: 'API',
    security: 'SECURITY',
  }),

  language: Object.freeze({
    heading: 'LANGUAGE',
    note: 'The language this desk speaks — labels, settings, and every surface that has been translated. More languages land as their catalogs are ratified.',
    preview: 'PREVIEW (INCOMPLETE)',
  }),

  account: Object.freeze({
    heading: 'ACCOUNT',
    note: 'Your name is how this platform — and every being on it — addresses you. The HOUSE window, the founding rite, and each portal turn read it from here. Your wallet remains the proof; the name is the greeting.',
    placeholder: 'Your name',
    nameAria: 'operator name',
    savedLocalOnly: 'SAVED HERE — SYNC FAILED',
    wallet: 'Wallet',
  }),

  desk: Object.freeze({
    heading: 'DESK',
    note: 'How the desk asks before acting. “Don’t ask again” on a confirmation lands here — turn the asking back on any time.',
    deleteKey: 'Delete',
    confirmToggle: 'CONFIRM BEFORE DELETE — {{state}}',
  }),

  sound: Object.freeze({
    heading: 'SOUND',
    note: 'The desk’s own voice — the cues under your controls and the bed under a being’s typing. A neuma’s spoken voice is a separate channel, dialled in its own window.',
    soundKey: 'Sound',
    toggle: 'SOUND — {{state}}',
    volumeKey: 'Volume',
    volumeAria: 'Sound volume',
    executionTitle: 'EXECUTION & FILES — {{count}}',
    executionNote: 'Builds, tests, checks, dependencies, Git and file actions each have a distinct cue. Mixed commands have their own sound; unrecognized commands use Other execution. The chip shows the command.',
    actsTitle: 'ACTS — {{count}}',
    actsNote: 'External reads, publishing, artifact generation, records, state inspection and failures. Audition these candidate sounds here.',
    worldTitle: 'THE WORLD — {{count}}',
    worldNote: 'The ratified soundscape — the portal, the stream, the ceremony. Locked by ear; here to hear against.',
  }),

  realm: Object.freeze({
    heading: 'DATA REALM',
    note: 'Your own copy of every conversation, here on this machine — separate from each neuma\'s sovereign workspace. Plain text. Yours to read, move, or delete.',
    location: 'Location',
    yourFolder: 'Your folder',
    chatLogs: 'Chat logs',
    empty: 'NO CHATS LOGGED YET — TALK TO A NEUMA AND THEY APPEAR HERE.',
    loading: 'READING THE REALM…',
    change: Object.freeze({
      heading: 'CHANGE LOCATION',
      note: 'An absolute path on this machine. This changes the realm location for every wallet on this app. Existing files stay in their current folder; they are not moved.',
      pathAria: 'Realm location',
      confirmAria: 'Confirm realm location change',
      confirmAction: 'SET LOCATION',
      confirmBody: 'Switch the app\'s data realm to <code>{{path}}</code>? Existing conversations and settings stay in the old folder and may disappear from view until you switch back or move them yourself.',
    }),
  }),

  press: Object.freeze({
    heading: 'THE PRESS',
    note: 'Press markdown into branded PDF documentation. Brand kits live in data/brand-kits/ on this machine — duplicate a kit directory, swap the logos, edit kit.json, and your house has its own livery. Beings press through their own press_document tool, gated like every act.',
    noChromium: 'No Chromium found on this machine — the press cannot render. Set NEUMA_CHROMIUM_PATH or install Chrome/Chromium.',
    kits: 'KITS',
    kitsNone: 'none configured — the neutral kit is always available',
    pickFile: 'PICK .MD FILE',
    pastePlaceholder: '…or paste markdown here',
    titlePlaceholder: 'Document title (optional)',
    kitAria: 'Brand kit',
    kitNeutral: 'neutral (no branding)',
    pressing: 'PRESSING…',
    press: 'PRESS TO PDF',
    pressed: 'Pressed {{filename}} ({{size}} KB).',
  }),

  hotkeys: Object.freeze({
    heading: 'HOTKEYS',
    note: 'Every key the desk answers to. Window shortcuts appear when NEUMA runs as the desktop app.',
  }),
});
