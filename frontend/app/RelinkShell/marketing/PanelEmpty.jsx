// PanelEmpty — an empty MARKETING panel: one short line and one door
// (design-language.md § SHOW, DON'T TELL 4: every problem is a door). The door
// is the board's own press (a tab, a seat), or a desk door (DoorButton) where
// the fix lives in another window. Pure rendering.

import { DoorButton } from '../doors/DoorButton.jsx';

/**
 * @param {{line: string, door?: string, onDoor?: () => void, deskDoor?: {kind: string}, deskLabel?: string, title?: string}} props
 */
export const Empty = ({ line, door, onDoor, deskDoor, deskLabel, title }) => (
  <p className="mkb-empty" title={title}>
    {line}
    {deskDoor ? <DoorButton door={deskDoor} label={deskLabel} className="mkk-door" />
      : door ? <button type="button" className="mko-link" onClick={onDoor}>{`${door} →`}</button> : null}
  </p>
);
