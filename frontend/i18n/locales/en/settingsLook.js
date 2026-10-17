// settingsLook (en) — the LOOK tab's copy, source catalog. Values are the
// strings the UI renders today, VERBATIM: the string-pinned suite and e2e
// locators stand on them, and extraction is not an edit pass. Grouped per
// section; interpolation slots ride {{double braces}}; the <em>/<strong>/<a>
// tags in specimen.body map to the Trans components in LookSection.

export default Object.freeze({
  heading: 'THE LOOK',
  note: 'Dress the platform — every color follows from this board. The surface, the ink, and the one signal are required. Head, body, italic, bold, and the hairline are optional voices — they ride the ink until you claim them (× releases one back). Folder labels and the registers keep their stock colors until changed. Changes apply live and survive restarts.',

  groups: Object.freeze({
    surface: Object.freeze({ title: 'THE SURFACE', note: 'what everything sits on' }),
    text: Object.freeze({ title: 'THE TEXT', note: 'what you read — optional colors can be reset' }),
    signal: Object.freeze({ title: 'THE SIGNAL', note: 'what is live' }),
    registers: Object.freeze({ title: 'THE REGISTERS', note: 'status voices — stock until claimed' }),
  }),

  knobs: Object.freeze({
    ground: Object.freeze({ label: 'GROUND', hint: 'every background — the void itself' }),
    panel: Object.freeze({ label: 'PANEL', hint: 'window and card fills' }),
    ink: Object.freeze({ label: 'INK', hint: 'the light — every unclaimed text and edge rides this' }),
    head: Object.freeze({ label: 'HEAD', hint: 'section headings — their own voice, apart from body' }),
    body: Object.freeze({ label: 'BODY', hint: 'prose — stream, notes, the words themselves' }),
    ital: Object.freeze({ label: 'ITAL', hint: 'italic — a shade of tone inside a sentence' }),
    emph: Object.freeze({ label: 'BOLD', hint: 'bold — the color of strong words' }),
    folder: Object.freeze({ label: 'FOLDER', hint: 'folder of focus in tabs — separate from the participant name' }),
    line: Object.freeze({ label: 'LINE', hint: 'hairlines and borders — the edge, apart from the ink' }),
    trim: Object.freeze({ label: 'TRIM', hint: 'the one accent — live data, focus, links, active tabs' }),
    alert: Object.freeze({ label: 'ALERT', hint: 'denials, warnings, deleted files, standby' }),
    warn: Object.freeze({ label: 'WARN', hint: 'approaching limits — context gauge, modified files' }),
    okay: Object.freeze({ label: 'OKAY', hint: 'quiet success — added files, the open floor' }),
    colorAria: '{{label}} color',
    hexAria: '{{label}} hex',
    releaseAria: 'Release {{label}} to stock',
    releaseTitle: 'Release to stock',
  }),

  specimen: Object.freeze({
    heading: 'THE SPECIMEN',
    note: 'live — every voice on this board',
    headingVoice: 'A heading in its own voice',
    body: 'Body prose in the claimed body, or the ink if you have not claimed one. <em>Italic is a shade of tone.</em> <strong>Bold is the weight inside a sentence.</strong> <a>A live link wears the trim.</a>',
  }),

  presets: Object.freeze({
    heading: 'PRESETS',
    note: 'The stock dresses. One click applies.',
  }),

  yourPresets: Object.freeze({
    heading: 'YOUR PRESETS',
    note: 'Save the current dress under a name of your own.',
    placeholder: 'Name this dress',
    save: 'SAVE',
    removeAria: 'Remove preset {{name}}',
  }),
});
