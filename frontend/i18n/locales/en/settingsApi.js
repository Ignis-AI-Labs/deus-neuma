// settingsApi (en) — the Settings window's API tab (channel keys, email,
// web access), source catalog. Values are the strings the UI renders today,
// VERBATIM (em-dashes, ✓/✗ and «NOTICE» and all): the suite pins some of
// them, and extraction is not an edit pass. Grouped per section, mirroring
// each component's own structure; interpolation slots ride {{double braces}}.

export default Object.freeze({
  channelKeys: Object.freeze({
    heading: 'CHANNEL KEYS',
    note: 'The API keys for every platform the house speaks through. Sealed on this machine, never shown again. Keys alone let no one post — each platform is bound to its one holder in its own platform window, and every post still asks you first unless you grant ALWAYS. The FLIGHT TEST line is the live proof: the platform accepted the key and named the account — RE-TEST probes it again right now.',
    reading: 'Reading the board…',
    flight: Object.freeze({
      untested: 'UNTESTED',
      proven: 'PROVEN',
      live: 'FLIGHT ✓ {{account}}',
      liveDetail: 'FLIGHT ✓ {{account}} — {{detail}}',
      down: 'FLIGHT ✗ {{detail}}',
      unconfigured: 'not configured — nothing to prove',
    }),
    card: Object.freeze({
      flightTest: 'FLIGHT TEST',
      retest: 'RE-TEST',
      retestTitle: 'Probe the connection live, right now',
      retestTitleIdle: 'Nothing to probe until keys are set',
      fieldSetPlaceholder: '{{label}} — set ({{source}})',
      save: 'SAVE KEYS',
      forget: 'FORGET KEYS',
    }),
    // The CONNECT sign-in a channel needs beyond its keys (YouTube: Google, in the browser).
    connect: Object.freeze({
      label: 'CONNECTION',
      connect: 'CONNECT',
      reconnect: 'RECONNECT',
      cancel: 'CANCEL',
      connected: 'CONNECTED · {{channel}}',
      notConnected: 'NOT CONNECTED',
      waiting: 'Finish the Google sign-in in your browser…',
      needClient: 'Save the OAuth client id and secret first, then CONNECT.',
      failed: 'The connect did not finish.',
      tiktokWaiting: 'Finish the TikTok sign-in in your browser…',
      tiktokNeedClient: 'Save the TikTok client key and secret first, then CONNECT.',
    }),
  }),

  email: Object.freeze({
    heading: 'EMAIL',
    note: 'Connect the address your house writes from, and bind the mailbox to the one neuma who holds that position. The account is sealed on this machine and never shown again; an unbound mailbox lets no one write. Every send and every inbox read still asks you first unless you grant ALWAYS — and you can always watch the mailbox itself from your own mail client.',
    reading: 'Reading the account…',
    card: Object.freeze({
      heldBy: 'HELD BY {{holder}}',
      holder: 'HOLDER',
      unbound: 'UNBOUND — no one may write',
      note: 'Gmail needs 2-step verification plus an app password; the host and port fields already default to Gmail. Any provider — or your own domain — works by overriding them.',
      fieldSetPlaceholder: '{{label}} — set ({{source}})',
      save: 'SAVE ACCOUNT',
      forget: 'FORGET ACCOUNT',
      holderAria: 'Mailbox holder',
      holderPlaceholder: '— choose the holder —',
      bind: 'BIND',
      release: 'RELEASE',
    }),
  }),

  web: Object.freeze({
    heading: 'WEB ACCESS',
    note: 'Internet research is available by default. Every reach outward still asks you first unless you grant ALWAYS. Switch it off for an explicit air gap: no search, no pages, no egress.',
    egressKey: 'Egress',
    egressOn: 'ON — beings may reach the internet',
    egressOff: 'OFF — air-gap posture',
    lockedByOperator: 'LOCKED BY OPERATOR',
    searchKey: 'Search indexes',
    pageReaderKey: 'Page reader',
    reading: 'Reading the switch…',
    switching: 'SWITCHING…',
    switchOff: 'SWITCH OFF',
    switchOn: 'SWITCH ON',
    envLockedNote: '«NOTICE» The operator\'s launch env ({{env}}) holds egress off regardless of this switch — the switch takes effect only once the lock lifts.',
  }),

  serviceKeys: Object.freeze({
    heading: 'SERVICE KEYS',
    note: 'Keys and addresses for outside services that are not models: web search, the page reader, model downloads, chain RPC, and the benchmarks\' search. Sealed on this machine in the same encrypted store as your provider keys and never shown again. A value saved here is used instead of the same setting in the env file, so developers can keep their env file and everyone else never needs it.',
    reading: 'Reading the services…',
    keyAria: '{{name}} API key',
    keyPlaceholder: 'API key',
    keyStoredPlaceholder: '•••••••• (stored) — type to replace',
    save: 'SAVE',
    remove: 'REMOVE',
    removeConfirmAria: 'Confirm service key removal',
    removeConfirm: 'Remove the saved {{name}} key from this computer? Anything that reads it stops working until a new key is saved.',
  }),
});
