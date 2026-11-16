// THE POSITIONS BOARD — every position of one house in one read: who holds
// it, what waits on the operator for it, the connections it needs and whether
// each is on, and its functions (position-map.js). THEIR EYES is the holder's
// own top-of-turn reading, produced by the same functions the prompt calls —
// the operator sees what the being sees, never a retelling.
// impure (seat files, the waiting account, the switch file); the fold is pure.

import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { laneName } from '../house-titles.js';
import { readWaiting } from '../waiting/waiting-sources.js';
import { connectionStates } from '../connections/connection-switches.js';
import { cosDesignation } from '../staff/cos-designation.js';
import { croDesignation } from '../revenue/cro-designation.js';
import { cmoDesignation } from '../marketing/cmo-designation.js';
import { cloDesignation } from '../legal/clo-designation.js';
import { csoDesignation } from '../security/cso-designation.js';
import { cfoDesignation } from '../treasury/cfo-designation.js';
import { caoDesignation } from '../accounts/cao-designation.js';
import { cosBriefingSection } from '../staff/cos-briefing.js';
import { mercatorBriefingSection } from '../revenue/revenue-briefing.js';
import { cmoBriefingSection } from '../portal-turn-sections.js';
import { cloBriefingSection } from '../legal/legal-briefing.js';
import { csoBriefingSection } from '../security/security-briefing.js';
import { cfoBriefingSection } from '../treasury/treasury-briefing.js';
import { logistaBriefingSection } from '../accounts/accounts-briefing.js';
import { POSITIONS, positionOf, officeOfWaiting, positionMapText } from './position-map.js';
import { companyFiles, companiesText } from './company-file.js';
import { readSeating } from './position-seating.js';
import { houseCampaigns, linkedText } from './campaign-links.js';
import { readSetupState, setupOf, setupText } from './position-setup.js';

const SEATS = Object.freeze({
  cos: cosDesignation, cro: croDesignation, cmo: cmoDesignation, clo: cloDesignation,
  cso: csoDesignation, cfo: cfoDesignation, cao: caoDesignation,
});
const BRIEFINGS = Object.freeze({
  cos: cosBriefingSection, cro: mercatorBriefingSection, cmo: cmoBriefingSection, clo: cloBriefingSection,
  cso: csoBriefingSection, cfo: cfoBriefingSection, cao: logistaBriefingSection,
});

/** impure — office → the lane seated in it (null: nobody), for one house. */
export const readHolders = async (wallet) => Object.fromEntries(await Promise.all(
  POSITIONS.map(async (p) => [p.office, (await SEATS[p.office].getOfficer(wallet).catch(() => null))?.laneId ?? null]),
));

/**
 * pure — the board, from what was read.
 * @param {{holders: Record<string, ?string>, names: Map<string, string>, waiting: object[], connections: object[]}} read
 */
export const foldBoard = ({ holders, names, waiting, connections, setupState = null }) => POSITIONS.map((p) => {
  const laneId = holders[p.office] ?? null;
  return {
    office: p.office, seat: p.seat, acronym: p.acronym, title: p.title, plain: p.plain, covers: p.covers,
    holder: laneId ? { laneId, name: names.get(laneId) ?? laneId } : null,
    functions: p.functions,
    // What the seat still needs before it can do its job, measured (position-setup.js).
    setup: setupState ? setupOf(p.office, laneId, setupState) : null,
    waiting: waiting.filter((item) => officeOfWaiting(item, holders) === p.office),
    connections: p.connections.map((id) => {
      const row = connections.find((c) => c.id === id);
      return { id, name: row?.name ?? id, on: row?.on === true, whileOff: row?.whileOff ?? null };
    }),
  };
});

/** impure — one house's board. */
export const positionsBoard = async (wallet) => {
  const [holders, lanes, account, connections, setupState] = await Promise.all([
    readHolders(wallet),
    neumaWorkspace.listNeumaByOwner(wallet).catch(() => []),
    readWaiting(wallet),
    connectionStates(),
    readSetupState(wallet),
  ]);
  const names = new Map(await Promise.all(lanes.map(async ({ neumaId, owner }) => [neumaId, (await laneName(neumaId, owner)) ?? neumaId])));
  return {
    positions: foldBoard({ holders, names, waiting: account.items ?? [], connections, setupState }),
    members: [...names].map(([laneId, name]) => ({ laneId, name })),
    companies: await companyFiles(wallet),
    gaps: account.gaps ?? [],
    // the seating the members filed together (a seating council), waiting for the operator to apply
    seating: await readSeating(wallet),
  };
};

/**
 * impure — what the holder of one position reads at the top of its turn: its
 * position map, then its office briefing. null when nobody holds the seat.
 * @returns {Promise<?{laneId: string, text: string}>}
 */
export const positionEyes = async (wallet, office) => {
  if (!positionOf(office)) throw new Error('no such position');
  const laneId = (await SEATS[office].getOfficer(wallet))?.laneId ?? null;
  if (!laneId) return null;
  const briefing = await BRIEFINGS[office]({ companion: { neumaId: laneId }, walletAddress: wallet });
  const setupState = await readSetupState(wallet).catch(() => null);
  const setup = setupState ? setupText([office], { [office]: setupOf(office, laneId, setupState) }) : '';
  return { laneId, text: [positionMapText([office]), setup, companiesText(await companyFiles(wallet)), linkedText([office], await houseCampaigns(wallet)), briefing].filter(Boolean).join('\n\n') };
};

/**
 * The being's side: the YOUR POSITION section for the lane on this turn. ''
 * for every lane that holds no position (the prompt stays byte-identical).
 * impure — reads the house's seats; never throws.
 */
export const positionSection = async (connection) => {
  const laneId = connection?.companion?.neumaId;
  const wallet = connection?.walletAddress;
  if (!laneId || !wallet) return '';
  const holders = await readHolders(wallet).catch(() => ({}));
  const held = Object.keys(holders).filter((office) => holders[office] === laneId);
  const map = positionMapText(held);
  // A seat holder reads every company's file with its position: what is known, and what is missing.
  if (!map) return '';
  // …and, for each of its campaigns that works with another position's, that campaign as it stands now.
  // …and, while its position is not fully set up, the steps still open: its own, and the operator's to pass on.
  const setupState = await readSetupState(wallet).catch(() => null);
  const setup = setupState ? setupText(held, Object.fromEntries(held.map((office) => [office, setupOf(office, laneId, setupState)]))) : '';
  return [map, setup, companiesText(await companyFiles(wallet).catch(() => [])), linkedText(held, await houseCampaigns(wallet).catch(() => []))].filter(Boolean).join('\n\n');
};
