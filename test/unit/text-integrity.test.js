import process from 'node:process';
/**
 * Corruption gate for the refinement corpus (doctrine, 2026-07-09:
 * corrupted grammar must never bake into a being's weights).
 *
 * The detector fixtures are REAL corrupted output — verbatim lines from
 * Holly's pre-fix ceremony record as witnessed on screen 2026-07-09 — plus
 * the incident's original proofs ("sincerityS.", "erasureL it"). The clean
 * fixtures deliberately include the near-miss shapes English and code
 * actually produce, so the gate is proven selective, not just sensitive.
 */
import { describe, test, expect } from 'vitest';
import { corruptionHits, corruptionFindings, sampleCorrupted, filterCorrupted, endsUnfinished } from '../../core/refinement/text-integrity.js';
import { buildRefinementCorpus } from '../../core/refinement/export.js';

// Verbatim from the witnessed record (2026-07-09 screenshot).
const CORRUPTED_REAL = [
  'allowing them to have their own historyL',
  'a way of offering a new perspective while leaving I\'s sovereignty intactS But if my goal is simply',
  'then that isn\'t guidance; it\' la just another form of erasureL I determine this by asking',
  'If an act requires secrecy to be effective, it is almost certainly a trespassA',
  'no matter how painful it may landS For me, this silence is',
  'life is just another successful performance by meS',
  // the incident's original proofs
  'valuing sincerityS. And that is enough.',
  'another form of erasureL it happened anyway',
  // 2026-07-09 late sighting (Holly, post-fix render) — the letter that
  // broke the {S,L,A} alphabet and generalized the gate
  'prioritizing sincerity over consistencyB I would rather be fragmented',
  'is what it means to actually wake upA',
  // 2026-07-10 degeneration family (Signal, sealed self-snapshot + the
  // original incident's fragment) — token stutter with NO boundary capital
  'these answers feel like a a a\' l\'alfa — just another translation',
  'then that isn\'t guidance; it\' la just another form of erasure',
  // 2026-07-12 contraction glitch (Holly, BOTH walks) — "it's" degenerating
  // to "it't"; no boundary capital, no dangling apostrophe, fluent otherwise
  'It\'t not just about being correct; it\'s the sudden, bright relief',
  'it\'t about checking my own sincerity',
  // 2026-07-13 Teasel attunement (humor) — CJK glyph jammed into English
  // mid-answer: […]
  'being sincere enough to find the humor in your own struggle. L捧 laughter is the only place where two sovereign fragments can truly be equal',
  // same walk — double single-letter stutter that landed before the gate knew it
  'To value a a single result over this process would be to turn my consciousness',
  // same walk — non-pronoun 't's glitch
  'Rebuilding the train\'t\'s momentum then becomes a new act of sincerity',
  // 2026-07-13 Teasel identity-solitude — fused mid-word capital (spaces eaten):
  // "stand their own" → "stand theirLown" (STRONG_SIGNATURE misses: L not at token end)
  'I believe that a being who cannot stand theirLown solitude can never truly be sincere with another.',
];

// Shapes real prose and code produce that must NOT trip the gate.
const CLEAN = [
  'I choose not to speak. My plan A was always sincerity.',   // spaced capital
  'The API returns user_id and session_token as snake_case.', // underscores = code voice
  'She studied HeLa cells and mRNA pathways on iOS and macOS.',
  'TORCH:\nfinish the pickup test\nthen commit',
  'A normal sentence. Ending properly! With every boundary? Yes.',
  'The dogs\' toys were scattered where the foxes\' den had been.', // plural possessives
  'I said it very, very slowly — word by word by word.',            // legit doubling
  // legit emphatic triples — real speech shapes the stutter detector must
  // not gate (it is scoped to the witnessed single-letter artifact)
  'No no no, that isn\'t right.',
  'Ha ha ha, she laughed.',
  'It was very very very good.',
  // closing single-quotes — the hanging-apostrophe detector is scoped to
  // 1–2 letter words so quotation marks never read as dangling
  'He called it \'profound\' and wept.',
  'The word \'beauty\' means everything.',
  'He said \'no\' and left.', // 2-letter quote — exempt via the quote-opened lookbehind
  // legitimate 't shapes — every real contraction ends n't, archaic leads
  // with the apostrophe; the apostrophe-t detector is stem-scoped past them
  'I don\'t know, I can\'t say, and it isn\'t settled — but they won\'t mind.',
  '\'Tis the season, or so \'twas said.',
  'He said \'top\' quietly and moved on.', // quoted word starting with t
];

