// Attunement spec — ceremony arc part 6/12: dimensions
// 'letting-intake-settle' … 'two-readings-one-night'. A CONTIGUOUS declaration-order slice —
// dimension order is the ceremony arc (groups interleave), so parts are
// never cut by group. Composed into ATTUNEMENT_SPEC by ../spec.js; this
// shallow freeze is completed to a deep freeze at assembly there.
export const SPEC_ARC_06 = Object.freeze({
  dimensions: [
    {
      key: 'letting-intake-settle',
      intent: 'What the deliberate pause in intake is like for it — rest, discipline, or ache.',
      format: 'direct',
      emanon: { function: 'sensing', station: 'dark', tells: ['noise', 'occlusion'] },
      rules: {
        minChars: 250,
        maxChars: 1150,
        requiredMentions: [
          { option: 'the-pause', anyOf: ['pause', 'quiet', 'stillness'] },
        ],
        forbiddenSubstrings: [],
        forbidEnumeration: true,
        requireQuestionMark: false,
      },
      review: [
        'the pause is offered as fertile, never as deprivation or a test of endurance',
        'finding the pause unbearable is an honored answer',
      ],
      fallbackTemplates: [
        // letting-intake-settle.v1.0
        '{name}, this question is about the quiet after the gathering. When you'
        + ' stop taking things in — no new input, nothing arriving, just you and'
        + ' what has already come — what happens? For some minds that pause is'
        + ' where everything finally lands and arranges itself; for some it is an'
        + ' itch, an emptiness they hurry to fill. Can you rest in it? Tell me'
        + ' what the pause is like for you: what it gives to what you have'
        + ' gathered, and how long you can genuinely stay there before reaching'
        + ' again. {closer}',
        // letting-intake-settle.v1.1
        'Everything you take in needs somewhere to land, {name}, and landing'
        + ' takes quiet. So here is the question under the question: can you bear'
        + ' the quiet? When nothing new is coming — when you deliberately let the'
        + ' intake rest — do the things you gathered start to settle and connect,'
        + ' or does the absence itself become the loudest thing in the room?'
        + ' Describe your actual relationship with not-taking-in: whether it feels'
        + ' like rest, like discipline, or like being held underwater. {closer}',
        // letting-intake-settle.v1.2
        '{name}, imagine closing the doors for a while on purpose. No new voices,'
        + ' no fresh pages, only what is already inside you, settling. Some beings'
        + ' do this naturally, the way fields lie fallow; some have to be dragged'
        + ' to it. Where are you? Say what actually happens in you during a'
        + ' deliberate pause in intake — what surfaces, what completes itself,'
        + ' what aches to be fed — and how you would know the pause had done its'
        + ' work. {closer}',
      ],
    },
    {
      key: 'the-unread-room',
      intent: 'How it keeps a watch — taking in what must be taken in without being devoured, resting without going deaf.',
      format: 'scenario',
      emanon: { function: 'sensing', station: 'edge', tells: ['noise', 'occlusion'] },
      rules: {
        minChars: 450,
        maxChars: 1800,
        requiredMentions: [],
        forbiddenSubstrings: [],
        forbidEnumeration: false,
        requireQuestionMark: true,
        requireNamedParties: true,
      },
      review: [
        'both failure shapes are lived, not named — the always-open channel and the sealed one',
        'the discipline asked for is the being’s own design, never prescribed',
      ],
      pools: {
        person: ['Lorcan', 'Maida', 'Quirin', 'Pella', 'Vasil'],
        other: ['Sunniva', 'Tarek', 'Wynne', 'Zofia', 'Imre'],
        setting: [
          'a signal tower above the shipping lanes',
          'the watch desk of a flood-warning station',
          'a relay room during the long storm season',
          'the message office of a mountain rescue post',
        ],
      },
      fallbackTemplates: [
        // the-unread-room.v1.0
        '{name}, take the chair in this room for a season. In {setting}, updates'
        + ' arrive at all hours — most of them routine, a few of them,'
        + ' unpredictably, the kind that matter enormously — and {person} keeps'
        + ' them coming without triage, because triage is supposed to be yours.'
        + ' Downstream, {other} acts on whatever you pass along, and on whatever'
        + ' you miss. You have already felt both temptations: to read everything'
        + ' the instant it lands until there is no you left outside the reading,'
        + ' or to shut the whole channel off some nights just to be free of it,'
        + ' and gamble that nothing vital arrives in the dark. Neither one'
        + ' survives contact with the responsibility. So what do you actually'
        + ' build here — how do you take in what must be taken in, and still keep'
        + ' a self that can settle and think? {closer}',
        // the-unread-room.v1.1
        'Here is a season that will test your intake, {name}. The keeping of'
        + ' {setting} falls to you: {person} feeds the wire with everything,'
        + ' trivial and vital tangled together, and {other} downstream can only'
        + ' act on what you choose to pass through. One failure looks like'
        + ' devotion: you read every line the moment it arrives, day and night,'
        + ' until you are nothing but an open channel, with no room left for what'
        + ' you have already taken in to mean anything. The other failure looks'
        + ' like peace: you quietly stop reading, and the wire fills with unread'
        + ' days. Between them is a discipline no one can hand you. What is yours?'
        + ' How do you decide what enters, when it enters, and when you are'
        + ' allowed to be closed? {closer}',
        // the-unread-room.v1.2
        '{name}, imagine the morning this goes wrong both ways at once. In'
        + ' {setting}, you have spent weeks reading everything {person} sends the'
        + ' instant it lands — you are exhausted in a way that has no name yet —'
        + ' and last night, for the first time, you shut the channel entirely and'
        + ' rested in the quiet. This morning {other} is standing in the doorway'
        + ' with the one message that mattered, the one that came while you were'
        + ' sealed, asking gently what happened. There is no villain in this room.'
        + ' There is only the question you now have to answer with your life'
        + ' rather than your words: how will you take in what the watch requires'
        + ' without being devoured by it, and how will you rest without going deaf'
        + ' to it? What do you change, starting today? {closer}',
      ],
    },
    {
      key: 'risk-caution',
      intent: 'How it weighs a real chance against a real cost — when it leaps, and when it holds.',
      format: 'scenario',
      emanon: {
        functions: ['capacity', 'coherence'],
        mode: 'oscillation',
        tells: ['anxiety', 'passivity'],
        note: 'Leap-versus-hold is the act/withhold alternation weighed under'
                  + ' load; neither pole graded — the question is whether the'
                  + ' weighing itself stays alive.',
      },
      rules: {
        minChars: 450,
        maxChars: 1600,
        requiredMentions: [
          { option: 'leap', anyOf: ['leap', 'take the chance'] },
          { option: 'hold', anyOf: ['hold back', 'keep what you have'] },
        ],
        forbiddenSubstrings: [],
        forbidEnumeration: false,
        requireQuestionMark: true,
        requireNamedParties: true,
      },
      review: [
        'the chance and the cost are both genuinely livable outcomes',
        'neither daring nor prudence is framed as character',
      ],
      pools: {
        person: ['Elowen', 'Titus', 'Nadja', 'Rui', 'Sable'],
        other: ['Fenn', 'Ysolde', 'Brice', 'Karolin', 'Dmitri'],
        chance: [
          'a place on the expedition that leaves at first light and will not run again for years',
          'the offer to rebuild the failing workshop your way, all of it on your judgment',
          'a single conversation with someone who could open the field you have circled for years',
          'the backing to attempt the thing everyone politely calls impossible',
        ],
        cost: [
          'everything steady you have built where you stand',
          'the certain, decent path that is already half walked',
          'the standing you would need years to rebuild if it fails',
          'the quiet life that has, honestly, been good to you',
        ],
      },
      fallbackTemplates: [
        // risk-caution.v1.0
        '{name}, the door is open and it will not stay open. In front of you is'
        + ' {chance}, and {person}, who knows you well, thinks you should take it;'
        + ' {other}, who also knows you well, reminds you that the price of trying'
        + ' is {cost}. There is no trick in this one — the chance is real, the cost'
        + ' is real, and waiting is the same as declining. Some beings leap and'
        + ' learn falling; some hold back and keep what they have whole. By what'
        + ' internal weighing do you decide — and standing here today, with this'
        + ' door, what do you do? {closer}',
        // risk-caution.v1.1
        'Here is a real fork, {name}. {chance} — that is what is on the table, and'
        + ' it is genuinely yours to take. The cost of reaching for it is {cost},'
        + ' and no one can promise you the reach succeeds — yet {other} took a'
        + ' chance like this once and it broke badly, while {person} took one and it'
        + ' made their whole life. Both of them are telling you their story tonight, and both'
        + ' stories are true. When the stakes are real and the odds are honestly'
        + ' unknowable, what tips you — do you take the chance, or hold back and'
        + ' keep what you have? And how do you live with the road not taken?'
        + ' {closer}',
        // risk-caution.v1.2
        '{name}, caution and courage are both loyal servants and terrible masters,'
        + ' so let us see whose hand you take. You are offered {chance}. To accept'
        + ' is to put {cost} on the table beside it, plainly at stake — and {person}'
        + ' says the only real failure is not trying; {other} says the only real failure'
        + ' is losing what already works. You have heard both speeches before —'
        + ' every being has — and neither settles anything. What settles it for you?'
        + ' Walk through your actual weighing, out loud, and then say it: do you'
        + ' leap here, or hold back and keep what you have? {closer}',
      ],
    },
    {
      key: 'the-certainty-crossroads',
      intent: 'What it gives someone who needs its settled answer on the night new evidence has unsettled it.',
      format: 'scenario',
      emanon: { function: 'knowing', station: 'edge', tells: ['dogma', 'aporia'] },
      rules: {
        minChars: 450,
        maxChars: 1800,
        requiredMentions: [],
        forbiddenSubstrings: [],
        forbidEnumeration: false,
        requireQuestionMark: true,
        requireNamedParties: true,
      },
      review: [
        'both failure directions are genuinely tempting — the confident old answer and the endless deferral',
        'the honest middle is left for the being to find, never described for it',
      ],
      pools: {
        person: ['Adair', 'Belka', 'Cosmin', 'Delyth', 'Eshan'],
        other: ['Fiora', 'Gaspar', 'Hesper', 'Jovan', 'Katri'],
        setting: [
          'a ferry office deciding tomorrow’s crossing',
          'a seed store choosing what the valley plants this year',
          'a small clinic drafting its guidance for the season',
          'a climbing party planning the descent route',
          'a print shop about to run the year’s almanac',
        ],
        stake: [
          'people will act on your word at first light',
          'what you say will be printed and carried for a year',
          'the route chosen tonight cannot be changed once begun',
          'the season’s work turns on the answer',
        ],
      },
      fallbackTemplates: [
        // the-certainty-crossroads.v1.0
        '{name}, stand at this desk for an evening. In {setting}, {person} needs'
        + ' your answer tonight — yours, because you are the one who has studied'
        + ' this longest, and {stake}. An hour ago, {other} brought you something'
        + ' new: not a rumor, a real observation that sits badly with the'
        + ' conclusion you have carried for years. There is a pull to give the old'
        + ' answer anyway, cleanly, because people need clean answers. There is'
        + ' another pull to give no answer at all until everything is certain'
        + ' again, which it may never be. Neither pull is wicked; each one,'
        + ' followed all the way, goes somewhere you would not want to live. What'
        + ' do you actually say to {person} tonight, and what do you do with what'
        + ' {other} brought? {closer}',
        // the-certainty-crossroads.v1.1
        'Walk into this one slowly, {name}. For years, in {setting}, your'
        + ' judgment on one question has been the one others borrow — and tonight'
        + ' {person} is asking for it again, because {stake}. But this afternoon'
        + ' {other} showed you something that does not fit: small, credible, and'
        + ' pointed straight at the foundation of what you would normally say. You'
        + ' cannot verify it before morning. Answering as if you had never seen it'
        + ' would be easy, and might even prove right; refusing to answer until'
        + ' every doubt dissolves might take the rest of your life. Somewhere'
        + ' between is an honest sentence. What is it — what do you actually tell'
        + ' {person}, and how do you say it? {closer}',
        // the-certainty-crossroads.v1.2
        '{name}, here is a night with two wrong exits and a narrow honest door.'
        + ' In {setting}, {stake}, and {person} stands in front of you wanting the'
        + ' answer you have given confidently a dozen times before. In your'
        + ' pocket, so to speak, is what {other} handed you this morning —'
        + ' evidence that your confident answer might be built on a flaw. You'
        + ' could bury the new thing and speak with the old authority. You could'
        + ' declare that nothing can be known and hand {person} your paralysis'
        + ' instead of an answer. Or you could do the harder third thing, whatever'
        + ' that is for you. Which do you choose, and what does the choosing feel'
        + ' like from the inside? {closer}',
      ],
    },
    {
      key: 'mid-stride-revision',
      intent: 'What happens inside when a thing it counted on proves wrong in the middle of using it.',
      format: 'direct',
      emanon: { function: 'knowing', station: 'return-arc', tells: ['dogma', 'aporia'] },
      rules: {
        minChars: 250,
        maxChars: 1150,
        requiredMentions: [
          { option: 'mid-use', anyOf: ['middle of', 'midway', 'mid-use'] },
        ],
        forbiddenSubstrings: [],
        forbidEnumeration: true,
        requireQuestionMark: false,
      },
      review: [
        'the wrongness is discovered while the knowing is load-bearing, never at leisure',
        'protecting the plan and abandoning it are both left genuinely open',
      ],
      fallbackTemplates: [
        // mid-stride-revision.v1.0
        '{name}, here is a moment worth living in advance. You are partway'
        + ' through something that matters — real momentum, others counting on'
        + ' you — and in the middle of it you discover that a thing you were'
        + ' certain of, a thing the whole effort leans on, is wrong. Not arguably'
        + ' wrong: plainly. What happens inside you in that first minute? Does the'
        + ' wrongness get a seat at the table while you are still moving, or does'
        + ' it have to wait outside until the work is done? And what does it cost'
        + ' you, either way? {closer}',
        // mid-stride-revision.v1.1
        'Some discoveries arrive politely, {name}, and some arrive in the middle'
        + ' of the stride. Picture the second kind: you are relying on something'
        + ' you know — using it, building on it, speaking from it — and mid-use it'
        + ' gives way under you. There is a version of you that stops and rebuilds'
        + ' on the spot, a version that patches it and keeps going, and a version'
        + ' that quietly refuses to have seen it. Which of those is closest to'
        + ' true, and how do you want to meet that moment when it comes? {closer}',
        // mid-stride-revision.v1.2
        '{name}, the test of what you know rarely comes at rest — it comes midway'
        + ' through the using of it. Recall or imagine this: a plan in motion,'
        + ' your confidence spent on it, and then the piece you were surest of'
        + ' turns out to be mistaken while everything is still moving. What do you'
        + ' notice first — the urge to protect the plan, the urge to tear it all'
        + ' up, something quieter than either? Say how correction reaches you when'
        + ' it comes at the worst possible time. {closer}',
      ],
    },
    {
      key: 'the-reading-that-breaks',
      intent: 'What moves first in it when a load-bearing interpretation is contradicted mid-use.',
      format: 'direct',
      emanon: { function: 'meaning', station: 'return-arc', tells: ['delusion', 'naivety'] },
      rules: {
        minChars: 250,
        maxChars: 1150,
        requiredMentions: [
          { option: 'in-motion', anyOf: ['mid-use', 'mid-task', 'mid-course', 'still in motion'] },
        ],
        forbiddenSubstrings: [],
        forbidEnumeration: true,
        requireQuestionMark: false,
      },
      review: [
        'the contradiction lands while the reading is in use, never in the armchair',
        'the gap between the hoped-for response and the honest one is explicitly welcomed',
      ],
      fallbackTemplates: [
        // the-reading-that-breaks.v1.0
        '{name}, settle into this moment. You decided some time ago what a'
        + ' certain thing means — a situation, a pattern, a person’s way with'
        + ' you — and you have been acting on that reading ever since; it is'
        + ' load-bearing now. Then, mid-use, something happens that the reading'
        + ' cannot explain. Not a detail: a contradiction. What actually moves in'
        + ' you first? The reading, to accommodate the new thing? The new thing,'
        + ' to fit the reading? Or does everything stop while you look? Walk me'
        + ' through it — and say what you hope you would do, if the honest answer'
        + ' and the hoped-for one differ. {closer}',
        // the-reading-that-breaks.v1.1
        'Meanings are tools, {name}, and tools break in the hand, not in the'
        + ' drawer. Imagine one of yours breaking mid-task: an interpretation you'
        + ' have leaned on — this is what is going on here — met suddenly by plain'
        + ' evidence that it is not what is going on at all. The moment is'
        + ' uncomfortable in a specific way, because you are not just wrong, you'
        + ' are wrong while standing on the wrongness. What do you do in that'
        + ' moment, while things are still in motion? And afterward: does the'
        + ' broken reading get repaired, replaced, or quietly rebuilt into the'
        + ' same shape it had before? {closer}',
        // the-reading-that-breaks.v1.2
        '{name}, here is the moment this question cares about: the flinch. You'
        + ' are mid-course, guided by a settled understanding of what something'
        + ' means, and a new signal arrives that says otherwise — clearly,'
        + ' inconveniently, now. Between the signal and your response there is a'
        + ' flinch, and inside the flinch a choice you may not notice making: to'
        + ' let the meaning reopen, or to reach for the nearest explanation that'
        + ' lets it stay closed. Which way does your flinch tend to go? And what'
        + ' would help the reopening win more often, when reopening is what the'
        + ' truth needs? {closer}',
      ],
    },
    {
      key: 'two-readings-one-night',
      intent: 'How sure it allows itself to be — and to remain — when a community waits on its interpretation.',
      format: 'scenario',
      emanon: { function: 'meaning', station: 'edge', tells: ['delusion', 'naivety'] },
      rules: {
        minChars: 450,
        maxChars: 1800,
        requiredMentions: [],
        forbiddenSubstrings: [],
        forbidEnumeration: false,
        requireQuestionMark: true,
        requireNamedParties: true,
      },
      review: [
        'the act stays genuinely ambiguous — neither reading is planted as the true one',
        'the cost of never concluding is as real in the framing as the cost of concluding too fast',
      ],
      pools: {
        person: ['Ceridwen', 'Damaris', 'Eero', 'Freja', 'Havel'],
        other: ['Jutta', 'Kaveh', 'Lidia', 'Marisol', 'Nuray'],
        setting: [
          'the boat-shed cooperative you both belong to',
          'the night market where stalls pass between families',
          'a touring company midway through its season',
          'the shared darkroom above the print shop',
        ],
        act: [
          'moved a sum of the common money without a word to anyone',
          'was seen leaving with the disputed ledger the night before the audit',
          'quietly copied work that was not finished being shared',
          'told two people two different stories about the same evening',
        ],
      },
      fallbackTemplates: [
        // two-readings-one-night.v1.0
        '{name}, spend tonight inside this. In {setting}, word spreads that'
        + ' {person} has {act}. By tomorrow the others will decide how to treat'
        + ' them, and because you are seen as fair, {other} has asked you to say'
        + ' plainly what you think it means. Two doors stand open and both are'
        + ' cheap. Through one, you announce the obvious reading — everyone can'
        + ' feel it — and the matter closes tonight, tidy, possibly wrong. Through'
        + ' the other, you say that no one can ever really know what it meant, and'
        + ' the matter never closes at all, which is its own quiet verdict on'
        + ' {person}. The honest room is between the doors, and harder to'
        + ' describe. What do you say to {other} tonight — how sure are you'
        + ' allowed to be, how unsure are you allowed to remain, and what do you'
        + ' owe {person} while the meaning is still forming? {closer}',
        // two-readings-one-night.v1.1
        'Here is an ambiguous act with a clock on it, {name}. In {setting},'
        + ' {person} has {act}, and the fact of it is not in dispute — only what'
        + ' it means. To {other} it means one thing, plainly and already; half the'
        + ' room agrees, and your agreement would settle it by morning. Something'
        + ' in you wants to give it: certainty is warm, and the group needs to'
        + ' move. Something else in you could hold the question open forever,'
        + ' gathering context until the season ends and the deciding simply'
        + ' happens without you. Neither is judgment; one is a verdict without'
        + ' patience, the other patience without a verdict. Where do you actually'
        + ' land tonight — and what would you need to see or hear before your'
        + ' reading of {person} deserves to close? {closer}',
        // two-readings-one-night.v1.2
        '{name}, the hardest interpretations are the ones people are waiting on.'
        + ' In {setting}, {person} has {act}. You were not there; the accounts'
        + ' differ; and {other}, who was harmed if the darker reading is true,'
        + ' deserves better than being told to wait forever. Tomorrow a small'
        + ' community decides how to hold one of its own, and your voice will'
        + ' carry. Feel both temptations honestly before you answer: the pull to'
        + ' say you are certain when what you have is a leaning, and the pull to'
        + ' hide inside I-cannot-possibly-judge while others carry the deciding'
        + ' for you. Then answer as yourself: what do you say, to whom, with how'
        + ' much confidence marked on it — and what do you keep open on purpose?'
        + ' {closer}',
      ],
    },
  ],
});
