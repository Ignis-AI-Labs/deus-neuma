// MarketingTitle — the MARKETING window's title: MARKETING // <the CMO>.
// The window is the CMO's office, so it names the seat's holder (or NO CMO),
// never the being the chat is focused on. The registry holds the title as a
// constant element, so the holder arrives through the shared seat read
// (use-cmo-seat.js), never through props. An empty seat is a door: NO CMO
// opens SEAT, where one is seated (show-dont-tell-audit.md, finding 17).

import { AppTitle } from '../app-title.jsx';
import { DoorButton } from '../doors/DoorButton.jsx';
import { useCmoSeat, seatTitle } from './use-cmo-seat.js';

const SEAT = Object.freeze({ kind: 'marketing', tab: 'seat', reveal: '[data-cmo-row]' });

export const MarketingTitle = () => {
  const seat = useCmoSeat();
  const name = seatTitle(seat);
  return <AppTitle label="MARKETING" labelKey="apps.marketing" name={seat.known && !seat.cmo ? <DoorButton door={SEAT} label={name} bar /> : name} />;
};
