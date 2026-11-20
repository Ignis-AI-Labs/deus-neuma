// speech-artifacts — what Whisper writes when nobody spoke. Pure.
//
// On a quiet stretch (the end of a hold, a pause in a recording) Whisper sometimes writes a line it
// learned from the subtitled video it was trained on, never anything that was said: […] landed at the end of Founder's dictation on 2026-11-15 ([…]). These lines are removed wherever the app's own speech recognition hands text on:
// dictation into the chat box, dictation into other apps, and a recording a neuma listens to.
//
// Only lines nobody dictates are removed anywhere in a text. A short common reply ("Thank you.") is
// left alone; the few artifacts that are also words a person could say ("Thanks for watching!",
// "you") are removed only when they are the whole of what came back.

const ANYWHERE = Object.freeze([
  /\bfor more information,? (?:please )?visit www\.fema\.gov\.?/gi,
  /\bsubtitles? (?:by|from) the amara\.org community\.?/gi,
  /\btranscri(?:bed|ption) by (?:https?:\/\/)?(?:www\.)?(?:otter\.ai|castingwords(?:\.com)?)\.?/gi,
]);
const WHOLE = /^(?:thanks? for watching[.!]?|thank you for watching[.!]?|please subscribe[.!]?|you\.?|♪+)$/i;

/**
 * The text without the lines Whisper writes over silence. Pure.
 * @param {unknown} text
 * @returns {string}
 */
export const withoutSpeechArtifacts = (text) => {
  let t = String(text ?? '');
  for (const re of ANYWHERE) {
    // where an artifact sat, its gap closes; the rest of the words are left exactly as heard
    t = t.replace(re, '\u0000').replace(/[ \t]*\u0000[ \t]*/g, ' ');
  }
  t = t.trim();
  return WHOLE.test(t) ? '' : t;
};
