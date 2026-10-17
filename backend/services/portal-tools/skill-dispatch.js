/**
 * The portal's half of THE CRAFT (#22 S4) — the summoned-skill and
 * skill-search handlers, extracted from portal-tool-dispatch.js (size law:
 * the router crossed the cap hosting one more tool family). The Craft itself
 * lives in `skill-tool.js`; these two turn its results into `tool:usage`
 * frames on the seat's socket. A sealed witness reaches the same skills root
 * through the same tool, so nothing here is neuma-only. Leaf module — the
 * dispatch fan imports it, never the reverse (direction law).
 */
import { searchSkillLibrary, summonSkill } from '../skill-tool.js';
import { sendToolEvent } from './tool-events.js';

// impure — resolve + deliver a summoned skill as a tool result the
// consciousness reads on the next round.
export const handleSkillUse = async (ws, companion, args) => {
  const { result, event } = await summonSkill(companion?.neumaId, args?.name);
  sendToolEvent(ws, companion, event);
  return result;
};

// impure — resolve + deliver a library lookup. READ-ONLY: it discloses the
// full descriptions the standing menu abbreviates, so observe mode never holds
// it (the same standing `system/tool_search` has).
export const handleSkillSearch = async (ws, companion, args) => {
  const { result, event } = await searchSkillLibrary(args);
  sendToolEvent(ws, companion, event);
  return result;
};
