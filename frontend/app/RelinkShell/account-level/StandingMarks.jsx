// StandingMarks — an account's KEYS · HOLDER · CREW as three marks
// (standing-marks.js): the fact's own glyph (a key, a seat, a crew) in the
// tone of its level, the LevelMark beside it when it is not fine, the
// holder's name and the crew's count where they are data — each named on
// hover. A mark that is not fine opens with its door (≤3 words and →); the
// holder and the crew are also presses that open their drawer in place.
//
// impure — sound; the doors are DoorButton's.

import { uiSound } from '../../../services/ui-sound.js';
import { DoorButton } from '../doors/DoorButton.jsx';
import { SEAT_DOOR } from './standing-marks.js';
import { LevelMark } from '../level-mark.jsx';

const GLYPHS = Object.freeze({
  keys: <><circle cx="5" cy="9" r="3.2" /><path d="M8.2 9 H16 M13 9 V12 M15.5 9 V11.5" /></>,
  holder: <><circle cx="9" cy="5" r="2.8" /><path d="M3.5 16 C3.5 11.5 14.5 11.5 14.5 16" /></>,
  crew: <><circle cx="6" cy="6" r="2.3" /><circle cx="12.5" cy="6" r="2.3" /><path d="M1.5 15.5 C1.5 11.5 10.5 11.5 10.5 15.5 M8 15.5 C8 11.5 17 11.5 17 15.5" /></>,
});

const Glyph = ({ fact }) => (
  <svg className="asm-glyph" width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" focusable="false">{GLYPHS[fact]}</svg>
);

/** One mark: glyph, level (when not fine), value; a press when it opens something. */
const Mark = ({ mark, value, onPress, pressed }) => {
  const inner = (
    <>
      <Glyph fact={mark.fact} />
      {mark.level === 'ok' ? null : <LevelMark level={mark.level} size={13} />}
      {value !== undefined && value !== null ? <span className="asm-v">{value}</span> : null}
    </>
  );
  const cls = `asm is-${mark.level}`;
  if (!onPress) return <span className={cls} data-standing={mark.fact} role="img" aria-label={mark.title} title={mark.title}>{inner}</span>;
  return (
    <button type="button" className={`${cls} is-press`} data-standing={mark.fact} aria-label={mark.title} title={mark.title}
      aria-expanded={pressed} onClick={onPress}>{inner}</button>
  );
};

/**
 * @param {{keys: object, holder: object, crew: object, drawer: ?string, onDrawer: (d: ?string) => void, picks?: boolean}} props
 *   the three marks (standing-marks.js); drawer — the one open in place ('holder' | 'crew' | null);
 *   picks — there is an account here whose holder can be chosen
 */
export const StandingMarks = ({ keys, holder, crew, drawer, onDrawer, picks = true }) => {
  const toggle = (d) => () => { uiSound('toggle'); onDrawer(drawer === d ? null : d); };
  // Not fine, the holder opens with its door: SEAT A CMO where no one holds the seat, else the picker in place.
  const holderDoor = holder.door?.seat ? <DoorButton door={SEAT_DOOR} label={holder.door.label} />
    : holder.door ? (
      <button type="button" className="settings-set door-btn" aria-expanded={drawer === 'holder'} title="choose who speaks as this account" onClick={toggle('holder')}>
        {holder.door.label} <span className="door-arrow" aria-hidden="true">→</span>
      </button>
    ) : null;
  return (
    <span className="asm-row" role="group" aria-label="standing">
      <Mark mark={keys} />
      {keys.reason ? <span className="asm-reason">{keys.reason}</span> : null}
      {keys.door ? <DoorButton door={keys.door.door} label={keys.door.label} /> : null}
      <Mark mark={holder} value={holder.name} onPress={!picks || holder.level === 'unknown' || (holder.door && !holder.door.seat) ? null : toggle('holder')} pressed={drawer === 'holder'} />
      {holderDoor}
      <Mark mark={crew} value={crew.count} onPress={toggle('crew')} pressed={drawer === 'crew'} />
    </span>
  );
};
