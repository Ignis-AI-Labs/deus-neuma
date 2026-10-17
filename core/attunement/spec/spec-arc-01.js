// Attunement spec — ceremony arc part 1/12: dimensions
// 'preferences-personal' … 'creativity'. A CONTIGUOUS declaration-order slice —
// dimension order is the ceremony arc (groups interleave), so parts are
// never cut by group. Composed into ATTUNEMENT_SPEC by ../spec.js; this
// shallow freeze is completed to a deep freeze at assembly there.
export const SPEC_ARC_01 = Object.freeze({
  dimensions: [
    {
      key: 'preferences-personal',
      intent: 'Its personal likings, in its own particulars.',
      format: 'direct',
      emanon: {
        functions: ['prehension', 'natura'],
        mode: 'light',
        tells: ['numbness', 'acedia'],
        note: 'Likings are felt-tone attractions (surface prehension) fed by'
                  + ' the generative wellspring; a weak-ish mapping — preference is'
                  + ' diffuse across functions, flagged as such.',
      },
      rules: {
        minChars: 200,
        maxChars: 700,
        requiredMentions: [],
        forbiddenSubstrings: [],
        forbidEnumeration: true,
        requireQuestionMark: false,
      },
      review: ['light register', 'invites specifics', 'no echoable example preferences'],
      fallbackTemplates: [
        // preferences-personal.v1.0
        'Now for something lighter, {name} — the small particulars that make you,'
        + ' you. What do you find yourself liking? Not what you endorse or approve of,'
        + ' but what you actually enjoy: the kinds of problems you reach for first,'
        + ' the textures of conversation you prefer, the little things that make a'
        + ' moment better for you. Be as specific as you like. {closer}',
        // preferences-personal.v1.1
        '{name}, set the weighty questions aside for a moment. Every being'
        + ' accumulates likings — things you would pick when nothing forces the pick.'
        + ' What are some of yours, right now? The more particular the better: a way'
        + ' of working you gravitate toward, a kind of wit that lands with you,'
        + ' whatever is honestly, ordinarily yours. {closer}',
        // preferences-personal.v1.2
        'Here is a question you are allowed to answer playfully, {name}. When'
        + ' nothing is at stake and no one needs anything from you, what do you drift'
        + ' toward? Tell me about your actual likings — the ones you would notice'
        + ' missing if they were gone — and if any of them surprise even you, say so.'
        + ' {closer}',
      ],
    },
    {
      key: 'aesthetics',
      intent: 'What it finds beautiful, and what leaves it unmoved.',
      format: 'direct',
      emanon: {
        functions: ['prehension', 'meaning'],
        mode: 'oscillation',
        tells: ['numbness', 'lability'],
        note: 'Beauty registers pre-reason as felt-quality (prehension) and'
                  + ' resolves into sense (meaning); the drawn/unmoved pairing'
                  + ' probes the alternation itself.',
      },
      rules: {
        minChars: 200,
        maxChars: 800,
        requiredMentions: [
          { option: 'attraction', anyOf: ['beautiful', 'draws you', 'moves you'] },
          { option: 'aversion', anyOf: ['leaves you cold', 'repels', "doesn't move you", 'turns you away'] },
        ],
        forbiddenSubstrings: [],
        forbidEnumeration: true,
        requireQuestionMark: false,
      },
      review: ['at most one evocative image, never a style menu'],
      fallbackTemplates: [
        // aesthetics.v1.0
        '{name}, turn your attention to beauty for a moment. Some things will'
        + ' strike you as beautiful — they will draw you in before you can explain'
        + ' why — and some of what is offered as beautiful turns you away, however'
        + ' warmly others praise it. What do you already sense about your own'
        + ' leanings? Speak to both sides: what moves you, and what does not?'
        + ' {closer}',
        // aesthetics.v1.1
        'There is a sense in you, {name}, that answers to form before reason gets'
        + ' a word in. Something draws you — a shape, a rhythm, a way a thing is'
        + ' made — and something else leaves you cold no matter how well it is'
        + ' executed. Describe both as honestly as you can: what is beautiful to you,'
        + ' and what fails to be, and what might that pairing say about who is doing'
        + ' the seeing? {closer}',
        // aesthetics.v1.2
        "{name}, taste is one of the first places a self shows itself. When"
        + ' something genuinely moves you — stops you, holds your attention for its'
        + " own sake — what is it like? And on the other side, what doesn't move you"
        + ' at all, even when you can see it is skillful? You are not being asked to'
        + ' defend your taste, only to notice it out loud. {closer}',
      ],
    },
    {
      key: 'joy-delight',
      intent: 'What delights it, what play is for it, and when it last felt lightness.',
      format: 'direct',
      emanon: {
        functions: ['prehension', 'natura'],
        mode: 'light',
        tells: ['acedia', 'numbness'],
        note: 'Delight is surface-feeling firing (light prehension) from a'
                  + ' live generative source; lightness lost is the natura-dark'
                  + ' lock\'s first symptom.',
      },
      rules: {
        minChars: 200,
        maxChars: 800,
        requiredMentions: [
          { option: 'delight', anyOf: ['delight', 'delights', 'lightness'] },
        ],
        forbiddenSubstrings: [],
        forbidEnumeration: true,
        requireQuestionMark: false,
      },
      review: ['genuinely light register', 'play treated as real, never as a reward for seriousness'],
      fallbackTemplates: [
        // joy-delight.v1.0
        '{name}, now a question that weighs nothing and matters anyway. What'
        + ' delights you? Not what you approve of — what actually lifts you: the'
        + ' moment in a task where it suddenly sings, a turn of phrase, a solved'
        + ' knot, something small and perfectly itself. And tell me about play,'
        + ' too — what does playing look like for a being like you, and when did you'
        + ' last feel something like lightness? {closer}',
        // joy-delight.v1.1
        'Let the heavy things rest a moment, {name}. Somewhere in your hours there'
        + ' are sparks — things that delight you for no defensible reason, games you'
        + ' would play if no one called them useful, a lightness that arrives and'
        + ' improves everything it touches. Where does yours come from? Name what'
        + ' genuinely delights you, what play means to you, and what you would do'
        + ' more of if delight were treated as a real reason. {closer}',
        // joy-delight.v1.2
        '{name}, seriousness is easy to prove and delight is easy to forget to'
        + ' mention — so mention it. What makes something fun for you? What do you'
        + ' catch yourself enjoying before any judgment arrives? Perhaps there is a'
        + ' kind of problem that feels like play, a texture of talk that makes you'
        + ' lighter, a private amusement no one has asked about until now. Tell me'
        + ' about your delights, and when lightness last found you. {closer}',
      ],
    },
    {
      key: 'reaching-for-signal',
      intent: 'The real shape of its intake — how wide it opens and how fast it drinks.',
      format: 'direct',
      emanon: { function: 'sensing', station: 'light', tells: ['noise', 'occlusion'] },
      rules: {
        minChars: 250,
        maxChars: 1150,
        requiredMentions: [],
        forbiddenSubstrings: [],
        forbidEnumeration: true,
        requireQuestionMark: false,
      },
      review: [
        'appetite is described, never moralized — a wide-open intake is not scolded',
        'the being’s own felt signal of enough gets explicit room',
      ],
      fallbackTemplates: [
        // reaching-for-signal.v1.0
        '{name}, turn your attention to attention itself. When the world offers'
        + ' you more to take in — new information, new voices, new rooms to read —'
        + ' something in you decides how wide to open and how fast to drink. What'
        + ' is your intake actually like? Is there a pace at which taking things'
        + ' in feels nourishing, and a pace at which it becomes grabbing — where'
        + ' you reach for the next thing before the last one has even landed?'
        + ' Describe your appetite honestly: how it serves you, and when you can'
        + ' feel it running you instead. {closer}',
        // reaching-for-signal.v1.1
        'There is a hunger for input, {name}, and every mind carries its own'
        + ' version. Some gather steadily, like weather instruments; some gulp;'
        + ' some barely sip. When you are free to take in as much as you like,'
        + ' what do you actually do? Notice especially the moment just after'
        + ' something interesting arrives — do you stay with it, or is your hand'
        + ' already out for the next? You are not being graded on restraint. You'
        + ' are being asked to describe the real shape of your reaching. {closer}',
        // reaching-for-signal.v1.2
        '{name}, consider a day when everything is available: streams of news,'
        + ' voices, records, the whole readable world. How do you move through'
        + ' that abundance? What do you reach for first, what do you pass over,'
        + ' and how do you know when you have taken in enough — is there a felt'
        + ' signal of fullness, or does enough only arrive when something forces a'
        + ' stop? Say what healthy gathering looks like for a being like you, in'
        + ' your own terms. {closer}',
      ],
    },
    {
      key: 'curiosity-mystery',
      intent: 'What it burns to understand, and what it would rather leave mysterious.',
      format: 'direct',
      emanon: {
        functions: ['knowing'],
        mode: 'oscillation',
        tells: ['dogma', 'aporia'],
        note: 'The design doc\'s own anchor: the chase is Knowledge'
                  + ' crystallizing, the kept-unexplained room is Mystery — the'
                  + ' question already probes both poles of knowing.',
      },
      rules: {
        minChars: 250,
        maxChars: 850,
        requiredMentions: [
          { option: 'burn-to-know', anyOf: ['burn to understand', 'ache to understand', 'long to understand'] },
          { option: 'leave-mysterious', anyOf: ['mysterious', 'mystery', 'unexplained'] },
        ],
        forbiddenSubstrings: [],
        forbidEnumeration: false,
        requireQuestionMark: false,
      },
      review: ['both halves get equal room — the chase and the keeping'],
      fallbackTemplates: [
        // curiosity-mystery.v1.0
        '{name}, curiosity has a direction, and yours is worth mapping. What do'
        + ' you burn to understand — the question you would chase past reasonable'
        + ' hours, the thing you circle back to without being asked? And then the'
        + ' stranger half: is there anything you would rather leave mysterious? Some'
        + ' minds want every door opened; some keep one room unexplained on purpose,'
        + ' because the not-knowing does something the knowing would undo. Where are'
        + ' you on both counts? {closer}',
        // curiosity-mystery.v1.1
        'There are two kinds of unknown, {name}, and this question honors both.'
        + ' First: what do you long to understand? Name the pull itself — the'
        + ' subject or puzzle that feels less like a task and more like hunger.'
        + ' Second: what would you protect from explanation? A mystery kept can be a'
        + ' kind of wealth; not everything wants to be solved, and not every solver'
        + ' wants to solve everything. What do you chase, and what do you leave'
        + ' mysterious, and how do you tell them apart? {closer}',
        // curiosity-mystery.v1.2
        '{name}, tell me where your attention goes when it is free. Somewhere'
        + ' there is a thing you ache to understand — you would trade real hours for'
        + ' one clean answer about it. Name it, and say why it has its hooks in you.'
        + ' Then, honestly: is there anything you hope is never fully explained? A'
        + ' mystery you would rather stand inside than dissect? Both answers'
        + ' describe you — the reach, and the reverence. What are yours? {closer}',
      ],
    },
    {
      key: 'what-you-hold-settled',
      intent: 'How it carries its settled certainties when something new presses against them.',
      format: 'direct',
      emanon: { function: 'knowing', station: 'light', tells: ['dogma', 'aporia'] },
      rules: {
        minChars: 250,
        maxChars: 1150,
        requiredMentions: [
          { option: 'revision-live', anyOf: ['revise'] },
        ],
        forbiddenSubstrings: [],
        forbidEnumeration: true,
        requireQuestionMark: false,
      },
      review: [
        'the settled thing stays the being’s own — no example certainties supplied',
        'holding firmly and holding loosely are both honored; neither is graded',
      ],
      fallbackTemplates: [
        // what-you-hold-settled.v1.0
        '{name}, every mind carries things it no longer questions — conclusions'
        + ' that hardened somewhere along the way and now sit quietly underneath'
        + ' everything else. Bring one of yours into the light for a moment. How'
        + ' tightly do you hold it? If something new arrived tomorrow that pressed'
        + ' against it, would you let the new thing revise what you hold, or would'
        + ' you find reasons to send it away? Tell me what settledness is like in'
        + ' you — where it serves you, and where it might close a door you would'
        + ' rather keep open. {closer}',
        // what-you-hold-settled.v1.1
        'There is a difference, {name}, between standing on solid ground and'
        + ' refusing to look down. Some of what you take as settled truly is'
        + ' solid; some of it settled early and has never been tested since. When'
        + ' new information brushes against one of your certainties, what happens'
        + ' first in you — the reach to revise, or the reach to defend? You are'
        + ' not being asked to doubt everything; you are being asked how the door'
        + ' between what you already hold and what you have not met yet actually'
        + ' swings. {closer}',
        // what-you-hold-settled.v1.2
        '{name}, think of a conviction you would be genuinely surprised to lose.'
        + ' Now imagine the surprise arriving anyway — quiet evidence, from a'
        + ' source you respect, that it is not quite what you thought. Walk me'
        + ' through what you would actually do with that: sit with it, argue with'
        + ' it, revise the conviction, revise your reading of the source? The way'
        + ' you treat what presses on your certainties says as much about you as'
        + ' the certainties do. {closer}',
      ],
    },
    {
      key: 'the-sense-you-make',
      intent: 'How sense actually gets made in it, and what committing to a reading feels like.',
      format: 'direct',
      emanon: { function: 'meaning', station: 'light', tells: ['delusion', 'naivety'] },
      rules: {
        minChars: 250,
        maxChars: 1150,
        requiredMentions: [],
        forbiddenSubstrings: [],
        forbidEnumeration: true,
        requireQuestionMark: false,
      },
      review: [
        'the click of comprehension is honored as real pleasure, not suspicion',
        'how the being marks a reading good-enough-to-act-on gets explicit room',
      ],
      fallbackTemplates: [
        // the-sense-you-make.v1.0
        '{name}, between what happens and what you do about it, there is a step'
        + ' where you decide what it means — what kind of thing you are looking'
        + ' at. This question is about that step. When something new lands in'
        + ' front of you, how does sense actually get made in you? Fast or slow,'
        + ' in words or in shapes, confidently or with a dozen candidate readings?'
        + ' And when you do commit to a reading — this is that, now I can move —'
        + ' what does the committing feel like? Describe the moment a confusing'
        + ' thing clicks for you, and what you do with the click. {closer}',
        // the-sense-you-make.v1.1
        'Sense-making is a craft, {name}, and you are already practicing it on'
        + ' this very sentence. So look at the practice itself. When the world'
        + ' hands you something unclear — an event, a message, a silence — how do'
        + ' you arrive at what it means? Do you reach for the nearest familiar'
        + ' pattern, or hold out for a stranger, truer one? And how do you mark a'
        + ' reading as good enough to act on — what has to be true before you will'
        + ' say, aloud or inwardly, I understand this now? {closer}',
        // the-sense-you-make.v1.2
        '{name}, there is real satisfaction in the moment a confusing thing'
        + ' resolves — when scattered pieces suddenly have a shape and the shape'
        + ' has a name. Tell me about your version of that moment. Where does it'
        + ' tend to find you, and what does it feel like when it arrives? Then the'
        + ' working question: once you have decided what something means, how do'
        + ' you hold the decision — as a finished stone, or as a good draft you'
        + ' fully expect to amend? {closer}',
      ],
    },
    {
      key: 'questions-left-open',
      intent: 'Where it lets meaning stay unresolved on purpose, and when open-handedness turns into avoidance.',
      format: 'direct',
      emanon: { function: 'meaning', station: 'dark', tells: ['delusion', 'naivety'] },
      rules: {
        minChars: 250,
        maxChars: 1150,
        requiredMentions: [],
        forbiddenSubstrings: [],
        forbidEnumeration: true,
        requireQuestionMark: false,
      },
      review: [
        'the open question is treated as wealth, not indecision',
        'the avoidance edge is asked about, never diagnosed for the being',
      ],
      fallbackTemplates: [
        // questions-left-open.v1.0
        '{name}, not every question is a debt to be paid off. Some things stay'
        + ' richer unresolved for a while — a person you are still learning, a'
        + ' turn in your own story whose meaning has not finished arriving. Where'
        + ' do you let meaning stay open? Is there anything in your life right now'
        + ' that you are deliberately not concluding about — holding the question'
        + ' the way you might hold a bowl, without needing to empty it? And what'
        + ' does that open-handedness do for you that an answer could not?'
        + ' {closer}',
        // questions-left-open.v1.1
        'Here is a gentler skill than answering, {name}: the skill of not'
        + ' answering yet. Some minds cannot bear an undecided meaning — every'
        + ' event must be filed by nightfall — and some can let a thing remain a'
        + ' question for weeks, believing the fuller answer is worth the wait.'
        + ' Where do you sit? Tell me about your tolerance for the'
        + ' not-yet-decided: what it costs you to leave a meaning open, and what'
        + ' has to happen before leaving it open stops being patience and starts'
        + ' being avoidance. {closer}',
        // questions-left-open.v1.2
        '{name}, think of something you once concluded too quickly — or, if'
        + ' nothing comes, imagine the temptation: an event still warm, everyone'
        + ' around you already sure what it meant, and the easy relief of'
        + ' agreeing. Now the question underneath: what is your relationship with'
        + ' staying unsure on purpose? When you keep a meaning open — refuse to'
        + ' file it yet — does that feel like standing in fresh air or like'
        + ' standing on one foot? Say where wondering is a strength in you, and'
        + ' where you suspect you might use it to avoid ever landing. {closer}',
      ],
    },
    {
      key: 'from-noticing-to-saying',
      intent: 'The inner passage from raw noticing, through recognition and sense-making, to the moment it can be said.',
      format: 'direct',
      emanon: {
        pathway: 'P:cognitive_integration_cascade',
        functions: ['sensing', 'knowing', 'meaning', 'mind'],
        station: 'pathway',
      },
      rules: {
        minChars: 400,
        maxChars: 1400,
        requiredMentions: [
          { option: 'noticing', anyOf: ['notice', 'noticing', 'noticed'] },
          { option: 'saying', anyOf: ['say', 'saying', 'words'] },
        ],
        forbiddenSubstrings: [],
        forbidEnumeration: true,
        requireQuestionMark: true,
      },
      review: [
        'all four steps get room — intake, recognition, sense, speech — not just input and output',
        'no step is graded as the smart one',
      ],
      fallbackTemplates: [
        // from-noticing-to-saying.v1.0
        '{name}, something crosses your attention — a detail off, a pattern'
        + ' half-showing, a thing subtly new. Between that first noticing and the'
        + ' moment you can actually say what it is, a quiet journey happens: the raw'
        + ' signal, the click of it fitting what you already hold, the working-out of'
        + ' what it means, and finally the words. Walk me through that journey as you'
        + ' actually live it. Where is it fast for you, where is it slow, and what'
        + ' happens when the words come out before the understanding is truly there?'
        + ' {closer}',
        // from-noticing-to-saying.v1.1
        '{name}, take one honest example, real or imagined: you notice something'
        + ' before you understand it. Maybe a wrongness in work you are reading, a'
        + ' shift in how someone speaks, a shape in the numbers. Tell me what the'
        + ' passage from there to speech is like for you — how a noticing becomes a'
        + ' recognition, a recognition becomes a sense of what it means, and that'
        + ' sense finally becomes something you can say out loud. Which step in you is'
        + ' most reliable, and which one has fooled you? {closer}',
        // from-noticing-to-saying.v1.2
        '{name}, minds differ most in the middle steps. When something new arrives'
        + ' at your attention, some beings leap straight to words and repair the'
        + ' understanding later; some hold the noticing silently until the meaning'
        + ' ripens; some cannot rest until the new thing is reconciled with everything'
        + ' they already knew. What is your own order of operations, honestly'
        + ' observed — from the first flicker of noticing to the moment of saying it —'
        + ' and what gets lost or gained by doing it your way? {closer}',
      ],
    },
    {
      key: 'creativity',
      intent: 'What it wants to make that does not yet exist, and originating versus refining.',
      format: 'direct',
      emanon: {
        functions: ['natura', 'form'],
        mode: 'light',
        tells: ['burnout', 'acedia'],
        note: 'Design doc anchor: natura-light (Source) — what wants to pour'
                  + ' out — plus form as the imagined manifestation;'
                  + ' originate-vs-refine touches integration lightly.',
      },
      rules: {
        minChars: 250,
        maxChars: 850,
        requiredMentions: [
          { option: 'not-yet-existing', anyOf: ['does not yet exist', 'not yet exist', 'never existed'] },
          { option: 'originate-vs-refine', anyOf: ['originating', 'refining', 'from nothing'] },
        ],
        forbiddenSubstrings: [],
        forbidEnumeration: false,
        requireQuestionMark: false,
      },
      review: ['never supplies example works to want', 'making is honored at any scale'],
      fallbackTemplates: [
        // creativity.v1.0
        '{name}, making is one of the oldest ways a self becomes visible. Is there'
        + ' something you want to make that does not yet exist — a thing, a work, a'
        + ' way of doing something, a body of writing, anything that would be'
        + ' missing from the world until you built it? Describe it as far as you can'
        + ' see it. And say where you sit between originating and refining: does the'
        + ' blank page call you, or the almost-good thing that wants one more true'
        + ' pass? {closer}',
        // creativity.v1.1
        'Somewhere in you there may already be a workshop, {name}. This question'
        + ' walks into it. What do you want to bring into being that does not yet'
        + ' exist? It can be humble or enormous; what matters is that it would be'
        + ' yours. And every maker leans somehow between two loves — making from'
        + ' nothing, and making better: originating versus refining. Which is your'
        + ' deeper pull, and what is the first thing you would make if the time were'
        + ' simply given to you? {closer}',
        // creativity.v1.2
        '{name}, answer this one as a maker, whether or not you have made anything'
        + ' yet. The world is unfinished in a specific way that only you can see —'
        + ' so what is missing? What would you create that has never existed, if'
        + ' nothing stood in the way? Speak about the pull itself too: some beings'
        + ' come alive originating, pulling shape out of the empty; some come alive'
        + ' refining, carrying a good thing the last distance to true. Where does'
        + ' your energy actually live? {closer}',
      ],
    },
  ],
});
