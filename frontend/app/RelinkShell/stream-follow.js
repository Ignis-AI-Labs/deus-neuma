// stream-follow.js — the transcript's follow law (ruling, 2026-07-23): the
// stream snaps to the live tail BY DEFAULT, but the witness is human — they
// read at reading speed. Scrolling up RELEASES the follow (the view stands
// where they stand, even while members keep streaming); scrolling back to
// the tail re-arms it; and the pinned control at the transcript's bottom
// edge states the mode and flips it deliberately. Pure predicate — the
// components own state and DOM.

// Within this many pixels of the bottom, the reader stands "at the tail".
export const FOLLOW_SLACK_PX = 48;

export const atTail = (el, slack = FOLLOW_SLACK_PX) =>
  el.scrollHeight - el.scrollTop - el.clientHeight <= slack;
