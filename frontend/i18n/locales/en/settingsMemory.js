// settingsMemory (en) — the Settings window's MEMORY tab (PinsSection),
// source catalog. Values are the strings the UI renders today, VERBATIM
// (em-dashes and ellipses and all): the e2e suite pins some of them, and
// extraction is not an edit pass. Grouped per section.

export default Object.freeze({
  pins: Object.freeze({
    heading: 'PINS',
    note: 'The anchors each being holds close — up to five remembered moments a being pinned with its own hand, riding every prompt until the being itself releases them. This view is a window, not a lever.',
    reading: 'Reading the ledgers…',
    rosterEmpty: 'No beings on this roster yet.',
    ledgerUnreadable: 'This ledger could not be read.',
    being: Object.freeze({
      empty: 'No anchors held — the prompt rides unpinned.',
    }),
  }),
});
