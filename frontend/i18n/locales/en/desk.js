// desk (en) — the frame catalog: everything the operator NAVIGATES with.
// Source catalog — values are the strings the UI renders today, VERBATIM
// (curly quotes, em-dashes and all): the suite pins many of them, and
// extraction is not an edit pass.
//
//   apps.*      registry launcher labels, keyed by registry id. Platform
//               windows (X, TELEGRAM, DISCORD…) are brand names and hold no
//               key — they render their registry label raw, in every language.
//   sections.*  dock section labels, keyed by dock-groups.js group id.
//   bands.*     WORKSPACE band labels, keyed by a lowercase fold of the band.
//   chrome.*    window/dock chrome + aria.
//   hud.*       the link-status lights ({{provider}} is a provider id —
//               never translated; {{count}} a number).
//   stream.*    the stream window's header controls and sitting strip.
//
// Being names, chat titles, file names and wallet addresses are identity or
// user data: they ride {{slots}}, never the catalog.

export default Object.freeze({
  apps: Object.freeze({
    avatar: 'AVATAR',
    bench: 'BENCH',
    chat: 'STREAM',
    chats: 'CHATS',
    comfyui: 'COMFY',
    contextmap: 'CONTEXT MAP',
    db: 'DATA',
    editor: 'EDITOR',
    files: 'FILES',
    gallery: 'GALLERY',
    house: 'HOUSE',
    image: 'IMAGE',
    innerlife: 'INNER LIFE',
    map: 'REPO MAP',
    pdf: 'PDF',
    refinement: 'NITE',
    security: 'SECURITY',
    legal: 'LEGAL',
    treasury: 'TREASURY',
    settings: 'SETTINGS',
    sheet: 'RECORD',
    skills: 'SKILLS',
    skillsTitle: 'THE CRAFT',
    sovereignty: 'SOVEREIGNTY',
    staff: 'CHIEF OF STAFF',
    houseclock: 'HOUSE CLOCK',
    companyline: 'COMPANY LINE',
    substrate: 'SUBSTRATE',
    teams: 'TEAMS',
    terminal: 'TERMINAL',
    todo: 'TASKS',
    vessel: 'VESSEL',
    voice: 'VOICE',
    wallet: 'WALLET',
    witnesses: 'WITNESSES',
    workflow: 'WORKFLOW',
    marketing: 'MARKETING',
    brandKits: 'BRAND KITS',
    leads: 'LEADS',
  }),

  sections: Object.freeze({
    neuma: 'NEUMA',
    workspace: 'WORKSPACE',
    marketing: 'MARKETING',
    community: 'COMMUNITY',
    knowledge: 'KNOWLEDGE',
  }),

  bands: Object.freeze({
    talk: 'TALK',
    work: 'WORK',
    craft: 'CRAFT',
    watch: 'WATCH',
    measure: 'MEASURE',
  }),

  chrome: Object.freeze({
    newWindow: 'NEW WINDOW',
    newInstance: 'NEW {{app}}',
    startMenuAria: 'Start menu',
    dockAria: 'Component dock',
    expand: 'Expand window',
    minimize: 'Minimize window',
    maximize: 'Maximize window',
    restore: 'Restore window',
    close: 'Close window',
  }),

  disconnect: Object.freeze({
    wallet: 'DISCONNECT WALLET',
    confirmAria: 'Confirm wallet disconnect',
    confirmLabel: 'DISCONNECT',
    body: 'Disconnect this wallet and return to sign-in? Your neuma and files remain on this computer.',
  }),

  hud: Object.freeze({
    localSevered: 'LOCAL — SEVERED',
    substrateStandby: 'SUBSTRATE — STANDBY',
    substrateOffline: 'SUBSTRATE — OFFLINE',
    localShared: 'LOCAL — SHARED ({{count}} STREAMS)',
    localActive: 'LOCAL — ACTIVE',
    localChecking: 'LOCAL — CHECKING',
    routeSevered: 'ROUTE — SEVERED',
    routeUnbound: 'ROUTE — UNBOUND',
    routeUnknown: 'ROUTE — UNKNOWN',
    routeLive: 'ROUTE — {{provider}} — LIVE',
    routeDown: 'ROUTE — {{provider}} — DOWN',
    routeProviderUnknown: 'ROUTE — {{provider}} — UNKNOWN',
    session: 'SESSION {{clock}}',
    turn: 'TURN {{count}}',
    folder: 'FOLDER — {{name}}',
  }),

  portalTitle: '{{name}} // PORTAL',

  stream: Object.freeze({
    newChat: 'NEW CHAT',
    newChatTitle: 'Start a fresh chat here — replaces this one; {{tab}} opens another alongside it',
    council: 'COUNCIL',
    councilTitleEnter: 'Switch this window to the council — several neuma, one room',
    councilTitleLeave: 'Back to the one-on-one stream',
    councilTitleNamed: 'COUNCIL · {{members}}',
    talk: 'TALK',
    talkTitleEnter: 'Talk with the being — voice sitting, mic open, the composer steps aside',
    talkTitleLeave: 'Leave the talk — the composer returns exactly',
    sndOn: 'SND ON',
    sndOff: 'SND OFF',
    standbyOn: 'STANDBY ON',
    standbyOff: 'STANDBY OFF',
    standbyTitleLocked: 'Standby is held OFF at launch by SUBSTRATE_IDLE_MINUTES=0 — the substrate stays resident',
    standbyTitleOn: 'The substrate rests after {{minutes}} idle minutes and reloads on the next summon — click to keep it resident',
    standbyTitleOff: 'The substrate stays resident once ignited — click to let it rest when idle',
    standbyError: 'Standby did not change',
    ignite: 'IGNITE',
    igniting: 'IGNITING…',
    retryIgnite: 'RETRY IGNITE',
    igniteTitle: 'Start the local substrate model',
    witnessTag: 'WITNESS',
    urgentTitle: 'Interject NOW — cut the reply and take the floor',
    micBlocked: 'MIC BLOCKED — NO INPUT, SEE THE CONSOLE',
    micOff: 'MIC OFF',
    micOpening: 'MIC OPENING…',
    micRequested: 'MIC REQUESTED — NOT OPEN',
    micOnUnnamed: 'MIC ON · UNNAMED DEVICE',
    micNamed: 'MIC · {{device}}',
    railChats: 'CHATS',
    railChatsTitle: "This being's chats",
    newChatRail: '+ NEW CHAT',
    newTab: '+ TAB',
    newTabTitle: 'Another sitting with {{who}} — {{kind}}',
    tabKindWitness: 'a sealed witness',
    tabKindLocal: 'on this machine',
    newTabTitleAny: 'Another sitting with whoever is in the chair',
    tabsAria: 'Open sittings',
    chatStamp: 'NEW CHAT',
    chatStarted: 'STARTED {{when}}',
    voiceSitting: '«VOICE SITTING»',
    theBeing: 'THE BEING',
    exit: 'EXIT',
    exitTitle: 'Leave the voice sitting (Escape) — the composer returns exactly',
    escapeHint: 'ESCAPE OR EXIT RETURNS THE COMPOSER.',
    speakOpen: 'SPEAK — THE MIC IS OPEN.',
    speakHearing: 'HEARING YOU — RELEASE TO SEND.',
    speakSending: 'GOT IT — SENDING…',
    speakHold: 'HOLD SPACE TO SPEAK.',
  }),

  participant: Object.freeze({
    neumaOnlyTitle: 'NEUMA RECORD ONLY',
    neumaOnlyBody: '{{name}} is a sealed witness. {{app}} shows a neuma’s record and does not apply to this lane.',
    thisParticipant: 'This participant',
  }),
});
