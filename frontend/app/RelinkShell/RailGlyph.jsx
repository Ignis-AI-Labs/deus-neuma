// RailGlyph — the fold arrow every right-hand stream rail wears (tasks,
// chats). One glyph, one truth about which way a rail folds; the Explorer's
// left rail points the other way and keeps its own.

export const RailGlyph = ({ open }) => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
    {open ? <path d="M3 1 L7 5 L3 9 Z" /> : <path d="M7 1 L3 5 L7 9 Z" />}
  </svg>
);
