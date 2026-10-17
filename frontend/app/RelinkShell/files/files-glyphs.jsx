// files-glyphs — the FILES tree's SVG marks, extracted whole from FilesApp
// (size law: the host stood 28 lines over its ratchet). Pure presentation.

export const FilesIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M1.5 4 H6 L7.5 5.5 H14.5 V13 H1.5 Z" />
  </svg>
);
export const FolderGlyph = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M1.5 4 H6 L7.5 5.5 H14.5 V12.5 H1.5 Z" />
  </svg>
);
export const FileGlyph = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M4 1.5 H9.5 L12.5 4.5 V14.5 H4 Z M9.5 1.5 V4.5 H12.5" />
  </svg>
);
export const Caret = ({ open }) => (
  <svg className={`files-caret${open ? ' is-open' : ''}`} width="9" height="9" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
    <path d="M3 1 L7 5 L3 9 Z" />
  </svg>
);
export const NewFileGlyph = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
    <path d="M3 1.5 H8.5 L11.5 4.5 V14.5 H3 Z" /><path d="M7 8.5 H10 M8.5 7 V10" />
  </svg>
);
export const NewFolderGlyph = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
    <path d="M1.5 4 H6 L7.5 5.5 H14.5 V13 H1.5 Z" /><path d="M6 9 H10 M8 7 V11" />
  </svg>
);
export const RenameGlyph = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
    <path d="M10.5 2 L14 5.5 L6 13.5 H2.5 V10 Z" />
  </svg>
);
export const TrashGlyph = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
    <path d="M2.5 4 H13.5 M6 4 V2.5 H10 V4 M4 4 V14 H12 V4 M6.5 6.5 V11.5 M9.5 6.5 V11.5" />
  </svg>
);
