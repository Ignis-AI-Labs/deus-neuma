// glyphs.jsx — the projects window's shared stroke glyphs.
//
// pure — one place for the little line-drawn marks the shelf and the focus
// view both wear, so the two surfaces can never drift on iconography.

export const ProjectsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M2 4.5 L8 1.5 L14 4.5 L8 7.5 Z" /><path d="M2 8 L8 11 L14 8 M2 11.5 L8 14.5 L14 11.5" />
  </svg>
);
export const TrashGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
    <path d="M2.5 4 H13.5 M6 4 V2.5 H10 V4 M4 4 V14 H12 V4 M6.5 6.5 V11.5 M9.5 6.5 V11.5" />
  </svg>
);
export const ResumeGlyph = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    <path d="M4 2.5 L12 8 L4 13.5 Z" />
  </svg>
);
export const UnpinGlyph = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    <path d="M3.5 3.5 L12.5 12.5 M12.5 3.5 L3.5 12.5" />
  </svg>
);
export const FileGlyph = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
    <path d="M4 1.5 H9.5 L12.5 4.5 V14.5 H4 Z M9.5 1.5 V4.5 H12.5" />
  </svg>
);
export const FolderTreeGlyph = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M1.5 4 H6 L7.5 5.5 H14.5 V12.5 H1.5 Z" />
  </svg>
);
// A repository is a folder that carries a .git — marked with a branch node.
export const RepoGlyph = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
    <circle cx="4" cy="4" r="1.6" /><circle cx="4" cy="12" r="1.6" /><circle cx="12" cy="6.5" r="1.6" />
    <path d="M4 5.6 V10.4 M4 8 H8.5 A2 2 0 0 0 10.5 6.5" />
  </svg>
);
// A crystallized moment — the memory panel's small facet mark.
export const MemoryGlyph = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M8 1.5 L14 6 L11.5 14 H4.5 L2 6 Z M2 6 H14 M8 1.5 L4.5 14 M8 1.5 L11.5 14" />
  </svg>
);
