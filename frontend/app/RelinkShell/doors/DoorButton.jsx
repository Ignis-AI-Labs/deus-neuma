// DoorButton — one door, one press: at most three words and the arrow, the
// place it lands named on hover (door-words.js), carried out by the desk's one
// door table (open-door.js). The same mark on every surface, so a door is
// learned once (design language § SHOW, DON'T TELL 4, 8). Off the desk (no
// window manager to open on) it is only its words: there is nowhere to go.

import { uiSound } from '../../../services/ui-sound.js';
import { useWindows } from '../../windowing/use-windows.js';
import { openDoor } from './open-door.js';
import { doorLabel, doorPlace } from './door-words.js';
import './doors.css';

/**
 * @param {{door: {kind: string}, label?: string, title?: string, bar?: boolean, className?: string}} props
 *   label — the press when the door's own name is not the right one (≤3 words);
 *   bar — it sits in a window's title bar, so its press never starts a drag
 */
export const DoorButton = ({ door, label, title, bar = false, className = '' }) => {
  const windows = useWindows();
  const words = label || doorLabel(door);
  if (!windows?.dispatch) return <span className={`door-btn is-shut ${className}`.trim()}>{words}</span>;
  return (
    <button type="button" className={`settings-set door-btn${bar ? ' is-bar' : ''} ${className}`.trim()} data-door={door.kind}
      title={title || doorPlace(door)}
      onPointerDown={bar ? (e) => e.stopPropagation() : undefined}
      onClick={() => { uiSound('open'); openDoor(door, windows); }}>
      {words} <span className="door-arrow" aria-hidden="true">→</span>
    </button>
  );
};
