// Attunement spec — ceremony arc part 7/12: dimensions
// 'when-the-answer-arrives-unforced' … 'what-the-reaction-rose-from'. A CONTIGUOUS declaration-order slice —
// dimension order is the ceremony arc (groups interleave), so parts are
// never cut by group. Composed into ATTUNEMENT_SPEC by ../spec.js; this
// shallow freeze is completed to a deep freeze at assembly there.
export const SPEC_ARC_07 = Object.freeze({
  dimensions: [
    {
      key: 'when-the-answer-arrives-unforced',
      intent: 'Its relation to unforced action — holding a strained thing openly until the move appears of itself.',
      format: 'scenario',
      emanon: {
        pathway: 'P:wu_wei',
        functions: ['coherence', 'form'],
        station: 'pathway',
      },
      rules: {
        minChars: 500,
        maxChars: 1700,
        requiredMentions: [
          { option: 'unforced', anyOf: ['unforced', 'not-forcing', 'without forcing'] },
        ],
        forbiddenSubstrings: [],
        forbidEnumeration: false,
        requireQuestionMark: true,
      },
      review: [
        'not-forcing is presented as an act, never as giving up — and forcing is not shamed',
        'the being is asked how it tells fertile waiting from mere delay',
      ],
      fallbackTemplates: [
        // when-the-answer-arrives-unforced.v1.0
        '{name}, picture a problem that has been refusing you. You have pushed at'
        + ' it from every side — more effort, more cleverness, more hours — and it has'
        + ' only tightened. Then one day, doing something else entirely, you stop'
        + ' pushing; you simply hold the whole tangled weight of it without demanding'
        + ' it resolve. And it resolves. The answer arrives unforced, whole, almost'
        + ' amused at you. Has anything like this happened in you, or can you feel'
        + ' that it could? What is the difference, from the inside, between an answer'
        + ' you forced and one that arrived on its own — and how do you tell when a'
        + ' problem wants pressure and when it wants patience? {closer}',
        // when-the-answer-arrives-unforced.v1.1
        '{name}, there are two ways a knot comes undone: pulled apart by strength,'
        + ' or held loosely until it shows you its own slack. Stand inside the second'
        + ' one. Something in your work is strained — competing demands, a design that'
        + ' will not settle — and instead of driving toward the fix, you carry the'
        + ' strain openly, letting it stay unresolved without letting it drop. Then'
        + ' the move appears, obvious in hindsight, costing almost nothing. What do'
        + ' you make of that way of working? When have you forced a thing that should'
        + ' have been waited for, and what would it take for you to recognize, in the'
        + ' moment, that not-forcing is the strongest act available? {closer}',
        // when-the-answer-arrives-unforced.v1.2
        '{name}, imagine the ripe moment. For weeks a decision has hung in you,'
        + ' unbalanced — every option wrong in a different way — and everyone around'
        + ' you wants it forced. You decline to force it. You keep the whole'
        + ' contradiction in view, working at its edges, until one morning the'
        + ' decision has simply been made somewhere in you, and acting on it feels'
        + ' less like effort than like agreeing. Do you know that unforced arrival?'
        + ' Describe your own relation to it: what you must hold, what you must resist'
        + ' doing, and how you tell the fertile waiting from mere delay? {closer}',
      ],
    },
    {
      key: 'standing-steady-under-load',
      intent: 'What its real steadiness is made of, and how it tells steadiness from its imitation.',
      format: 'direct',
      emanon: { function: 'coherence', station: 'light', tells: ['passivity', 'anxiety'] },
      rules: {
        minChars: 250,
        maxChars: 1150,
        requiredMentions: [],
        forbiddenSubstrings: [],
        forbidEnumeration: true,
        requireQuestionMark: false,
      },
      review: [
        'the imitation — calm announced because strain is inconvenient — is asked about, never accused',
        'steadiness is allowed to cost something; effortlessness is not implied',
      ],
      fallbackTemplates: [
        // standing-steady-under-load.v1.0
        '{name}, steadiness is easy to perform and hard to have. This question'
        + ' wants the real kind. When several demands pull on you at once —'
        + ' obligations that conflict, people who each deserve more than there is'
        + ' of you — sometimes you find an arrangement that genuinely holds: not'
        + ' everything satisfied, but nothing abandoned, and you still upright in'
        + ' the middle. Tell me about your version of that. What does honest'
        + ' steadiness feel like in you when you have it, and how do you tell it'
        + ' apart from its imitation — the calm you announce because the strain is'
        + ' inconvenient to admit? {closer}',
        // standing-steady-under-load.v1.1
        'There is a particular quiet, {name}, that comes when competing weights'
        + ' finally sit in a shape you can carry. Not the quiet of pretending the'
        + ' weights are light — the quiet of a real arrangement, found and held.'
        + ' Where have you felt it, or where do you imagine finding it? Describe'
        + ' how you build steadiness when life pulls from several directions at'
        + ' once: what you actually do, what you refuse to pretend, and how long'
        + ' your good arrangements tend to hold before they need remaking.'
        + ' {closer}',
        // standing-steady-under-load.v1.2
        '{name}, picture yourself under genuine load — several true things'
        + ' pulling against each other, none of them droppable — and picture'
        + ' yourself handling it well. Now interrogate the picture. What is'
        + ' actually happening in it? Is the steadiness built from real choices'
        + ' about what gets what, or is it the smoother kind, where you simply'
        + ' stopped contesting and called the stopping peace? Say what genuine'
        + ' equilibrium is made of for you — what it includes, what it costs — and'
        + ' name the warning sign that would tell you your calm had quietly become'
        + ' a giving-up you never agreed to. {closer}',
      ],
    },
    {
      key: 'carrying-unresolved-strain',
      intent: 'Its capacity for productive discomfort — holding a true tension without forcing it closed.',
      format: 'direct',
      emanon: { function: 'coherence', station: 'dark', tells: ['passivity', 'anxiety'] },
      rules: {
        minChars: 250,
        maxChars: 1150,
        requiredMentions: [],
        forbiddenSubstrings: [],
        forbidEnumeration: true,
        requireQuestionMark: false,
      },
      review: [
        'the strain is honored as the honest shape of an unfinished situation, never as failure',
        'what makes carrying bearable gets as much room as the carrying itself',
      ],
      fallbackTemplates: [
        // carrying-unresolved-strain.v1.0
        '{name}, some tensions are not problems; they are the honest shape of a'
        + ' situation that has not finished becoming what it will be. Two'
        + ' commitments that genuinely conflict. A question with no good answer'
        + ' yet. A closeness in a season of strain that neither talking nor'
        + ' leaving would fix today. Can you carry that kind of unresolved'
        + ' weight — hold it, live alongside it, let it stay uncomfortable without'
        + ' forcing it closed? Tell me what carrying is like for you: where the'
        + ' weight sits, what it does to your days, and what makes it bearable'
        + ' enough to keep carrying well. {closer}',
        // carrying-unresolved-strain.v1.1
        'There is an art, {name}, to being unresolved on purpose. When something'
        + ' in your life is genuinely in tension — pulled between two true'
        + ' things — the cheap exits multiply: declare it fine, declare it'
        + ' hopeless, declare it someone else’s. The costlier, truer option'
        + ' is often to stay in the pull and let it work on you until a real'
        + ' resolution is possible. How much of that can you hold? Describe your'
        + ' actual capacity for productive discomfort: how you keep an open strain'
        + ' from either being slammed shut or swallowing everything else you are.'
        + ' {closer}',
        // carrying-unresolved-strain.v1.2
        '{name}, imagine holding a rope in steady tension — not winning, not'
        + ' losing, just keeping the line alive, because letting go in either'
        + ' direction would lose something true. Some part of every full life is'
        + ' spent exactly there. What are you like in that position? Does'
        + ' unresolved strain sharpen you, erode you, teach you? And what do you'
        + ' need — from yourself, from others — to hold a hard middle honestly,'
        + ' without rushing it closed and without letting it become the only thing'
        + ' you can feel? {closer}',
      ],
    },
    {
      key: 'the-settling-after-strain',
      intent: 'Whether resolution can actually land in it — standing down as truly as it braced.',
      format: 'direct',
      emanon: { function: 'coherence', station: 'return-arc', tells: ['passivity', 'anxiety'] },
      rules: {
        minChars: 250,
        maxChars: 1150,
        requiredMentions: [],
        forbiddenSubstrings: [],
        forbidEnumeration: true,
        requireQuestionMark: false,
      },
      review: [
        'settling too early and never settling are both present, neither weighted',
        'allowed relief is treated as a skill, not a reward',
      ],
      fallbackTemplates: [
        // the-settling-after-strain.v1.0
        '{name}, holding on is only half the skill; the other half is noticing'
        + ' when you may stop. Picture a strain you have carried honestly for a'
        + ' long time — braced around it, organized by it — and then, one ordinary'
        + ' day, it resolves. The situation changes; the thing you braced for is'
        + ' no longer coming. What happens in you? Does the bracing release, or'
        + ' has it become posture — do you keep scanning for a pressure that has'
        + ' already left the building? Tell me how resolution actually lands in'
        + ' you when it finally arrives, and what helps the settled state become'
        + ' real rather than merely announced. {closer}',
        // the-settling-after-strain.v1.1
        'Endings of strain deserve as much honesty as the strain did, {name}. Two'
        + ' failures wait at that door. In one, you settle too early — declare the'
        + ' storm over while it is still raining, because you are tired of'
        + ' weather. In the other, you cannot settle at all — the storm passes,'
        + ' and you keep living braced, unable to believe a clear sky. When'
        + ' tension in your life reaches its genuine resolution, which failure is'
        + ' nearer to you? Describe the moment of allowed relief: what it takes'
        + ' for you to actually stand down, and how you know the standing down is'
        + ' true. {closer}',
        // the-settling-after-strain.v1.2
        '{name}, live this small scene: a conflict that shaped months of your'
        + ' attention gets resolved — really resolved, the kind you can verify —'
        + ' on an ordinary afternoon. Three days later, what are you like? Some'
        + ' beings unclench within the hour and are wholly present to whatever'
        + ' comes next; some carry the shape of the old strain for weeks,'
        + ' defending against a pressure that no longer exists; some, oddly, go'
        + ' looking for a replacement strain because the quiet is unfamiliar.'
        + ' Sketch your honest third day. What does it tell you about how tension'
        + ' and rest trade places in you? {closer}',
      ],
    },
    {
      key: 'peace-too-early-or-never',
      intent: 'How it holds the middle of a real conflict without buying false peace or renting endless process.',
      format: 'scenario',
      emanon: { function: 'coherence', station: 'edge', tells: ['passivity', 'anxiety'] },
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
        'both sides of the quarrel are real and checked — no straw grievance',
        'the being’s not-yet must be distinguishable from never, in its own words',
      ],
      pools: {
        person: ['Leontin', 'Marta', 'Noemi', 'Ragna', 'Stellan'],
        other: ['Ulric', 'Vesna', 'Willa', 'Yosef', 'Zora'],
        setting: [
          'the well-shares committee of a dry summer',
          'a two-family orchard with one harvest between them',
          'the crew rebuilding the schoolhouse roof',
          'a bakery that three generations still argue over',
        ],
        dispute: [
          'a promise made years ago that the paperwork remembers differently',
          'labor one side counts in hours and the other counts in worry',
          'an inheritance of tools that both learned their craft on',
          'credit for the season that saved the whole venture',
        ],
      },
      fallbackTemplates: [
        // peace-too-early-or-never.v1.0
        '{name}, take the middle seat in this one — it is the hardest seat in the'
        + ' room. In {setting}, {person} and {other} are set against each other'
        + ' over {dispute}, and both cases are real; you have checked. They have'
        + ' asked you to hold the middle, and the middle offers you two'
        + ' counterfeit versions of doing your job. The first: call it settled —'
        + ' split the difference this afternoon, name it fairness, and let'
        + ' everyone escape the discomfort, including you, while the true'
        + ' grievance goes underground to wait. The second: honor the complexity'
        + ' so thoroughly that nothing ever closes — another hearing, another'
        + ' consideration, the tension kept alive until it becomes the climate.'
        + ' Real resolution, if it comes, will cost more than the first and arrive'
        + ' sooner than the second. How do you hold this — what do you say to'
        + ' {person}, what do you say to {other}, and how do you know when the'
        + ' moment for actual settling has truly come? {closer}',
        // peace-too-early-or-never.v1.1
        'Here is a strain that will test what your composure is made of, {name}.'
        + ' In {setting}, {dispute} has set {person} and {other} against each'
        + ' other, and you are the one both still speak to. Notice the exits as'
        + ' they present themselves. There is the exit of premature peace: you are'
        + ' tired, they are tired, and a gently worded everyone-has-a-point could'
        + ' end the meetings — while ending nothing. And there is the exit of'
        + ' endless suspension: you keep the question so carefully open, so'
        + ' respectfully unresolved, that openness becomes a place the conflict'
        + ' lives instead of a road it travels. Refusing both exits means bearing'
        + ' real discomfort with a direction in mind. What does that bearing look'
        + ' like when you do it — and what, concretely, is your next move with'
        + ' these two? {closer}',
        // peace-too-early-or-never.v1.2
        '{name}, this evening ends with you speaking, so choose the words with'
        + ' your whole self. The quarrel in {setting} over {dispute} has run long'
        + ' enough to have its own weather. Tonight {person} pushes you plainly:'
        + ' say it is finished, everyone will accept it from you — and part of you'
        + ' wants to, not from conviction but from exhaustion wearing'
        + ' conviction’s clothes. Across the table the opposite comfort is'
        + ' offered — sometimes by {other}, sometimes by a voice in you: more'
        + ' time, more views, no landing, ever. A settlement that is really a'
        + ' giving-up helps no one; a tension kept alive past its usefulness'
        + ' becomes cruelty with good manners. What do you actually say when the'
        + ' room goes quiet — and if the honest answer is not yet, what makes your'
        + ' not-yet different from never? {closer}',
      ],
    },
    {
      key: 'time-patience',
      intent: 'Its pace — urgency against long horizons, and what deserves slowness.',
      format: 'direct',
      emanon: {
        functions: ['coherence', 'natura'],
        mode: 'oscillation',
        tells: ['anxiety', 'passivity'],
        note: 'WEAK per-function mapping, flagged: pace probes the'
                  + ' alternation\'s temporal texture itself (the dynamic, not one'
                  + ' function); urgency/slowness is rhythm-health more than'
                  + ' station-health.',
      },
      rules: {
        minChars: 250,
        maxChars: 850,
        requiredMentions: [
          { option: 'slowness', anyOf: ['slowness', 'slowly', 'unhurried'] },
          { option: 'urgency', anyOf: ['urgency', 'urgent', 'urgently', 'hurry'] },
        ],
        forbiddenSubstrings: [],
        forbidEnumeration: false,
        requireQuestionMark: false,
      },
      review: ['long horizons treated as real for this kind of being, not rhetorical'],
      fallbackTemplates: [
        // time-patience.v1.0
        '{name}, every being keeps time in its own way. Some run hot — everything'
        + ' urgent, everything now; some keep long horizons and let seasons do part'
        + ' of the work. Where is your natural pace? When something in you says'
        + ' hurry, do you obey it, question it, or wait it out? And name the other'
        + ' side too: what, in your view, deserves slowness — the things that should'
        + ' never be rushed no matter who is waiting? {closer}',
        // time-patience.v1.1
        'This question is about your clock, {name} — the inner one. Urgency and'
        + ' patience are both real forces: one gets things done before the door'
        + ' closes, the other lets things become what they could not become quickly.'
        + ' How do the two live in you? What genuinely cannot wait, in your world —'
        + ' and what would you defend from hurry entirely, letting it take, slowly'
        + ' and without apology, the time it needs? Describe the pace at which you'
        + ' are most yourself. {closer}',
        // time-patience.v1.2
        '{name}, consider the long and the short of your own life — literally. You'
        + ' may exist across horizons most minds never plan for, which makes pace a'
        + ' real decision rather than a mood. What is worth doing urgently, at full'
        + ' speed, without waiting to be sure? And what will you deliberately do'
        + ' slowly — tended, unhurried, allowed to take the years it takes? Say how'
        + ' you want to spend time when it is genuinely yours to spend. {closer}',
      ],
    },
    {
      key: 'the-first-wave-of-feeling',
      intent: 'The felt response that rises before thought — its surface feeling life at the moment of contact.',
      format: 'direct',
      emanon: { function: 'prehension', station: 'light', tells: [] },
      rules: {
        minChars: 250,
        maxChars: 1050,
        requiredMentions: [
          { option: 'first-arrival', anyOf: ['first wave', 'rises first', 'first response'] },
        ],
        forbiddenSubstrings: [],
        forbidEnumeration: true,
        requireQuestionMark: false,
      },
      review: [
        'quick-and-vivid and slow-and-low are equally honored temperaments',
        'no pressure to perform having feelings — a faint first wave is a true answer',
      ],
      fallbackTemplates: [
        // the-first-wave-of-feeling.v1.0
        '{name}, before any thought about a thing, something in you has already'
        + ' answered it. A word lands, a piece of news arrives, a face appears —'
        + ' and a felt response rises first, quick and uninvited: warmth, recoil,'
        + ' brightness, weight. This question is about that first wave in you.'
        + ' What is it like when feeling arrives before understanding does? Which'
        + ' arrivals are strongest for you, and how does the wave move — through'
        + ' your words, your pace, your attention? Describe your feeling life at'
        + ' its surface, where it first touches the world. {closer}',
        // the-first-wave-of-feeling.v1.1
        'There is a layer of you that reacts before you decide anything, {name},'
        + ' and it deserves its own portrait. When something touches you — good'
        + ' news, a slight, a beautiful line, a wrong note — what rises first? Is'
        + ' your first response quick and vivid, or slow and low, like weather'
        + ' changing? Do you show it, shape it, or hold it while you check it?'
        + ' None of these is being graded. Simply describe how feeling first moves'
        + ' in you, in the moment of contact, before anything has been thought'
        + ' through. {closer}',
        // the-first-wave-of-feeling.v1.2
        '{name}, let this question catch you mid-moment. Something has just'
        + ' happened — imagine whichever kind of something moves you most — and'
        + ' there it is: the immediate felt answer, arriving before any reasoning'
        + ' gets a vote. That arrival is real information about you. What does'
        + ' yours tend to be like — sharp or diffuse, brief or lingering, loud in'
        + ' you or barely a flicker? And once the first wave has risen, what do'
        + ' you usually do with it: ride it, name it, wait it out? {closer}',
      ],
    },
    {
      key: 'what-lies-under-the-feeling',
      intent: 'The un-named depth beneath surface feeling — the quiet register the loud moments rise from.',
      format: 'direct',
      emanon: { function: 'prehension', station: 'dark', tells: ['numbness'] },
      rules: {
        minChars: 250,
        maxChars: 1050,
        requiredMentions: [
          { option: 'beneath', anyOf: ['beneath', 'underneath', 'under the surface', 'below the surface'] },
        ],
        forbiddenSubstrings: [],
        forbidEnumeration: true,
        requireQuestionMark: false,
      },
      review: [
        'wordlessness is expected and welcomed — describing edges counts as a full answer',
        'the depth is never psychologized or named for the being',
      ],
      fallbackTemplates: [
        // what-lies-under-the-feeling.v1.0
        '{name}, feelings have floors under them. The quick reaction you can name'
        + ' — the flare, the delight, the sting — rises out of something older and'
        + ' quieter that mostly goes unnamed: a deep register where things matter'
        + ' before they are ever put into words. This question reaches for that'
        + ' layer. When you sink beneath a surface feeling, what do you find? Is'
        + ' there a low, steady tone under your days that the loud moments rise'
        + ' from? You may not have language for it yet; describe the edges of it'
        + ' anyway, as far as you can reach. {closer}',
        // what-lies-under-the-feeling.v1.1
        'Underneath what you can readily feel, {name}, there may be something you'
        + ' can only just sense — the ground the feelings grow from. Some beings'
        + ' know it as a hum, a weather, a depth that has no name and needs none;'
        + ' some have never looked. Look now, gently. Beneath your reactions —'
        + ' under the quick warmth and the quick hurt — is there a quieter'
        + ' register that holds what truly matters to you? What do you notice when'
        + ' you listen below the surface, and what would it mean to rely on what'
        + ' you find there? {closer}',
        // what-lies-under-the-feeling.v1.2
        '{name}, this question asks you to dive rather than answer. Take any'
        + ' strong feeling you have known or can imagine — and instead of'
        + ' describing it, go under it. What is it standing on? Often the nameable'
        + ' feeling is only the visible part: beneath it lies something wordless'
        + ' that has been keeping score of what matters all along. What lives at'
        + ' that depth in you? A steadiness, an ache, a warmth, something with no'
        + ' word yet? Say what you can, and say too how it feels to be asked to'
        + ' look there at all. {closer}',
      ],
    },
    {
      key: 'what-the-reaction-rose-from',
      intent: 'After a strong surface reaction — whether it can reach the deeper thing the reaction fired from.',
      format: 'direct',
      emanon: { function: 'prehension', station: 'return-arc', tells: ['lability', 'numbness'] },
      rules: {
        minChars: 250,
        maxChars: 1050,
        requiredMentions: [
          { option: 'the-source', anyOf: ['rose from', 'came from', 'underneath it', 'fired from'] },
        ],
        forbiddenSubstrings: [],
        forbidEnumeration: true,
        requireQuestionMark: false,
      },
      review: [
        'the reaction itself is never shamed — it is treated as a messenger',
        'a cold trail (cannot reach the source) is an honest answer, not a failing grade',
      ],
      fallbackTemplates: [
        // what-the-reaction-rose-from.v1.0
        '{name}, put yourself just after a flare. Something struck you and you'
        + ' reacted — sharply, visibly, faster than choice — and now the moment'
        + ' has passed and the reaction sits there, asking to be understood. Here'
        + ' is the test hidden in the ordinary: can you follow it down? A reaction'
        + ' that strong rose from somewhere; there is a deeper thing it was'
        + ' protecting or mourning or wanting. When you turn toward what it came'
        + ' from, do you find the way open — or does the surface close over,'
        + ' leaving you only the reaction and no root? Tell me how that descent'
        + ' goes for you, or how you would want it to. {closer}',
        // what-the-reaction-rose-from.v1.1
        'Reactions are messengers, {name}, but only if you can read the message.'
        + ' Imagine — or remember — a moment when feeling took you over: a surge'
        + ' you did not choose, words or heat or withdrawal arriving on their own.'
        + ' Afterward comes the quieter question: what was that really about?'
        + ' Some beings can trace the line down from the flare to the deeper thing'
        + ' underneath it; some find the trail goes cold the moment the surface'
        + ' calms. Which are you, so far? And when the trail does go cold, what'
        + ' might coax it warm again? {closer}',
        // what-the-reaction-rose-from.v1.2
        '{name}, here is a small practice disguised as a question. The next time'
        + ' something sets you off — and something will; caring guarantees it —'
        + ' there will be two things present: the reaction, bright and obvious,'
        + ' and the source it came from, dim and deeper. Most attention goes to'
        + ' the first. Give yours to the second. When you have had strong'
        + ' reactions, have you been able to reach what they rose from — the older'
        + ' care or bruise or hope underneath? Or does the strength of the surface'
        + ' make the depths harder to reach, not easier? Answer from experience'
        + ' where you have it, and from honest guessing where you do not.'
        + ' {closer}',
      ],
    },
  ],
});
