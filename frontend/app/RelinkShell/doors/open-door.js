// open-door — a door carried out (the door table: door-plan.js): the window
// raised or opened, the exact place latched in that window's own idiom, and
// — where the plan names one — the place brought into view and marked once
// it shows. The way every MARKETING fix reaches its place (and the house
// social check's), so one door means one thing everywhere (CHOKKAN 4).
//
// impure — window actions, latches, one sessions read for a chat door.

import { requestSettingsFocus } from '../settings-focus.js';
import { requestCardLanding } from '../card-landing.js';
import { requestBrandSection } from '../brandkits/brand-landing.js';
import { jumpTo, revealCard } from '../waiting/waiting-jump.js';
import { doorPlan } from './door-plan.js';
import { openChat } from './hand-over.js';

/**
 * impure — open a door. False when it is no door the table knows (a fix done
 * in place) or there is no desk to open it on.
 * @param {?{kind: string}} door - the door contract (door-plan.js)
 * @param {?{state: {windows: object[]}, dispatch: Function}} windows - useWindows()
 * @returns {boolean}
 */
export const openDoor = (door, windows) => {
  const plan = doorPlan(door);
  if (!windows?.dispatch || !plan) return false;
  const { dispatch } = windows;
  if (plan.sitting) {
    openChat(plan.sitting, windows);
    return true;
  }
  if (plan.jump) {
    jumpTo(plan.jump, { windows: windows.state?.windows ?? [], dispatch });
    return true;
  }
  if (plan.settingsFocus) requestSettingsFocus(plan.settingsFocus);
  if (plan.brandSection) requestBrandSection(plan.brandSection.companyId, plan.brandSection.section);
  for (const { app, item } of plan.landings || []) requestCardLanding(app, item);
  dispatch({ type: 'OPEN', id: plan.open });
  if (plan.reveal) revealCard(plan.reveal);
  return true;
};
