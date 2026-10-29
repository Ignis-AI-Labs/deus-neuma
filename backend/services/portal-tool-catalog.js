/**
 * THE TOOL CATALOG — `platformToolsFor`, the single builder of the platform
 * tool surface for both seats (a bound neuma, a sealed AI witness).
 *
 * Extracted VERBATIM from portal-stream.js (size-law breakdown 2026-08-26,
 * docs/work/size-law-breakdown.md Part 1 step 8 / #278). Catalog module —
 * it imports the tool families (portal-tools/) and shared leaves DIRECTLY,
 * never portal-stream (direction law: leaf ← family ← catalog ← dispatch
 * ← loop ← orchestrator). portal-stream keeps the public re-export, so
 * external readers (witness-tools.js,
 * the test fan) stay pointed at that barrel unchanged.
 */
import { createLogger } from './logger.js';
import { refinementToolsFor } from './refinement-being-tools.js';
import { voiceToolsFor } from './voice-being-tools.js';
import { webToolsFor } from './web-being-tools.js';
import { chainToolsFor } from './chain/chain-being-tools.js';
import { mediaToolsFor } from './media-being-tools.js';
import { imageToolsFor, cardToolsFor } from './image-forge/image-being-tools.js';
import { mapToolsFor } from './map-being-tools.js';
import { platformFeedToolsFor } from './platform-feed/platform-feed-tools.js';
import { flightCheckToolsFor } from './flight-check.js';
import { kspToolsFor } from './ksp/ksp-being-tools.js';
import { emailToolsFor } from './email/email-being-tools.js';
import { pressToolsFor } from './doc-press/press-being-tools.js';
import { securityToolsFor } from './security/security-being-tools.js';
import { legalToolsFor } from './legal/legal-being-tools.js';
import { treasuryToolsFor } from './treasury/treasury-being-tools.js';
import { benchToolsFor } from './bench/bench-being-tools.js';
import { isAdvertisedTool, normalizeChatMode } from './tool-policy.js';
import { ASK_OPERATOR_TOOL } from './operator-ask.js';
import { PLAN_SUBMIT_TOOL } from './team-tool-defs.js';
import { PLAN_PRESENT_TOOL } from './plan-mode.js';
import { SOVEREIGNTY_PROPOSALS_TOOL } from './sovereignty/gateway-tools.js';
import { skillService } from './skill-service.js';
import { SKILL_SEARCH_TOOL, USE_SKILL_TOOL } from './skill-tool.js';
import {
  REQUEST_SEAL_TOOL,
  sealEligibility as _sealEligibility,
  WALLET_VIEW_TOOL,
} from './portal-tools/wallet-seal-tools.js';
import { channelToolsFor } from './portal-tools/social-queue-tools.js';
import { retrieveToolsFor as _retrieveToolsFor } from './portal-tools/retrieve-result-tool.js';
import { memoryToolsFor as _memoryToolsFor } from './portal-tools/memory-being-tools.js';
import { findingsToolsFor as _findingsToolsFor } from './portal-tools/findings-tools.js';
import {
  housePostToolsFor as _housePostToolsFor,
  LEAD_TOOLS,
  campaignToolsFor as _campaignToolsFor,
} from './portal-tools/crew-desk-tools.js';
import { staffToolsFor as _staffToolsFor } from './portal-tools/staff-tools.js';
import { openChatsToolsFor } from './portal-tools/chat-link-tools.js';
import { VAULT_TOOLS } from './portal-tools/vault-being-tools.js';
import { TASK_TOOLS, VESSEL_LOG_TOOL } from './portal-tools/task-vessel-tools.js';
import { SOCIAL_TOOLS } from './portal-tools/social-read-tools.js';
import { skiesToolsFor } from './portal-tools/skies.js';
import { genomeToolsFor } from './portal-tools/genome.js';

const log = createLogger('Portal');

