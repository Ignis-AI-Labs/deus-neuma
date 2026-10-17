// forge-icons — the forge's line icons (LINE & CYCLE: custom SVG, never
// emoji). 1.2px strokes on currentColor so a control's state colours them.

const Svg = ({ size = 16, children }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    {children}
  </svg>
);

export const PlayIcon = ({ size }) => <Svg size={size}><path d="M5 3.5 L12.5 8 L5 12.5 Z" fill="currentColor" stroke="none" /></Svg>;
export const StopIcon = ({ size }) => <Svg size={size}><rect x="4.5" y="4.5" width="7" height="7" fill="currentColor" stroke="none" /></Svg>;
export const PauseIcon = ({ size }) => <Svg size={size}><path d="M5 4 V12 M11 4 V12" strokeWidth="2.2" /></Svg>;
export const RewindIcon = () => <Svg size={14}><path d="M3.2 8 A4.8 4.8 0 1 0 5 4.3 M5 1.8 V4.6 H2.2" /></Svg>;
export const CloseIcon = () => <Svg size={12}><path d="M3.5 3.5 L12.5 12.5 M12.5 3.5 L3.5 12.5" /></Svg>;
export const BackIcon = () => <Svg size={14}><path d="M10 3 L5 8 L10 13" /></Svg>;
export const InfoIcon = () => <Svg size={14}><circle cx="8" cy="8" r="6" /><path d="M8 7.2 V11.5 M8 4.8 V5.6" /></Svg>;
export const GearIcon = () => (
  <Svg size={14}>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.8 V3.6 M8 12.4 V14.2 M1.8 8 H3.6 M12.4 8 H14.2 M3.6 3.6 L4.9 4.9 M11.1 11.1 L12.4 12.4 M3.6 12.4 L4.9 11.1 M11.1 4.9 L12.4 3.6" />
  </Svg>
);
export const CheckIcon = () => <Svg size={12}><path d="M3 8.5 L6.5 12 L13 4.5" /></Svg>;

// The four ways in.
export const WAY_ICONS = Object.freeze({
  library: () => (
    <Svg size={22}><rect x="2" y="2" width="5" height="5" /><rect x="9" y="2" width="5" height="5" /><rect x="2" y="9" width="5" height="5" /><rect x="9" y="9" width="5" height="5" /></Svg>
  ),
  describe: () => <Svg size={22}><path d="M2.5 4 H13.5 M2.5 7 H13.5 M2.5 10 H9.5 M11 13.5 L14 10.5" /></Svg>,
  record: () => (
    <Svg size={22}><rect x="6" y="1.8" width="4" height="8" rx="2" /><path d="M3.5 7.5 Q3.5 12 8 12 Q12.5 12 12.5 7.5 M8 12 V14.5" /></Svg>
  ),
  upload: () => <Svg size={22}><path d="M8 11 V2.5 M4.5 6 L8 2.5 L11.5 6 M2.5 10.5 V13.5 H13.5 V10.5" /></Svg>,
});