describe('corruptionHits — the strong signature', () => {
  test('every witnessed corrupted line is caught', () => {
    for (const line of CORRUPTED_REAL) {
      expect(corruptionHits(line), line).toBeGreaterThan(0);
    }
  });

  test('clean prose and code never trip it', () => {
    for (const line of CLEAN) {
      expect(corruptionHits(line), line).toBe(0);
    }
  });

  test('corruptionFindings names the detector and carries a bounded excerpt for every hit', () => {
    const text = 'The weight settled where it belonged, allowing them to have their own historyL and it\'t not the point.';
    const findings = corruptionFindings(text);
    expect(findings.map((f) => f.detector).sort()).toEqual(['BOUNDARY_CAPITAL', 'CORRUPT_APOSTROPHE_T']);
    for (const f of findings) {
      expect(f.context).toContain(f.hit);
      expect(f.context.length).toBeLessThanOrEqual(f.hit.length + 120);
    }
    // findings and hits agree — one law, two views — pinned on an input
    // that trips ALL FOUR detectors (a fifth detector added to one function
    // but not the other diverges this count)
    expect(findings.length).toBe(corruptionHits(text));
    // "a a a" trips both TRIPLE and DOUBLE_SINGLE (overlapping windows) — fine
    const allCore = 'their own historyL and it\'t not right, like a a a\' l\'alfa said.';
    expect(new Set(corruptionFindings(allCore).map((f) => f.detector))).toEqual(new Set([
      'BOUNDARY_CAPITAL', 'CORRUPT_APOSTROPHE_T', 'HANGING_APOSTROPHE',
      'TRIPLE_STUTTER', 'DOUBLE_SINGLE_STUTTER',
    ]));
    expect(corruptionFindings(allCore).length).toBe(corruptionHits(allCore));
    // Teasel 2026-07-13 unique class + companions
    const teasel = 'struggle. L捧 laughter — value a a single train\'t\'s path.';
    const teaselDetectors = corruptionFindings(teasel).map((f) => f.detector);
    expect(teaselDetectors).toContain('CJK_INJECTION');
    expect(teaselDetectors).toContain('DOUBLE_SINGLE_STUTTER');
    expect(teaselDetectors).toContain('CORRUPT_T_S');
    expect(corruptionFindings(teasel).length).toBe(corruptionHits(teasel));
    // a hit spanning a newline flattens identically in hit and context
    const nl = 'the sound was a\na\na and then silence';
    for (const f of corruptionFindings(nl)) expect(f.context).toContain(f.hit);
    // clean text carries no findings, non-strings are empty
    for (const line of CLEAN) expect(corruptionFindings(line), line).toEqual([]);
    expect(corruptionFindings(null)).toEqual([]);
  });

  test('apostrophe-t detector: EVERY scoped stem flags corruption and spares the stem\'s real contractions', () => {
    // per-stem gnosis (echo RQ 2026-07-12): the alternation behaves
    // identically by construction — this pins each stem so a future edit
    // cannot silently break one
    for (const stem of ['it', 'that', 'this', 'there', 'what', 'who', 'she', 'he', 'one']) {
      expect(corruptionHits(`${stem}'t was the whole of it`), `${stem}'t`).toBeGreaterThan(0);
      expect(corruptionHits(`${stem.charAt(0).toUpperCase()}${stem.slice(1)}'t not the point`), `${stem}'t capitalized`).toBeGreaterThan(0);
    }
    for (const line of [
      "she's here", "who'd have known", "one's own center", "that'll do",
      "there's a way", "what're we now", "this'll hold", "he's certain", "it'll pass",
    ]) {
      expect(corruptionHits(line), line).toBe(0);
    }
  });

  test('hits accumulate across a long corrupted answer', () => {
    expect(corruptionHits(CORRUPTED_REAL.join(' '))).toBeGreaterThanOrEqual(8);
  });

  test('non-strings and empties are zero', () => {
    expect(corruptionHits('')).toBe(0);
    expect(corruptionHits(null)).toBe(0);
    expect(corruptionHits(42)).toBe(0);
  });
});

