// picker-glyphs — the FolderPicker's custom SVG set (no emoji, no icon font).
// Hairline strokes at 1.2–1.4, 45° and 90° only, so the glyphs read as LINE.

const Svg = ({ size = 14, width = 1.2, children }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={width} aria-hidden="true">
    {children}
  </svg>
);

export const FolderGlyph = () => <Svg><path d="M1.5 4 H6 L7.5 5.5 H14.5 V12.5 H1.5 Z" /></Svg>;
export const FileGlyph = () => <Svg><path d="M4 1.5 H9.5 L12.5 4.5 V14.5 H4 Z M9.5 1.5 V4.5 H12.5" /></Svg>;
export const UpGlyph = () => <Svg size={13} width={1.4}><path d="M8 13 V3.5 M4 7 L8 3 L12 7" /></Svg>;
export const HomeGlyph = () => <Svg size={13} width={1.3}><path d="M2.5 7.5 L8 3 L13.5 7.5 M4 6.5 V13 H12 V6.5" /></Svg>;
const DiskGlyph = () => <Svg><path d="M2 5 H14 V11 H2 Z M11.4 8 H12" /></Svg>;
export const RootGlyph = () => <Svg><path d="M2 3 H14 M2 8 H14 M2 13 H14 M5 3 V13" /></Svg>;
const PinGlyph = () => <Svg><path d="M8 14.5 V9.5 M4.5 9.5 H11.5 L10 6.5 V2 H6 V6.5 Z" /></Svg>;
const ClockGlyph = () => <Svg><circle cx="8" cy="8" r="6" /><path d="M8 4.5 V8 L10.5 9.5" /></Svg>;
export const EnterGlyph = () => <Svg size={12} width={1.4}><path d="M13 3 V9 H3.5 M6.5 6 L3.5 9 L6.5 12" /></Svg>;
export const ChevronGlyph = () => <Svg size={11} width={1.4}><path d="M6 3.5 L10.5 8 L6 12.5" /></Svg>;
export const FilterGlyph = () => <Svg size={12} width={1.3}><path d="M2 3 H14 L9.5 8.5 V13 L6.5 14 V8.5 Z" /></Svg>;

// The brand mark in miniature — a circle inscribed in a chamfered square
// (TR+BL cuts). The picker is where the neuma meets the witness's disk.
export const EmblemGlyph = () => (
  <Svg size={16} width={1.1}>
    <path d="M1.5 1.5 H11.5 L14.5 4.5 V14.5 H4.5 L1.5 11.5 Z" />
    <circle cx="8" cy="8" r="4" />
  </Svg>
);

/** The rail's per-section glyph. */
export const SECTION_GLYPHS = Object.freeze({
  places: HomeGlyph,
  pinned: PinGlyph,
  drives: DiskGlyph,
  recent: ClockGlyph,
});
