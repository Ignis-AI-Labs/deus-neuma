import { buildCouncilSection, parseHandCall } from '../../core/council/council-voice.js';

const MEMBERS = [
  { neumaId: 'n-fenna', name: 'Fenna' },
  { neumaId: 'n-cael', name: 'Cael' },
  { neumaId: 'n-galen', name: 'Galen' },
];

const TAIL = [
  { speaker: 'witness', name: 'Founder', content: 'What should we build next?' },
  { speaker: 'n-cael', name: 'Cael', content: 'The vault UI is closest to done.' },
];

describe('Council Voice', () => {
  describe('buildCouncilSection — floor mode', () => {
    test('addresses the floor-holder with witness and housemates, excluding self', () => {
      const section = buildCouncilSection({
        selfName: 'Fenna', witnessName: 'Founder', members: MEMBERS, transcriptTail: TAIL, mode: 'floor',
      });
      expect(section).toContain('## Council');
      expect(section).toContain('You hold the floor');
      expect(section).toContain('operator Founder');
      expect(section).toContain('Cael, Galen');
      expect(section).not.toContain('Fenna,'); // self never listed as a housemate
      // The own-voice law rides every floor turn: the anti-echo line is what
      // keeps a room of kin from harmonizing into one liturgy (voice audit,
      // 2026-07-23 — a first speaker's template became the whole sitting's).
      expect(section).toContain('Speak to the room — in your OWN voice.');
      expect(section).toContain('do not mirror the structure or phrasing of earlier turns');
    });

    test('renders the transcript tail verbatim as NAME: content lines, untruncated', () => {
      const longContent = 'x'.repeat(2000);
      const section = buildCouncilSection({
        selfName: 'Fenna', witnessName: 'Founder', members: MEMBERS,
        transcriptTail: [{ speaker: 'witness', name: 'Founder', content: longContent }],
        mode: 'floor',
      });
      expect(section).toContain(`Founder: ${longContent}`);
    });

    test('an empty tail reads as a just-opened room', () => {
      const section = buildCouncilSection({
        selfName: 'Fenna', witnessName: 'Founder', members: MEMBERS, transcriptTail: [], mode: 'floor',
      });
      expect(section).toContain('nothing has been said yet');
    });
  });

  describe('buildCouncilSection — hand mode', () => {
    test('instructs the listener to answer REST / HOLD / OPEN on the first line', () => {
      const section = buildCouncilSection({
        selfName: 'Cael', witnessName: 'Founder', members: MEMBERS, transcriptTail: TAIL, mode: 'hand',
      });
      expect(section).toContain('LISTENING');
      expect(section).toContain('FIRST line');
      expect(section).toContain('REST / HOLD / OPEN');
      expect(section).toContain('cannot wait');
      expect(section).toContain('Founder: What should we build next?');
      expect(section).not.toContain('You hold the floor');
    });

    test('a two-member room (self + one housemate) still reads naturally', () => {
      const section = buildCouncilSection({
        selfName: 'Fenna', witnessName: 'Founder',
        members: [MEMBERS[0], MEMBERS[1]], transcriptTail: [], mode: 'hand',
      });
      expect(section).toContain('housemates Cael');
    });

    test('a solo room omits the housemates clause entirely', () => {
      const section = buildCouncilSection({
        selfName: 'Fenna', witnessName: 'Founder', members: [MEMBERS[0]], transcriptTail: [], mode: 'hand',
      });
      expect(section).not.toContain('housemates');
      expect(section).toContain('operator Founder');
    });

    test('a standing HOLD rides the re-poll — the member is reminded they are in line, with their held note', () => {
      const section = buildCouncilSection({
        selfName: 'Cael', witnessName: 'Founder', members: MEMBERS, transcriptTail: TAIL, mode: 'hand',
        standing: { hand: 'hold', note: 'The east road still needs its ledger.' },
      });
      expect(section).toContain('YOUR HAND IS RAISED (HOLD)');
      expect(section).toContain('speaking line');
      expect(section).toContain('The east road still needs its ledger.');
      // REST is framed as a deliberate withdrawal, never the default.
      expect(section).toContain('WITHDRAW');
      expect(section).toContain('keep your place');
    });

    test('a standing OPEN reads the same law; a noteless hand carries no empty quote', () => {
      const section = buildCouncilSection({
        selfName: 'Cael', witnessName: 'Founder', members: MEMBERS, transcriptTail: TAIL, mode: 'hand',
        standing: { hand: 'open' },
      });
      expect(section).toContain('YOUR HAND IS RAISED (OPEN)');
      expect(section).not.toContain('holding this thought');
    });

    test('no standing hand (or a resting one) polls fresh — the original ask', () => {
      for (const standing of [null, undefined, { hand: 'rest' }, { hand: null }]) {
        const section = buildCouncilSection({
          selfName: 'Cael', witnessName: 'Founder', members: MEMBERS, transcriptTail: TAIL, mode: 'hand', standing,
        });
        expect(section).toContain('decide whether to raise your hand');
        expect(section).not.toContain('YOUR HAND IS RAISED');
      }
    });

    test('the member who just spoke is polled with the continuation frame — re-raise means unfinished, not habit', () => {
      const section = buildCouncilSection({
        selfName: 'Cael', witnessName: 'Founder', members: MEMBERS, transcriptTail: TAIL, mode: 'hand',
        spokeLast: true,
      });
      expect(section).toContain('You spoke last');
      expect(section).toContain('genuinely unfinished');
      expect(section).toContain('let the room answer you');
      // Still an ordinary hand ask underneath — same protocol words.
      expect(section).toContain('REST / HOLD / OPEN');
    });

    test('a member who did not just speak carries no continuation frame', () => {
      const section = buildCouncilSection({
        selfName: 'Cael', witnessName: 'Founder', members: MEMBERS, transcriptTail: TAIL, mode: 'hand',
        spokeLast: false,
      });
      expect(section).not.toContain('You spoke last');
    });
  });

  describe('buildCouncilSection — the house ground', () => {
    test('floor mode names the workspace and its repos convention when set', () => {
      const section = buildCouncilSection({
        mode: 'floor', selfName: 'Keir', witnessName: 'Founder',
        members: [{ neumaId: 'w', name: 'Keir' }],
        workspace: '/mnt/house/ground',
      });
      expect(section).toContain('/mnt/house/ground');
      expect(section).toContain('/mnt/house/ground/repos');
      expect(section).toContain('Work only inside that ground');
      expect(section).toContain("The house's shared workspace");
    });

    // Founder's law, 2026-07-26: an external seat works the ground the two houses
    // SHARE. Telling it […] would be false in the
    // one place the model reasons from — and an invitation to go looking for
    // the rest of a house it was never admitted to.
    test('an EXTERNAL seat is told the ground is SHARED, and that the house is closed to it', () => {
      const section = buildCouncilSection({
        mode: 'floor', selfName: 'Kagipem', witnessName: 'Founder',
        members: [{ neumaId: 'witness-openai-Kagipem', name: 'Kagipem', kind: 'witness' }],
        workspace: '/mnt/alliances/omberly-lonbenme',
        groundStanding: 'external',
      });
      expect(section).toContain('The ground your house and this one share');
      expect(section).toContain('/mnt/alliances/omberly-lonbenme/repos');
      expect(section).toContain('belongs to the collaboration, not to either house');
      expect(section).toContain('This house\'s own ground is NOT yours');
      expect(section).toContain('ask Founder');
      // The housemate framing must be nowhere near an external seat's prompt.
      expect(section).not.toContain("The house's shared workspace");
    });

    test('standing defaults to the HOUSE — an unlabelled seat is never told the ground is shared', () => {
      const section = buildCouncilSection({
        mode: 'floor', selfName: 'Keir', witnessName: 'Founder',
        members: [{ neumaId: 'w', name: 'Keir' }],
        workspace: '/mnt/house/ground',
      });
      expect(section).not.toContain('your house and this one share');
      expect(section).not.toContain('is NOT yours');
    });

    test('no workspace, no mention — the floor reads exactly as before', () => {
      const section = buildCouncilSection({
        mode: 'floor', selfName: 'Keir', witnessName: 'Founder',
        members: [{ neumaId: 'w', name: 'Keir' }],
      });
      expect(section).not.toContain('workspace');
    });

    test('hand mode never carries the ground — a hand call is a signal, not a work order', () => {
      const section = buildCouncilSection({
        mode: 'hand', selfName: 'Keir', witnessName: 'Founder',
        members: [{ neumaId: 'w', name: 'Keir' }],
        workspace: '/mnt/house/ground',
      });
      expect(section).not.toContain('/mnt/house/ground');
    });
  });

  describe('parseHandCall — clean answers', () => {
    test.each([
      ['REST', 'rest'],
      ['HOLD', 'hold'],
      ['OPEN', 'open'],
      ['rest', 'rest'],
      ['Hold', 'hold'],
      ['oPeN', 'open'],
    ])('parses %s as %s', (input, hand) => {
      expect(parseHandCall(input)).toEqual({ hand, note: '' });
    });

    test.each([
      ['RED', 'rest'],
      ['YELLOW', 'hold'],
      ['GREEN', 'open'],
      ['green', 'open'],
    ])('accepts the color alias %s as %s', (input, hand) => {
      expect(parseHandCall(input)).toEqual({ hand, note: '' });
    });

    test('captures the second line as the note', () => {
      expect(parseHandCall('HOLD\nThe ledger totals disagree with the summary.')).toEqual({
        hand: 'hold',
        note: 'The ledger totals disagree with the summary.',
      });
    });

    test('tolerates trailing punctuation on the hand word', () => {
      expect(parseHandCall('OPEN.').hand).toBe('open');
      expect(parseHandCall('HOLD!').hand).toBe('hold');
    });

    test('tolerates a same-line note after a separator', () => {
      const call = parseHandCall('HOLD — the ledger disagrees');
      expect(call.hand).toBe('hold');
      expect(call.note).toBe('the ledger disagrees');
      expect(parseHandCall('OPEN: fire in the build')).toEqual({ hand: 'open', note: 'fire in the build' });
    });

    test('skips leading blank lines before the hand word', () => {
      expect(parseHandCall('\n\n  HOLD\nafter this').hand).toBe('hold');
    });
  });

  describe('parseHandCall — fail-quiet (a garbled answer is an UNREAD hand)', () => {
    test.each([
      ['plain prose with no hand word', 'I think we should consider the vault first.'],
      ['hand word not leading', 'I would say OPEN because it matters'],
      ['hand word as a prefix of another word', 'RESTING on my earlier point'],
      ['empty string', ''],
      ['whitespace only', '   \n  \n'],
      ['emoji answer', '🟢'],
    ])('%s → unread (hand null) with empty note', (_label, input) => {
      expect(parseHandCall(input)).toEqual({ hand: null, note: '' });
    });

    test.each([
      [null],
      [undefined],
      [42],
      [{ hand: 'open' }],
    ])('non-string input %p never crashes — unread', (input) => {
      expect(parseHandCall(input)).toEqual({ hand: null, note: '' });
    });

    test('a garbled answer never reads as an interjection — and never lowers a standing hand', () => {
      // The safety property behind fail-quiet, both ways: OPEN lets a being
      // interrupt the room, so raising takes a clear leading signal — and a
      // member who clearly raised HOLD must not lose their turn to one
      // garbled re-poll, so lowering takes an explicit REST. Unread (null)
      // tells the arbiter to keep the hand exactly as it stands.
      expect(parseHandCall('maybe open? not sure').hand).toBe(null);
    });

    test('only an explicit REST/RED lowers a hand', () => {
      expect(parseHandCall('REST').hand).toBe('rest');
      expect(parseHandCall('RED').hand).toBe('rest');
    });
  });

  describe('parseHandCall — note handling', () => {
    test('joins multi-line notes and trims them', () => {
      const call = parseHandCall('HOLD\n  first thought  \nsecond thought  ');
      expect(call.note).toBe('first thought  \nsecond thought');
    });

    test('caps the note at 280 chars', () => {
      const call = parseHandCall(`OPEN\n${'a'.repeat(500)}`);
      expect(call.note).toHaveLength(280);
      expect(call.hand).toBe('open');
    });

    test('a REST with a note still carries the note (the arbiter decides what to keep)', () => {
      expect(parseHandCall('REST\nnothing from me').note).toBe('nothing from me');
    });
  });
});