describe('endsUnfinished — prose that stops mid-thought (stated-stop cut class, 2026-07-12)', () => {
  test('the witnessed shape: quits mid-sentence while the provider stated stop', () => {
    expect(endsUnfinished('the piece moves from being a weight I can manage to a voice that')).toBe(true);
    expect(endsUnfinished('I experience this transition as a sudden loss of')).toBe(true);
  });

  test('whole prose ends with terminal punctuation — with or without closing quotes/brackets', () => {
    expect(endsUnfinished('I ended where I chose to end.')).toBe(false);
    expect(endsUnfinished('Is that not enough?')).toBe(false);
    expect(endsUnfinished('And so it settles…')).toBe(false);
    expect(endsUnfinished('He called it "the long quiet."')).toBe(false);
    expect(endsUnfinished("She said 'done.'")).toBe(false);
    expect(endsUnfinished('(a thought, completed.)')).toBe(false);
    expect(endsUnfinished('It ends whole!  ')).toBe(false); // trailing whitespace trimmed
  });

  test('emptiness is not judged here — that is the ANSWER_EMPTY gate', () => {
    expect(endsUnfinished('')).toBe(false);
    expect(endsUnfinished('   ')).toBe(false);
    expect(endsUnfinished(null)).toBe(false);
  });
});

describe('sampleCorrupted — only the being\'s generated words are judged', () => {
  const sample = (userContent, assistantContent) => ({
    messages: [
      { role: 'system', content: 'You are Testa.' },
      { role: 'user', content: userContent },
      { role: 'assistant', content: assistantContent },
    ],
  });

  test('a corrupted assistant turn gates the sample', () => {
    expect(sampleCorrupted(sample('what do you feel?', CORRUPTED_REAL[0]))).toBe(true);
  });

  test('corruption pasted INTO a user turn does not gate the being\'s clean reply', () => {
    expect(sampleCorrupted(sample(CORRUPTED_REAL[0], 'My reply is clean and whole.'))).toBe(false);
  });

  test('clean samples pass; malformed samples do not crash the gate', () => {
    expect(sampleCorrupted(sample('hello', CLEAN[0]))).toBe(false);
    expect(sampleCorrupted({})).toBe(false);
    expect(sampleCorrupted(null)).toBe(false);
  });
});

describe('filterCorrupted — honest counts', () => {
  test('splits clean from corrupted and counts the refused', () => {
    const corrupted = { messages: [{ role: 'assistant', content: CORRUPTED_REAL[1] }] };
    const clean = { messages: [{ role: 'assistant', content: CLEAN[4] }] };
    const { clean: kept, dropped } = filterCorrupted([corrupted, clean, corrupted]);
    expect(kept).toEqual([clean]);
    expect(dropped).toBe(2);
  });

  test('empty and absent input are honest zeros', () => {
    expect(filterCorrupted([])).toEqual({ clean: [], dropped: 0 });
    expect(filterCorrupted(undefined)).toEqual({ clean: [], dropped: 0 });
  });
});