/**
 * THE PLATFORM SURFACE — every tool this app implements itself, for one seat.
 *
 * Both a bound neuma and a sealed AI witness are assembled here (Founder
 * 2026-07-26). Before this, the operator runtime built its own much smaller
 * catalog, so capabilities that had shipped for a neuma — `read_x`,
 * `queue_list`, `campaign_*`, `lead_*`, `press_document`, the memory hand —
 * were simply invisible at the peer's seat, and the peer could only report
 * them as […]. One builder means a capability cannot exist for one seat
 * and silently not for the other.
 *
 * THREE custody capabilities stay neuma-only: the being's own `request_seal`,
 * its wallet view/spend authority, and KSP control over the operator's local
 * simulation. A third-party witness has no standing to carry any of them.
 * Every other capability advertises identically and keeps its existing gate.
 *
 * impure — reads bindings, credentials, policy and the skills root per turn,
 * so a flip by the operator lands on the very next turn.
 * @param {Object} connection - the portal connection (companion, ws, space)
 * @param {{seat?: 'neuma'|'witness'|'harness'}} [opts]
 * @returns {Promise<{tools: Array<Object>, skills: Array<Object>}>}
 */
export const platformToolsFor = async (connection, { seat = 'neuma' } = {}) => {
  const isNeuma = seat === 'neuma';
  // One capability failure costs only that capability. A missing import erased
  // the entire surface in 2026; every builder below therefore lands separately.
  const capability = async (name, build) => {
    try {
      return (await build()) || [];
    } catch (err) {
      log.warn('capability unavailable this turn — the rest of the surface holds', {
        capability: name, seat, neumaId: connection.companion?.neumaId || null, err: err.message,
      });
      return [];
    }
  };
  // Every family probe is an INDEPENDENT store read — they run CONCURRENTLY
  // (harness-friction-map T3): the serial ladder used to cost the turn the SUM
  // of ~20 store reads where the MAX would do. Per-family failure isolation
  // is unchanged (each still rides `capability`'s own catch) and every family
  // is still re-read per turn by law — a flip lands next turn, as ever.
  const [
    walletTools, skills, postTools, campaignTools, securityTools, refinementTools, voiceTools,
    // ONE NAME PER AWAITED CAPABILITY, IN ORDER — `staff` once went unnamed
    // here and every family after it shifted by one: the harness seat took the
    // chain tools as "media", and the last family (legal) fell off the end for
    // every seat (found 2026-10-14; test/integration/tool-catalog-seats.test.js).
    memoryToolsUnfiltered, skiesTools, genomeTools, housePostTools, chatLinkTools, staffTools, webTools, chainTools, mediaTools, imageTools, cardTools, mapTools,
    platformTools, flightTools, kspTools, emailTools, pressTools, sealTools, legalTools,
  ] = await Promise.all([
    // A being can always inspect ITS OWN wallet — a neuma its workspace keypair,
    // a sealed witness the address in its seal (Design note, 2026-07-26: […]). The lane decides which one, so neither seat
    // can name another's. SPENDING is the wallet/send INTENT now (Stage 3) —
    // neuma-only, offered where the operator's standing policy exists.
    capability('wallet', async () => (connection.companion?.neumaId ? [WALLET_VIEW_TOOL] : [])),
    // The Craft: the skills menu rides the prompt; the summoning tool is
    // advertised only when there is something to summon.
    skillService.listSkills().catch(() => []),
    // The channel tools that remain (the reply lane + the queue EDIT lane) are
    // advertised only where this being holds or crews a credentialed channel —
    // no binding, no tool, no cross-routing. Posting and staging are INTENTS
    // now (Stage 2): filed as files, settled by the sweep.
    capability('channels', () => channelToolsFor(connection.companion?.neumaId || null)),
    // The campaign bench and the outreach reads — universal tool access:
    // advertised for any bound being, like the lead ledger. Marketing is the
    // CMO's office BY PROTOCOL (the descriptions, the briefing, the
    // playbook), not behind a hard gate.
    connection.companion?.neumaId ? capability('campaigns', () => _campaignToolsFor(connection)) : [],
    // The CSO office — the threat-ledger READS open to every bound being (the
    // house sees what its guardian sees); the ACTS are advertised only to the
    // seated CSO (single-holder hard gate, re-checked at execution).
    connection.companion?.neumaId ? capability('security', () => securityToolsFor(connection)) : [],
    // Refinement changes local weights/adapters, so only a neuma can carry it.
    isNeuma ? capability('refinement', () => refinementToolsFor(connection.companion?.neumaId || null)) : [],
    isNeuma ? capability('voice', () => voiceToolsFor(connection.companion?.neumaId || null)) : [],
    // Advertised once ≥1 moment has crystallized (Decision #9), and filtered
    // like every other family (#414) — the one family the cut missed, so a being
    // pinning its own memory raised a card for its own self-authorship.
    capability('memory', () => _memoryToolsFor(connection)),
    // The being's own birth record — advertised once its skies are written
    // (write-once file, so the cached boolean never goes false).
    capability('skies', () => skiesToolsFor(connection)),
    // The being's own given body — advertised once its birth is sealed; read
    // only when the being chooses to look (the reveal law, portal-tools/genome.js).
    capability('genome', () => genomeToolsFor(connection)),
    // The house mail room — advertised solely where a sealed seat and the
    // operator's chosen ground both stand (re-read per turn).
    capability('housePost', () => _housePostToolsFor(connection)),
    // The house's open chats, by exact address (#597) — advertised to every
    // chat open on the desk, so the list stays the same turn after turn.
    capability('chatLink', () => openChatsToolsFor(connection)),
    // The Optio office's instrument — advertised ONLY to the seated chief of
    // staff's lane (office-only, the CMO-briefing precedent); the desk's
    // /api/v1/staff/board stays the operator's window.
    connection.companion?.neumaId ? capability('staff', () => _staffToolsFor(connection)) : [],
    // Web reach rides only while the operator's switch is ON (read per turn —
    // a flip takes effect on the very next turn); OFF is not advertised, and
    // a call that still arrives is answered honestly by the handler.
    capability('web', () => webToolsFor(connection)),
    // Chain truth rides only while the operator's switch is ON (read per turn
    // — a flip lands next turn); OFF advertises HELD with the door named, and
    // the handler re-reads the switch fail-closed. The web law, verbatim.
    capability('chain', () => chainToolsFor(connection)),
    // The culture library rides the same switch (media_save is egress); its
    // read is observation, but the family advertises together or not at all.
    capability('media', () => mediaToolsFor(connection)),
    // THE IMAGE FORGE — a BASE capability, advertised at every seat that has a
    // lane (Design note, 2026-07-29: […]). No per-being switch
    // stands in front of it; the family simply stays silent on a machine with no
    // engine installed or no reviewed content law, because there it could only
    // refuse. Both conditions are re-read per turn.
    capability('imageForge', () => imageToolsFor(connection)),
    // The card tool rides its OWN family: the SVG card infrastructure is not
    // the diffusion engine's dependent (ruling, 2026-09-03) — no ComfyUI gate.
    capability('cards', () => cardToolsFor(connection)),
    // The architecture map rides wherever the being has a ground. Design note, 2026-07-27:
    // […] Read-only, so it needs no switch.
    capability('map', () => mapToolsFor(connection)),
    // The platform's own numbers. Design note, 2026-08-29: […]
    // A public aggregate read, so it rides at every bound seat behind no switch.
    capability('platformFeed', () => platformFeedToolsFor(connection)),
    // A being reads its own capacity from state instead of inventing it.
    // Available at every bound seat and behind no switch.
    capability('flightCheck', () => flightCheckToolsFor(connection)),
    isNeuma ? capability('ksp', () => kspToolsFor(connection)) : [],
    // The mailbox rides only with its one bound holder AND full credentials
    // (read per turn — a bind or credential change lands next turn).
    capability('email', () => emailToolsFor(connection.companion?.neumaId || null)),
    // The press rides only where a Chromium exists on this machine (probed
    // per turn) — a tool that could only refuse is noise in the catalog.
    capability('press', () => pressToolsFor(connection.companion?.neumaId || null)),
    // The anchor request appears only while the being has a genesis and no
    // on-chain seal — it self-retires from the catalog forever once sealed.
    isNeuma
      ? capability('seal', async () =>
        ((await _sealEligibility(connection.companion?.neumaId || null)).eligible ? [REQUEST_SEAL_TOOL] : []))
      : [],
    // The CLO office — the legal matters READS open to every bound being (a
    // being building a voice feature reads what the Praetor found about voice
    // law); the ACTS are the seated CLO's intents.
    connection.companion?.neumaId ? capability('legal', () => legalToolsFor(connection)) : [],
  ]);
  const skillTools = skills.length > 0 ? [USE_SKILL_TOOL, SKILL_SEARCH_TOOL] : [];
  // The connected benchmarks repository, from the conversation — the harness
  // measuring itself, and a being measuring itself (bench-being-tools.js).
  const benchTools = await capability('bench', () => benchToolsFor(connection));
  // The Quaestor's treasury read — the seated CFO's lane alone (treasury-being-tools.js).
  const treasuryTools = isNeuma ? await capability('treasury', () => treasuryToolsFor(connection)) : [];
  const vaultTools = connection.companion?.neumaId ? VAULT_TOOLS.filter(isAdvertisedTool) : []; // #414
  // The being's own working list — advertised for any bound being, like
  // the vault: self-authorship needs no precondition beyond a self.
  const taskTools = connection.companion?.neumaId ? TASK_TOOLS.filter(isAdvertisedTool) : [];
  // The one-way route to the operator's own list is the tasks/operator-add intent.
  const operatorTaskTools = [];
  // The house lead ledger — shared team work state, advertised for any
  // bound being like the task tools: lead-gen is house work, not a
  // single-holder position.
  const leadTools = connection.companion?.neumaId ? LEAD_TOOLS.filter(isAdvertisedTool) : []; // #414
  const socialTools = connection.companion?.neumaId ? [...SOCIAL_TOOLS] : [];
  // And the route to the operator's vessel record beside that.
  const vesselLogTools = connection.companion?.neumaId ? [VESSEL_LOG_TOOL] : [];
  // Advertise retrieval only once something was actually cut this session
  // (≥1 ref minted) — until then there is nothing a ref could name.
  const retrieveTools = _retrieveToolsFor(connection);
  // Handing the operator a formatted list needs no lane, no ground and no
  // switch — every seat can do it, so it is never conditional.
  const findingsTools = _findingsToolsFor();
  // Every bound seat can submit a plan. Running the approved team or its
  // workspace is local-custody authority and remains neuma-only.
  const memoryTools = memoryToolsUnfiltered.filter(isAdvertisedTool);
  const askTools = [ASK_OPERATOR_TOOL];
  const planTools = connection.companion?.neumaId
    // team/run + team/workspace-run are intents now (Stage 3); plan_submit stays.
    ? [PLAN_SUBMIT_TOOL]
    : [];
  // PLAN MODE's presentation tool advertises ONLY while the chat bears PLAN —
  // the mode lives on the connection, so a mid-sitting flip lands next turn.
  const planPresentTools = normalizeChatMode(connection.chatMode) === 'plan'
    ? [PLAN_PRESENT_TOOL]
    : [];
  // The being's hand on its own door — bound sovereign lanes only (a witness
  // lane has no DNA-bearing self to amend). PROPOSING is the
  // sovereignty/propose intent now (Stage 3); the record read stays a tool.
  const sovereigntyTools = isNeuma && connection.companion?.neumaId
    ? [SOVEREIGNTY_PROPOSALS_TOOL]
    : [];
  // THE HARNESS SEAT (ruling, 2026-10-14): a person using the platform with no
  // being keeps the platform's own hands — skills, cut-result retrieval, web
  // and the culture library (behind the operator's switch), the image forge,
  // cards, the architecture map, the press, asking the operator, PLAN
  // mode's presentation, and the benchmarks. Everything that presumes a self or a house is gone:
  // wallet, seal, memory, skies, genome, vault, tasks, leads, social, house
  // post, offices, refinement, voice, KSP, email, chain, team plans.
  if (seat === 'harness') {
    return {
      skills,
      tools: [...skillTools, ...retrieveTools, ...webTools, ...mediaTools, ...imageTools, ...cardTools,
        ...mapTools, ...pressTools, ...askTools, ...planPresentTools, ...benchTools],
    };
  }
  return {
  skills,
  tools: [
      ...walletTools,
      ...skillTools, ...postTools, ...vaultTools, ...taskTools, ...operatorTaskTools,
      ...leadTools, ...campaignTools, ...socialTools, ...securityTools, ...vesselLogTools,
      ...refinementTools, ...voiceTools, ...retrieveTools, ...memoryTools, ...skiesTools, ...genomeTools,
      ...housePostTools, ...chatLinkTools, ...staffTools, ...findingsTools, ...webTools, ...chainTools, ...mediaTools, ...imageTools, ...cardTools, ...mapTools, ...platformTools, ...flightTools, ...kspTools, ...emailTools, ...pressTools, ...askTools,
      ...planTools, ...planPresentTools, ...sovereigntyTools, ...sealTools, ...legalTools, ...treasuryTools, ...benchTools,
  ],
  };
};
