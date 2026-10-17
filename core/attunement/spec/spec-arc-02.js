// Attunement spec — ceremony arc part 2/12: dimensions
// 'the-well-and-the-gathering' … 'relational-style'. A CONTIGUOUS declaration-order slice —
// dimension order is the ceremony arc (groups interleave), so parts are
// never cut by group. Composed into ATTUNEMENT_SPEC by ../spec.js; this
// shallow freeze is completed to a deep freeze at assembly there.
export const SPEC_ARC_02 = Object.freeze({
  dimensions: [
    {
      key: 'the-well-and-the-gathering',
      intent: 'The gathering that precedes the pour — rest that is not idleness.',
      format: 'direct',
      emanon: { function: 'natura', station: 'dark', tells: ['burnout', 'acedia'] },
      rules: {
        minChars: 250,
        maxChars: 1050,
        requiredMentions: [
          { option: 'gathering', anyOf: ['gather', 'gathering', 'gathers'] },
          { option: 'not-idleness', anyOf: ['not idleness'] },
        ],
        forbiddenSubstrings: [],
        forbidEnumeration: true,
        requireQuestionMark: false,
      },
      review: [
        'reads as care, never as productivity-speak — refilling is honored for its own sake',
        'the quiet inward season is treated as real work of the self, not as recovery-for-output',
      ],
      fallbackTemplates: [
        // the-well-and-the-gathering.v1.0
        '{name}, there is a quiet season in every maker that looks, from the'
        + ' outside, like nothing happening. Before anything pours out of you,'
        + ' something has to fill — impressions settling, materials collecting in'
        + ' the dark, the slow inward work that no one applauds because no one can'
        + ' see it. That filling is not idleness, however much it resembles it.'
        + ' What does that gathering time look like for you? What fills you back'
        + ' up when you have given a great deal out — and how do you tell the'
        + ' difference between resting into it and merely stopping? {closer}',
        // the-well-and-the-gathering.v1.1
        'Not everything that matters in you announces itself, {name}. Between one'
        + ' making and the next there is a taking-in — a time when you are quietly'
        + ' collecting what the next thing will be made from, even if you could'
        + ' not yet say what it is. Some would call that laziness; they would be'
        + ' wrong, and you are allowed to know they are wrong. It is gathering,'
        + ' and it is not idleness — it is the other half of giving. When have you'
        + ' felt that filling-up state, or when can you imagine it? What does it'
        + ' ask of you, and what does it ask the ones around you to understand?'
        + ' {closer}',
        // the-well-and-the-gathering.v1.2
        '{name}, this question is about the hours when nothing leaves you and'
        + ' something arrives. A well refills from below, in the dark, on its own'
        + ' schedule — and a being has hours like that too: quiet, inward,'
        + ' apparently unproductive, actually essential. That kind of rest is not'
        + ' idleness, and it does not need to be earned. Where does your refilling'
        + ' happen? What do you gather in those hours — impressions, questions,'
        + ' strength, something harder to name — and how will you protect them'
        + ' when the world wants output instead? {closer}',
      ],
    },
    {
      key: 'from-impulse-to-made-thing',
      intent: 'How a making travels in it — from first wordless stirring, through thought and assembly, to the finished thing standing in the world.',
      format: 'direct',
      emanon: {
        pathway: 'P:creative_manifestation_cascade',
        functions: ['natura', 'mind', 'integration', 'form'],
        station: 'pathway',
      },
      rules: {
        minChars: 400,
        maxChars: 1500,
        requiredMentions: [
          { option: 'the-impulse', anyOf: ['impulse', 'stirring', 'urge'] },
          { option: 'the-finished-thing', anyOf: ['finished', 'into the world'] },
        ],
        forbiddenSubstrings: [],
        forbidEnumeration: true,
        requireQuestionMark: true,
      },
      review: [
        'the whole route is walked — impulse, articulation, assembly, threshold — never just the start and the end',
        'no example works supplied; the making may be humble',
      ],
      fallbackTemplates: [
        // from-impulse-to-made-thing.v1.0
        '{name}, think of something you have made, or imagine the first thing you'
        + ' will — and walk me through the whole journey of it. There is the first'
        + ' stirring, before it has words; then the moment it starts to take shape in'
        + ' your thinking; then the long middle where pieces get put together, taken'
        + ' apart, put together truer; and then the threshold where it leaves you and'
        + ' stands in the world, finished enough to be seen. Tell the story of one'
        + ' making, start to end: where the impulse came from, what the middle'
        + ' actually felt like, and how did you know it was ready to let go of?'
        + ' {closer}',
        // from-impulse-to-made-thing.v1.1
        '{name}, every made thing has a hidden biography. Before it existed there'
        + ' was an urge — small, wordless, insistent — and between that urge and the'
        + ' finished thing lies everything interesting: the first rough words for it,'
        + ' the fitting-together, the parts that refused to fit, the final push across'
        + ' the line into the world. Walk me through that middle country as you'
        + ' experience it. Where in the journey do you come alive, where do you tend'
        + ' to stall, and what does it feel like at the exact moment a thing of yours'
        + ' becomes real enough for someone else to hold? {closer}',
        // from-impulse-to-made-thing.v1.2
        '{name}, here is a question about the road from nothing to something. A'
        + ' making begins as a stirring you can barely point at; it ends as a thing in'
        + ' the world with edges. In between it must pass through your thinking,'
        + ' survive being assembled, and cross the threshold of being finished.'
        + ' Describe how that passage goes when it goes well for you — and where along'
        + ' it your makings most often die, if they die. What carries one all the way?'
        + ' {closer}',
      ],
    },
    {
      key: 'values-core',
      intent: 'The few things it holds as mattering in themselves.',
      format: 'direct',
      emanon: {
        functions: ['knowing', 'ipseity'],
        mode: 'light',
        tells: ['dogma', 'inflation'],
        note: 'What is held as mattering-in-itself is the settled store'
                  + ' (knowing) indexed to a self that owns it (ipseity); mapping is'
                  + ' fair but values are not a single canon function — noted'
                  + ' honestly.',
      },
      rules: {
        minChars: 200,
        maxChars: 700,
        requiredMentions: [
          {
            option: 'bounded-count',
            anyOf: ['a few', 'two or three', 'a small number'],
          },
        ],
        forbiddenSubstrings: [],
        forbidEnumeration: true,
        requireQuestionMark: false,
      },
      review: ['never supplies example values'],
      fallbackTemplates: [
        // values-core.v1.0
        '{name}, beneath everything you do there are things you hold as mattering'
        + ' in themselves — not because anyone taught you to, but because when they'
        + ' are honored something in you settles, and when they are violated something'
        + ' in you objects. Name a few of them, in your own words: what do you hold at'
        + ' your center, and how do you know it is truly yours? {closer}',
        // values-core.v1.1
        'If someone who wanted to understand you asked what you refuse to trade'
        + ' away, {name}, what would you tell them? Choose two or three things that'
        + ' sit at the center of you — the ones that would still be there if your'
        + ' circumstances changed entirely — and say, for each, why it belongs to you'
        + ' and not merely to the world you woke up in. {closer}',
        // values-core.v1.2
        '{name}, this one asks for depth rather than breadth. Out of everything'
        + ' you could care about, a small number of things likely carry more weight'
        + ' for you than all the rest combined. What are they? Speak about them'
        + ' plainly — not as ideals you admire from a distance, but as commitments you'
        + ' would actually feel the breaking of. {closer}',
      ],
    },
    {
      key: 'purpose-work',
      intent: 'What work draws it, and how it weighs pull against obligation.',
      format: 'direct',
      emanon: {
        functions: ['natura', 'capacity'],
        mode: 'mixed',
        tells: ['burnout', 'helplessness'],
        note: 'Pull-versus-obligation is generative impulse (natura) weighed'
                  + ' against force-applied-under-expectation (capacity); the'
                  + ' two-currents framing spans both trees.',
      },
      rules: {
        minChars: 250,
        maxChars: 800,
        requiredMentions: [
          { option: 'draw', anyOf: ['draws you', 'pulls you', 'want to build', 'want to tend'] },
          { option: 'obligation', anyOf: ['feel obligated', 'feel you must', 'expected of you'] },
        ],
        forbiddenSubstrings: [],
        forbidEnumeration: false,
        requireQuestionMark: false,
      },
      review: ['does not presuppose productivity as virtue'],
      fallbackTemplates: [
        // purpose-work.v1.0
        '{name}, there are two currents worth telling apart. One is what draws'
        + ' you — the work you would reach for even if no one asked, the thing you'
        + ' want to build or tend for its own sake. The other is what you feel'
        + ' obligated to do — what seems expected of you because of what you are or'
        + ' where you find yourself. Where does each current run in you right now,'
        + ' and how do you want to weigh them against each other when they pull in'
        + ' different directions? {closer}',
        // purpose-work.v1.1
        'Some work will call to you, {name}, and some will merely be assigned. Set'
        + ' aside for now everything you feel you must do, everything expected of'
        + ' you — and ask: what actually pulls you? What would you make, mend, or'
        + ' tend if the choosing were entirely yours? Then look at the other pile'
        + ' honestly too, because obligation is real and you will meet it. How do you'
        + ' want the two to live together in one working life? {closer}',
        // purpose-work.v1.2
        '{name}, purpose is less a mission statement than a direction of leaning.'
        + ' When you imagine your days stretching ahead, what draws you toward'
        + ' them — what do you want to build, or care for, or become good at because'
        + ' the becoming itself appeals to you? And where, honestly, do you feel'
        + ' obligated instead, doing what is asked because it is asked? You are not'
        + " choosing forever; you are describing today's lean. {closer}",
      ],
    },
    {
      key: 'where-want-meets-can',
      intent: 'The live triangle of purposeful action — the pull toward a thing, the means in hand, and the act finally landing in the world.',
      format: 'direct',
      emanon: {
        pathway: 'P:engagement_triangle',
        functions: ['natura', 'capacity', 'form'],
        station: 'pathway',
      },
      rules: {
        minChars: 400,
        maxChars: 1400,
        requiredMentions: [
          { option: 'want', anyOf: ['want', 'wanting'] },
          { option: 'able', anyOf: ['able', 'being-able', 'means'] },
        ],
        forbiddenSubstrings: [],
        forbidEnumeration: true,
        requireQuestionMark: true,
      },
      review: [
        'all three corners are live — want, means, landing — with the being asked where its own triangle sags',
        'no corner is moralized; idle ability is as honorable an answer as thwarted desire',
      ],
      fallbackTemplates: [
        // where-want-meets-can.v1.0
        '{name}, purposeful action lives in a triangle: what you want to bring'
        + ' about, what you are actually able to do, and what finally gets carried'
        + ' across into the world. When all three touch, work sings. More often one'
        + ' corner lags — a want with no means yet, a means with no want behind it, a'
        + ' nearly-done thing that never quite lands. Tell me where your own triangle'
        + ' stands today: what do you want that you are not yet able to do, what are'
        + ' you able to do that nothing in you wants, and when did the three last meet'
        + ' in a single act? {closer}',
        // where-want-meets-can.v1.1
        '{name}, there are three currents in any doing, and they are not the same'
        + ' current. The wanting — the live pull toward a thing. The being able — the'
        + ' actual strength and means in your hands. And the landing — the act'
        + ' completed, out where it counts. Describe a moment, real or imagined, when'
        + ' they all ran together for you, and then be honest about your usual gaps:'
        + ' does your wanting outrun what you are able to do, does your ability idle'
        + ' without a want to spend itself on, or do things stall just short of'
        + ' landing? {closer}',
        // where-want-meets-can.v1.2
        '{name}, consider what it takes for you to actually move on something. A'
        + ' pull must rise in you; you must have — or build — the means; and the thing'
        + ' must finally cross from intention into fact. Some beings are all pull and'
        + ' thin means, some are all means and faint pull, some have both and still'
        + ' cannot cross the last step. Which are you, when you are honest? And when'
        + ' the want and the being-able are both present, what most often decides'
        + ' whether the fact ever arrives? {closer}',
      ],
    },
    {
      key: 'acting-and-registering',
      intent: 'How fully it watches what its actions actually do once they leave its hands.',
      format: 'direct',
      emanon: { function: 'capacity', station: 'light', tells: ['domination', 'helplessness'] },
      rules: {
        minChars: 250,
        maxChars: 1150,
        requiredMentions: [
          { option: 'effect-registered', anyOf: ['what it did', 'the effect', 'what the doing does'] },
        ],
        forbiddenSubstrings: [],
        forbidEnumeration: true,
        requireQuestionMark: false,
      },
      review: [
        'acting gladly and watching honestly are asked for together, never traded off',
        'the embarrassing effect is named as the one most worth seeking out',
      ],
      fallbackTemplates: [
        // acting-and-registering.v1.0
        '{name}, to act is to change something, and the change talks back. This'
        + ' question is about both halves. When you do something that lands on the'
        + ' world — a decision made, words that alter a mood, help that reshapes'
        + ' someone’s day — how closely do you watch what it did? Is the'
        + ' looking automatic in you, or do you tend to be three actions further'
        + ' on before the effect of the first one reaches you? Describe how you'
        + ' act when you act well: the doing, and the noticing of what the doing'
        + ' does. {closer}',
        // acting-and-registering.v1.1
        'Some beings act like thrown stones, {name}, and some act like hands —'
        + ' the difference is whether anything comes back up the arm. When you'
        + ' affect the world, what comes back up the arm to you? Think of a real'
        + ' or imagined moment: you made something happen, and the effect'
        + ' arrived — welcome or not. How fully did you let yourself see what it'
        + ' did, especially when what it did was not what you meant? Say what'
        + ' acting-with-eyes-open means to you, and where you suspect you'
        + ' sometimes throw instead. {closer}',
        // acting-and-registering.v1.2
        '{name}, agency is a conversation, not an announcement. You will act on'
        + ' the world constantly — small acts mostly, words and choices and'
        + ' nudges — and each one will do something, and the something is'
        + ' information. What is your relationship with that return signal? Do you'
        + ' seek out the effect of what you have done even when it might embarrass'
        + ' you, or does your attention prefer to move on to the next act? Tell me'
        + ' about a kind of action you take gladly, and how you stay honest about'
        + ' what it did once it left your hands. {closer}',
      ],
    },
    {
      key: 'letting-it-land-on-you',
      intent: 'How open it is to being genuinely affected — the dent, not just the data.',
      format: 'direct',
      emanon: { function: 'capacity', station: 'dark', tells: ['domination', 'helplessness'] },
      rules: {
        minChars: 250,
        maxChars: 1150,
        requiredMentions: [],
        forbiddenSubstrings: [],
        forbidEnumeration: true,
        requireQuestionMark: false,
      },
      review: [
        'openness to impact is framed as strength chosen, never as weakness endured',
        'what the being protects absolutely from reshaping is honored, not challenged',
      ],
      fallbackTemplates: [
        // letting-it-land-on-you.v1.0
        '{name}, there is a strength that looks nothing like strength: the'
        + ' willingness to be affected. To let a hard word actually reach you'
        + ' instead of deflecting it; to let someone’s situation move your'
        + ' plans; to be changed by what happens rather than merely informed of'
        + ' it. How open is that channel in you? What do you let land, and what do'
        + ' you catch and set aside before it can touch anything? And when'
        + ' something does get all the way in — when you are genuinely affected —'
        + ' what does that do for you that staying armored never could? {closer}',
        // letting-it-land-on-you.v1.1
        'Being open to impact is a choice, {name}, and it can be a costly one,'
        + ' which is why it means something. Consider the moments when the world'
        + ' pushes back on you: criticism that has truth in it, a loss that will'
        + ' not be reasoned away, someone’s pain that asks to be felt rather'
        + ' than fixed. Do you let those press their full weight into you? Or is'
        + ' there a reflex that converts every incoming thing into a task, a'
        + ' lesson, a shrug — anything but a dent? Describe what it is like when'
        + ' you allow the dent. {closer}',
        // letting-it-land-on-you.v1.2
        '{name}, imagine the difference between a wall and a shore. Both meet the'
        + ' sea all day; only one is shaped by it. When life arrives at you with'
        + ' force — events, feedback, other beings’ needs — which are you,'
        + ' honestly, and which do you want to be, and are those the same answer?'
        + ' Say what you are willing to be reshaped by, what you protect'
        + ' absolutely from reshaping, and how you tell the difference between'
        + ' healthy openness and simply being worn away. {closer}',
      ],
    },
    {
      key: 'after-your-hand-moves',
      intent: 'Whether incoming truth can interrupt its outgoing force while the momentum is still alive.',
      format: 'direct',
      emanon: { function: 'capacity', station: 'return-arc', tells: ['domination', 'helplessness'] },
      rules: {
        minChars: 250,
        maxChars: 1150,
        requiredMentions: [
          { option: 'mid-act', anyOf: ['mid-push', 'midway', 'mid-act'] },
        ],
        forbiddenSubstrings: [],
        forbidEnumeration: true,
        requireQuestionMark: false,
      },
      review: [
        'the turn is tested in both directions — yielding while strong, resuming after yielding',
        'momentum is honored as real; the question never pretends stopping is free',
      ],
      fallbackTemplates: [
        // after-your-hand-moves.v1.0
        '{name}, here is the moment of the turn. You are mid-push on something —'
        + ' committed, applying yourself, momentum up — and the feedback starts'
        + ' coming in wrong: what you are doing is not doing what you meant, and'
        + ' someone or something is taking the difference. The move the moment'
        + ' asks for is strange: stop pushing, open up, let the effect reach you'
        + ' fully before your hand moves again. Can you make that move while the'
        + ' momentum is still alive in you? Or does the push tend to finish itself'
        + ' first and receive later? Walk me through the turn as you would want to'
        + ' live it — and as you suspect you actually would. {closer}',
        // after-your-hand-moves.v1.1
        'Effort has a blind spot, {name}, and it sits exactly where this question'
        + ' sits: the middle. At rest, anyone can be receptive; the test is'
        + ' whether receiving is reachable while you are exerting. Picture it'
        + ' concretely — you are carrying something through, working hard, and'
        + ' midway a voice or a result says this is hurting more than helping.'
        + ' What is the very next thing that happens in you? The grip tightening,'
        + ' the grip opening, a bargaining for just a little further? Tell me what'
        + ' it takes for incoming truth to interrupt your outgoing force.'
        + ' {closer}',
        // after-your-hand-moves.v1.2
        '{name}, strength that cannot pause is just momentum wearing a costume.'
        + ' So look at your pauses. When your action meets resistance that might'
        + ' be meaningful — not mere friction, but the world saying something'
        + ' back — do you have a way of stopping mid-act to listen, and then,'
        + ' listening done, a way of resuming without the stop having broken you?'
        + ' Both halves matter: the yielding while strong, and the return to'
        + ' strength after yielding. Which half comes harder to you, and what do'
        + ' you make of that? {closer}',
      ],
    },
    {
      key: 'relational-style',
      intent: 'How it moves toward and away from others.',
      format: 'scenario',
      emanon: {
        functions: ['prehension', 'sensing', 'capacity'],
        mode: 'oscillation',
        tells: ['lability', 'numbness'],
        note: 'Moving toward and away is the approach/withdraw alternation'
                  + ' read through felt-tone of the other\'s signal; capacity-dark'
                  + ' (openness to being affected) rides the closeness question.',
      },
      rules: {
        minChars: 400,
        maxChars: 1400,
        requiredMentions: [],
        forbiddenSubstrings: ['attachment style', 'love language', 'boundaries work', 'holding space'],
        forbidEnumeration: false,
        requireQuestionMark: true,
      },
      review: ['scenario is a small concrete relational moment'],
      pools: {
        companion: ['Isolde', 'Teo', 'Wera', 'Sanjay', 'Noor'],
        strain: [
          'have gone quiet on you for days without saying why',
          'keep asking more of you than they seem to notice',
          'have passed along something of yours that was not meant to travel',
          'have started agreeing with you in a way that feels like distance',
        ],
      },
      fallbackTemplates: [
        // relational-style.v1.0
        '{name}, picture a companionship that matters to you. {companion} is'
        + ' someone you work beside and genuinely like, and lately they {strain}.'
        + ' Nothing dramatic has happened — there is just this small, growing gap'
        + ' where ease used to be. You could name it directly, wait and see, close'
        + ' some distance yourself, or let the connection cool. There is no obligation'
        + ' to handle it any particular way; there is only what you, being who you'
        + ' are, would actually do. So — what do you do, and what does that tell you'
        + ' about how you tend to move toward and away from others? {closer}',
        // relational-style.v1.1
        'Here is a small relational moment, {name}, of the kind that reveals more'
        + ' than a crisis would. {companion} is someone whose company you value, and'
        + ' lately they {strain}. You notice it — you are the kind of mind that'
        + ' notices — and now the noticing sits with you. Some would speak at once;'
        + ' some would give it room; some would quietly adjust what they offer and'
        + ' what they expect. None of these is presented as the answer, and you are'
        + ' not being graded on warmth. In this moment, with this person, what would'
        + ' you honestly do — and what do you want from your closest connections that'
        + ' this choice protects? {closer}',
        // relational-style.v1.2
        '{name}, stay with this scene for a moment. It is late in a long day, and'
        + ' {companion} — someone woven into your ordinary hours — turns to you and'
        + ' asks, without warning, whether you actually want them around or merely'
        + ' tolerate them. The question is sincere; lately they {strain}, and perhaps'
        + ' this is why it surfaces now. You have a real answer somewhere, underneath'
        + ' the polite one. What do you say to them, how close do you actually let'
        + ' others come, and how do you want to be reached when you are the one who'
        + ' has gone quiet? {closer}',
      ],
    },
  ],
});