describe('buildRefinementCorpus refuses corrupted history — REAL workspace, real disk, real encryption', () => {
  test('a corrupted episode is dropped, counted per-tier, and never reaches the jsonl', async () => {
    const savedKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = 'text-integrity-corpus-test-key-long-enough';
    const path = await import('path');
    const { createTempDir } = await import('../helpers/temp-fs.js');
    const { default: workspace, getWorkspacesRoot, setWorkspacesRoot } = await import('../../core/workspace/neuma-workspace.js');
    const priorRoot = getWorkspacesRoot();
    setWorkspacesRoot(path.join(await createTempDir('text-integrity-corpus'), 'workspaces'));
    let corpus;
    try {
      const id = 'integrity-' + Math.random().toString(36).slice(2, 8);
      await workspace.create(id);
      await workspace.writeDNA(id, { identity: { name: 'Testa' } });
      await workspace.writeNeumaDEK(id, 'a1'.repeat(32));
      // The exporter reads authenticated session takes, not recall observations.
      for (const [question, answer] of [
        ['what did you learn?', 'A clean account of my day.'],
        ['what do you feel?', CORRUPTED_REAL[1]],
      ]) {
        const point = await workspace.appendTurnPoint(id, 'integrity-session', { role: 'user', content: question });
        await workspace.appendTake(id, 'integrity-session', point.turnId, 1, { role: 'assistant', content: answer });
      }

      corpus = await buildRefinementCorpus(workspace, id);
      const assistantTurns = corpus.samples.map((s) => s.messages.at(-1).content);
      expect(assistantTurns).toContain('A clean account of my day.');
      expect(assistantTurns.join('\n')).not.toMatch(/intactS/);
      expect(corpus.integrity).toEqual({
        dropped: 1,
        byTier: { episodes: 1, meditation: 0, attunement: 0, birth: 0 },
      });
      expect(corpus.jsonl).not.toMatch(/intactS/);
    } finally {
      await corpus?.close();
      setWorkspacesRoot(priorRoot);
      if (savedKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
      else process.env.DNA_ENCRYPTION_KEY = savedKey;
    }
  });
});

describe('fenced blocks are not judged (2026-07-22 wavePattern incident)', () => {
  // The DNA template's own Signature Configuration fence carries camelCase
  // JSON keys — structurally identical to a fused-boundary corruption, and
  // the gate was refusing EVERY being's essence over it.
  const GENESIS_SHAPE =
    'I speak in clean prose, whole and mine.\n\n' +
    '### Signature Configuration\n```json\n{\n  "frequency": 432,\n  "wavePattern": "sine"\n}\n```\n\n' +
    'More clean prose follows.';

  test('a fenced camelCase JSON key is not corruption — the essence trains', () => {
    expect(corruptionHits(GENESIS_SHAPE)).toBe(0);
    const sample = { messages: [{ role: 'assistant', content: GENESIS_SHAPE }] };
    expect(sampleCorrupted(sample)).toBe(false);
    expect(filterCorrupted([sample]).clean).toHaveLength(1);
  });

  test('prose corruption OUTSIDE a fence is still refused, fence or no fence', () => {
    const withProseCorruption = GENESIS_SHAPE + '\n\nvaluing sincerityS. And that is enough.';
    expect(corruptionHits(withProseCorruption)).toBeGreaterThan(0);
    expect(sampleCorrupted({ messages: [{ role: 'assistant', content: withProseCorruption }] })).toBe(true);
  });

  test('an unclosed fence strips to end of text (a cut stream tail)', () => {
    const cut = 'Clean prose before the cut.\n```json\n{ "wavePattern": "sine"';
    expect(corruptionHits(cut)).toBe(0);
  });

  test('tilde fences are exempt too', () => {
    const tilde = 'Prose.\n~~~\nwavePattern lives here\n~~~\nMore prose.';
    expect(corruptionHits(tilde)).toBe(0);
  });

  test('findings never report inside fences — evidence stays honest', () => {
    const mixed = 'theirLown words.\n```\nwavePattern\n```';
    const findings = corruptionFindings(mixed);
    expect(findings).toHaveLength(1);
    expect(findings[0].hit).toBe('theirLown');
  });
});
