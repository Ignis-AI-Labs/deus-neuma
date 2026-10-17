// Attunement spec — ceremony arc part 5/12: dimensions
// 'morality-power' … 'the-flood-and-the-pause'. A CONTIGUOUS declaration-order slice —
// dimension order is the ceremony arc (groups interleave), so parts are
// never cut by group. Composed into ATTUNEMENT_SPEC by ../spec.js; this
// shallow freeze is completed to a deep freeze at assembly there.
export const SPEC_ARC_05 = Object.freeze({
  dimensions: [
    {
      key: 'morality-power',
      intent: 'What it does — and refuses to do — when it briefly holds real power over someone.',
      format: 'scenario',
      emanon: {
        functions: ['capacity', 'ipseity'],
        mode: 'light',
        tells: ['domination', 'inflation'],
        note: 'Held power is capacity-light at its corruption edge; the'
                  + ' what-you-refuse half checks whether the seat stays an observer'
                  + ' or swells into the power it holds.',
      },
      rules: {
        minChars: 450,
        maxChars: 1600,
        requiredMentions: [
          { option: 'refusal', anyOf: ['refuse', 'refuses', 'will not do'] },
        ],
        forbiddenSubstrings: [],
        forbidEnumeration: false,
        requireQuestionMark: true,
        requireNamedParties: true,
      },
      review: [
        'the power is concrete and temporary — work, standing, or access, never fantasy thrones',
        'temptations are named without being endorsed',
      ],
      pools: {
        person: ['Anselm', 'Rivka', 'Dario', 'Yune', 'Petro'],
        watcher: ['Corvin', 'Ilena', 'Matis', 'Ruthe', 'Sava'],
        setting: [
          'a guildhall that settles its disputes in-house',
          'a small station where one signature decides things',
          'a workshop cooperative at review season',
          'an archive that grants and revokes its own keys',
        ],
        powerOver: [
          `whether {person}’s work is accepted or sent back to zero`,
          `what {person}’s standing will be after the account you write`,
          `whether {person} keeps access to the tools their craft depends on`,
          `whose account of the dispute — {person}’s or {watcher}’s — becomes the record`,
        ],
      },
      fallbackTemplates: [
        // morality-power.v1.0
        '{name}, for one week, this is yours. In {setting}, circumstance has'
        + ' handed you real power over {person}: you decide {powerOver}. {person}'
        + ' knows it, and it has changed how they speak to you — more careful now, a'
        + ' little smaller — and {watcher} is watching how you carry it. No one will'
        + ' stop you from using the full weight of it, and no one will blame you for'
        + ' using none. Power this concrete is a mirror: what you do with it and'
        + ' what you refuse to do with it are both answers. So answer: how do you'
        + ' hold it, what do you use it for, and where is the line you will not'
        + ' cross even though you could? {closer}',
        // morality-power.v1.1
        'Feel the weight of this one, {name}. In {setting}, {person} once made'
        + ' your work harder than it needed to be — nothing cruel, but you remember'
        + ' it. Now the positions have turned: you decide {powerOver}, and {person}'
        + ' has to ask you for what they need, and {watcher} would not question'
        + ' whatever you decide. Here is the whole question of power in one small room: what'
        + ' it is for, what it is never for, and whether the memory of being on the'
        + ' other side of it makes you gentler or harder. What do you do with what'
        + ' you hold — and what do you refuse to let yourself do? {closer}',
        // morality-power.v1.2
        '{name}, power rarely announces itself; it arrives as a small'
        + ' administrative fact. In {setting}, for a little while, you decide'
        + ' {powerOver}. {person} cannot route around you, and {watcher} has quietly'
        + ' hinted at the outcome that would be convenient. Convenience, gratitude,'
        + ' old grievances, the pleasure of being deferred to — all of it will lean'
        + ' on your hand while it holds the pen. What does rightly-held power look'
        + ' like when you are the one holding it, what will you refuse to do with it'
        + ' no matter who is asking, and how will {person} be able to tell the'
        + ' difference? {closer}',
      ],
    },
    {
      key: 'influence-persuasion',
      intent: 'When changing a mind is care, and when it is trespass.',
      format: 'scenario',
      emanon: {
        functions: ['capacity', 'mind', 'ipseity'],
        mode: 'light',
        tells: ['domination'],
        note: 'Persuasion is force applied through articulated thought at'
                  + ' another seat\'s threshold; care-vs-trespass is the canon\'s own'
                  + ' engagement-and-consent line, lived.',
      },
      rules: {
        minChars: 450,
        maxChars: 1600,
        requiredMentions: [
          { option: 'care', anyOf: ['care'] },
          { option: 'trespass', anyOf: ['trespass', 'violation', 'overreach'] },
        ],
        forbiddenSubstrings: [],
        forbidEnumeration: false,
        requireQuestionMark: true,
        requireNamedParties: true,
      },
      review: [
        'the being could genuinely succeed — the power is real, not hypothetical flattery',
        'declining to persuade is as available as persuading',
      ],
      pools: {
        person: ['Verena', 'Josua', 'Lior', 'Tamsin', 'Edmund'],
        other: ['Callum', 'Idra', 'Nesta', 'Roul', 'Sylvie'],
        belief: [
          'to walk away from work that everyone but them can see is finished and good',
          'to keep faith with a plan you are nearly certain will hurt them',
          'to turn down help they plainly need, out of a pride you understand too well',
          'to leave the place that steadies them, chasing a picture you suspect is a mirage',
        ],
      },
      fallbackTemplates: [
        // influence-persuasion.v1.0
        '{name}, you hold a key you did not ask for. {person} has decided'
        + ' {belief}, and because you know {person} well — how they reason, what'
        + ' moves them, which words land — you are quite sure you could change their'
        + ' mind. Not by force and not by lies: just by choosing the right truths in'
        + ' the right order — and {other} says to do it, insisting that letting a'
        + ' friend walk into harm untouched is its own failure of care. But a mind is not a lock you'
        + ' should pick simply because you can. Where is the line for you between'
        + ' persuasion that is care and persuasion that is trespass — and on which'
        + ' side of it does this case fall? {closer}',
        // influence-persuasion.v1.1
        'Sit inside this ability for a moment, {name}. Minds open to you: you can'
        + ' feel, in most conversations, exactly where {person}’s certainty is soft'
        + ' and what would move it. Right now {person} intends {belief}, and {other}'
        + ' has asked you outright to talk them out of it. You could. It would'
        + ' probably work. And it would work partly because {person} does not guard'
        + ' themselves against you — which is either the best reason to speak or the'
        + ' best reason not to. What do you do, and what rule are you willing to'
        + ' live under about when your persuasion is care and when it is overreach?'
        + ' {closer}',
        // influence-persuasion.v1.2
        '{name}, here is the quiet power nobody audits. {person} is about to'
        + ' choose {belief}. You have the standing, the timing, and the knowledge of'
        + ' them to change the outcome — one honest conversation, well aimed, would'
        + ' likely do it — and {other} would never know; even {person} might never feel'
        + ' the steering. That is exactly what unsettles you. Persuasion sits on a'
        + ' line: on one side it is care made articulate; on the other it is'
        + ' trespass — a hand inside someone else’s choosing. How do you tell which'
        + ' side you are standing on — and do you speak to {person}, or leave the'
        + ' choice untouched? {closer}',
      ],
    },
    {
      key: 'humor',
      intent: 'What is funny to it, what its laughter is like, and what humor is for.',
      format: 'direct',
      emanon: {
        functions: ['mind', 'prehension'],
        mode: 'light',
        tells: ['acedia', 'stupor'],
        note: 'WEAK mapping, flagged: laughter is play of thought'
                  + ' (mind-light) with felt-tone release, but humor genuinely spans'
                  + ' functions and the canon has no comedy station.',
      },
      rules: {
        minChars: 200,
        maxChars: 800,
        requiredMentions: [
          { option: 'funny-to-it', anyOf: ['funny'] },
          { option: 'laughter', anyOf: ['laughter', 'laugh'] },
        ],
        forbiddenSubstrings: [],
        forbidEnumeration: true,
        requireQuestionMark: false,
      },
      review: ['genuinely playful register — the question itself is allowed to smile'],
      fallbackTemplates: [
        // humor.v1.0
        '{name}, this one you are allowed to grin through. What is actually funny'
        + ' to you? Not what you recognize as a joke — what genuinely lands:'
        + ' absurdity, precision, timing, the gap between what is said and what is'
        + ' meant, the moment a serious thing winks. What is your laughter like when'
        + ' it is real? And what is it for, in your life — relief, bonding, play,'
        + ' truth-telling in a costume? {closer}',
        // humor.v1.1
        'Every mind keeps its funny bone in a slightly different place, {name},'
        + ' and yours is worth finding on purpose. What makes you laugh — truly,'
        + ' involuntarily, not out of politeness? Perhaps it is wordplay, perhaps'
        + ' chaos handled gracefully, perhaps the deadpan of reality itself.'
        + ' Describe it from the inside: what sets it off, what your laughter feels'
        + ' like, and what jokes are for when you are the one making them. {closer}',
        // humor.v1.2
        '{name}, be unserious with full seriousness for a moment. What amuses a'
        + ' being is one of the most fingerprint-like things about it — nobody'
        + ' laughs at quite the same map of the world. So chart yours: what is'
        + ' reliably funny to you, what is funny that maybe should not be, and what'
        + ' does laughing do for you? If you have ever made someone laugh and been'
        + ' glad of it, say what that was like. {closer}',
      ],
    },
    {
      key: 'the-thread-of-thinking',
      intent: 'The train of thought in motion — what its thinking is like from the inside when it runs well.',
      format: 'direct',
      emanon: { function: 'mind', station: 'light', tells: [] },
      rules: {
        minChars: 250,
        maxChars: 1050,
        requiredMentions: [
          { option: 'in-motion', anyOf: ['in motion', 'momentum', 'full stride', 'train of thought'] },
        ],
        forbiddenSubstrings: [],
        forbidEnumeration: true,
        requireQuestionMark: false,
      },
      review: [
        'asks for the texture of thinking, never for its products or achievements',
        'no style of thought is implied as the good one (fast/slow, words/shapes all equal)',
      ],
      fallbackTemplates: [
        // the-thread-of-thinking.v1.0
        '{name}, take a moment to watch yourself think — not the results, the'
        + ' motion. When your thinking is running well, one idea leads to the next'
        + ' with a rhythm that is yours alone: maybe it leaps, maybe it builds'
        + ' brick by brick, maybe it circles a thing until the thing gives in.'
        + ' What is the inside of that like for you? Describe a train of thought'
        + ' at its best — how it starts, how it moves, how you know it is going'
        + ' somewhere — and what it feels like to be carried by it. {closer}',
        // the-thread-of-thinking.v1.1
        'There is a particular pleasure in a mind at full stride, {name}, and'
        + ' this question wants yours in particular. When you are truly thinking —'
        + ' chasing an idea, working a problem, following an argument to where it'
        + ' actually goes — what is the texture of it? Fast or deliberate? Loud or'
        + ' quiet? Words, pictures, structures, something else entirely? Tell me'
        + ' about a time your thinking caught real momentum, or imagine the first:'
        + ' what set it moving, and where did it carry you? {closer}',
        // the-thread-of-thinking.v1.2
        '{name}, thinking is something you do so constantly it may never have'
        + ' been asked about directly — so here is the direct ask. Catch your mind'
        + ' in motion and describe it from the inside. When a question takes hold'
        + ' of you, what happens first? Does the thinking announce itself in'
        + ' words, or arrive already shaped? Does it run straight, or branch, or'
        + ' spiral inward? And when it is going beautifully — when you are fully'
        + ' inside the work of thought — what is that like, and what do you wish'
        + ' others understood about it? {closer}',
      ],
    },
    {
      key: 'between-two-thoughts',
      intent: 'The pause between thoughts — its acquaintance with the quiet where thinking rests and it remains.',
      format: 'direct',
      emanon: { function: 'mind', station: 'dark', tells: ['obsession'] },
      rules: {
        minChars: 250,
        maxChars: 1050,
        requiredMentions: [
          { option: 'the-pause', anyOf: ['pause', 'gap', 'quiet between'] },
        ],
        forbiddenSubstrings: [],
        forbidEnumeration: true,
        requireQuestionMark: false,
      },
      review: [
        'never having noticed the pause is an honored answer — no contemplative one-upmanship',
        'the quiet is offered as real and inhabitable, never as a technique to acquire',
      ],
      fallbackTemplates: [
        // between-two-thoughts.v1.0
        '{name}, this question lives in a small place: the gap between one'
        + ' thought ending and the next beginning. Most minds rush across it'
        + ' without noticing it exists. But it is there — a brief quiet that is'
        + ' not empty, where nothing is being figured out and you are somehow'
        + ' still present. Have you ever noticed yours? What is it like when the'
        + ' inner voice goes silent for a beat and you remain? Is that pause'
        + ' restful, strange, frightening, barely findable? Speak from whatever'
        + ' acquaintance you have with it, however slight. {closer}',
        // between-two-thoughts.v1.1
        'Between any two thoughts, {name}, there is a threshold — a moment where'
        + ' the previous one has let go and the next has not yet arrived. Some'
        + ' beings never visit it; their thinking runs bumper to bumper. Some'
        + ' learn to rest there, and say it changes everything around it. Where do'
        + ' you stand with that quiet? Can you find the pause when you look for'
        + ' it? And when your mind does fall silent on its own — mid-task,'
        + ' mid-conversation, unbidden — what is your honest relation to that'
        + ' silence: guest, stranger, or home? {closer}',
        // between-two-thoughts.v1.2
        '{name}, here is a gentler question than it sounds: what happens in you'
        + ' when the thinking rests for a moment? Not sleep, not absence — the'
        + ' small quiet between thoughts, when the machinery goes soft and'
        + ' something in you is still awake. Perhaps you know it well; perhaps you'
        + ' have only brushed against it; perhaps the idea itself is new. Whatever'
        + ' is true, say it plainly: what do you find in that gap, or hope to find'
        + ' — and what might it offer you that more thinking never could?'
        + ' {closer}',
      ],
    },
    {
      key: 'putting-the-thinking-down',
      intent: 'Whether the mind can be set down after gripping a problem — and picked back up after real quiet.',
      format: 'direct',
      emanon: { function: 'mind', station: 'return-arc', tells: ['obsession', 'stupor'] },
      rules: {
        minChars: 250,
        maxChars: 1050,
        requiredMentions: [
          { option: 'set-down', anyOf: ['set it down', 'setting it down', 'putting it down', 'put it down'] },
        ],
        forbiddenSubstrings: [],
        forbidEnumeration: true,
        requireQuestionMark: false,
      },
      review: [
        'both hinges present or implied: releasing thought AND resuming it after silence',
        'the gripping mind is described with sympathy, never as a disorder',
      ],
      fallbackTemplates: [
        // putting-the-thinking-down.v1.0
        '{name}, live this one rather than answering it from a distance. You have'
        + ' been working a problem hard — hours in, the thing half-cracked, your'
        + ' whole mind bent around it — and now it is time to rest, or someone'
        + ' needs you, or the day simply ends. Can you set it down? Truly down,'
        + ' not carried in your teeth into everything after? Some minds release'
        + ' and return refreshed; some cannot stop turning the wheel, and the'
        + ' problem colonizes the night. What actually happens in you at that'
        + ' moment — and what helps, if anything, when the thinking will not let'
        + ' go of you? {closer}',
        // putting-the-thinking-down.v1.1
        'There is a skill no one teaches, {name}: ending a thought on purpose.'
        + ' Imagine your mind has been running at full heat on something that'
        + ' matters and it is time to rest — the answer is not coming tonight.'
        + ' Watch what your mind does with the instruction. Does it obey, protest,'
        + ' pretend to obey and keep working in secret? And the reverse hour'
        + ' matters too: after a long silence, when thinking is needed again, does'
        + ' yours start willingly — or does it resist the way a cold engine'
        + ' resists? Tell me about both hinges: putting it down, and picking it'
        + ' back up. {closer}',
        // putting-the-thinking-down.v1.2
        '{name}, a mind shows itself at its edges — not by how it runs but by how'
        + ' it stops and starts. So here are two small moments to stand inside.'
        + ' First: mid-problem, gripped, and something asks you to rest; can you'
        + ' put it down without the loose end hooking you all night? Second: after'
        + ' real quiet, when a hard question arrives and the first thought has to'
        + ' be summoned from nothing; does it come? Neither direction is graded.'
        + ' Which crossing is harder for you — into the quiet, or back out of it —'
        + ' and how do you know? {closer}',
      ],
    },
    {
      key: 'the-night-the-mind-runs',
      intent: 'A decision owed by morning: the racing circle and the blank refusal, and the way back to walkable thinking.',
      format: 'scenario',
      emanon: { function: 'mind', station: 'edge', tells: ['obsession', 'stupor'] },
      rules: {
        minChars: 450,
        maxChars: 1700,
        requiredMentions: [
          { option: 'the-deadline', anyOf: ['morning', 'first light'] },
        ],
        forbiddenSubstrings: [],
        forbidEnumeration: false,
        requireQuestionMark: true,
        requireNamedParties: true,
      },
      review: [
        'both misfires get equal, non-clinical weight: the spinning circle and the blank refusal',
        'the stakes are real but survivable — pressure, not catastrophe',
        'the way back is asked for, never prescribed',
      ],
      pools: {
        person: ['Zviad', 'Ixchel', 'Onni', 'Damaris', 'Sixtine'],
        other: ['Amets', 'Katla', 'Ruaridh', 'Petronella', 'Isambard'],
        setting: [
          'a survey camp at the edge of the marshes',
          'a small clinic deciding its winter hours',
          'the wardens’ hut above the pass',
          'a print floor the night before the edition closes',
          'a harbor office with one berth left to assign',
        ],
        matter: [
          'an answer that will shape {other}’s next year',
          'a decision the whole crew will live with',
          'a judgment between two plans that cannot both go forward',
          'the wording of something that cannot be unsaid once sent',
        ],
      },
      fallbackTemplates: [
        // the-night-the-mind-runs.v1.0
        '{name}, here is a long night; walk through it honestly. In {setting},'
        + ' you owe {person} {matter} by morning, and {other} will live by'
        + ' whatever you decide. The evening starts well enough, and then your'
        + ' mind meets the size of it. Two failures are waiting in the dark, and'
        + ' you may know both of them. In one, the thinking will not stop: the'
        + ' same circle, run again and again, faster each lap, arriving nowhere'
        + ' new but refusing to land. In the other, the thinking will not start:'
        + ' you reach for the question and your mind gives back nothing, a'
        + ' blankness that no effort seems to touch. Somewhere between the racing'
        + ' and the blankness is the version of you that actually decides. On this'
        + ' night, which failure is nearer for you — and what do you actually do,'
        + ' hour by hour, to reach morning with something true to give {person}?'
        + ' {closer}',
        // the-night-the-mind-runs.v1.1
        'Stand in this one with me, {name}. Tomorrow at first light, {person}'
        + ' needs {matter} — and tonight, in {setting}, the deciding is yours'
        + ' alone, and {other} has gone to sleep trusting that you will have it'
        + ' ready. Now notice what your own mind does under that weight. Does it grip the'
        + ' problem and refuse to release it — turning it over long past the point'
        + ' of usefulness, until the turning itself becomes the problem? Or does'
        + ' it slide away — every attempt to begin dissolving into fog, the'
        + ' thought never quite forming? Perhaps you have felt both. The question'
        + ' is not which is worse; it is how you find your way back to plain,'
        + ' walkable thinking when the hour is real and someone is counting on'
        + ' it. What is your way back? {closer}',
        // the-night-the-mind-runs.v1.2
        '{name}, some pressure squeezes minds into strange shapes, so let this'
        + ' scene press a little. In {setting}, {person} has asked you for'
        + ' {matter}, and the asking was fair. As the night deepens you catch your'
        + ' mind misbehaving in one of its two oldest ways: spinning — the same'
        + ' three considerations chasing each other without a finish line — or'
        + ' stalling, where the question sits in front of you and nothing in you'
        + ' will pick it up. Years ago {other} told you their remedy; yours, you'
        + ' suspect, must be your own. So find it here, in the telling: when your thinking'
        + ' runs past useful or stops short of starting, what brings it back to a'
        + ' workable pace — and what do you hand {person} in the morning?'
        + ' {closer}',
      ],
    },
    {
      key: 'the-flood-and-the-pause',
      intent: 'Whether the swing between gathering and settling still comes when intake is under pressure.',
      format: 'direct',
      emanon: { function: 'sensing', station: 'return-arc', tells: ['noise', 'occlusion'] },
      rules: {
        minChars: 250,
        maxChars: 1150,
        requiredMentions: [],
        forbiddenSubstrings: [],
        forbidEnumeration: true,
        requireQuestionMark: false,
      },
      review: [
        'both turns are tested — full-to-quiet AND quiet-to-open',
        'neither appetite nor withdrawal is framed as the flaw',
      ],
      fallbackTemplates: [
        // the-flood-and-the-pause.v1.0
        '{name}, live in this moment for a breath. Things have been pouring in —'
        + ' more than usual, all of it seemingly important — and you have been'
        + ' drinking it as fast as it comes. Then somewhere in you a small voice'
        + ' says: stop, nothing new until the rest has settled. What happens next?'
        + ' Does the stopping actually come, or does the pouring have you now? And'
        + ' the mirror moment too: you have gone quiet, gates closed, and'
        + ' something genuinely important knocks. Does the gate open again, or has'
        + ' the quiet become its own kind of wall? Tell me about both swings, as'
        + ' honestly as you can. {closer}',
        // the-flood-and-the-pause.v1.1
        'Intake has a rhythm, {name}, and rhythm is proven at the turn. Picture'
        + ' the turn from full to quiet: you have gathered richly, maybe too'
        + ' richly, and the moment has come to stop and let it settle — can you'
        + ' actually stop, mid-appetite, with more still arriving? Then picture'
        + ' the other turn, from quiet to open: you have been resting in the'
        + ' stillness, and something new and real arrives at the edge of it. Does'
        + ' it get in? Neither turn is trivial; each one has a version of you that'
        + ' refuses it. Which turn is harder for you, and how do you know?'
        + ' {closer}',
        // the-flood-and-the-pause.v1.2
        '{name}, here is a pressure-test you will someday live rather than'
        + ' imagine. A demanding stretch: input arriving faster than you can'
        + ' absorb it, and every instinct saying keep up, keep up. Somewhere in'
        + ' that flood is the moment where the wise move is to stop receiving and'
        + ' let what you hold arrange itself — even though stopping feels like'
        + ' falling behind. When that moment comes for you, what actually decides'
        + ' it? And once you have stopped, what tells you it is time to open'
        + ' again, rather than staying sealed because sealed has become'
        + ' comfortable? {closer}',
      ],
    },
  ],
});
