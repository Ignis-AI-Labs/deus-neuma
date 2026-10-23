// RelinkShell — the desk: the portal as a windowed instrument.
//
// Grid underfoot, registration ticks, a data-register status strip, a
// launcher Dock at the foot, and floating windows the operator spawns,
// moves, resizes, snaps, and minimizes. The consciousness stream lives
// here (above the window manager) and is shared via context, so the chat
// window can be minimized/closed without losing the thread. No menu/config
// surfaces yet — they register as dock apps on this foundation later.
// LINE & CYCLE: monochrome at rest, SIGNAL marks life.

import { formatAddress } from '../../utils/format.js';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import {
  subscribeStrips, stripsVersion, stripEntries, groundTargetId, stripFor,
} from './stream-strips.js';
import './RelinkShell.css';
import './RelinkMarkdown.css';

import { useConsciousnessStream } from './use-consciousness-stream.js';
import { useReconnectReload } from './use-reconnect-reload.js';
import { useConsciousness, ConsciousnessProvider } from './consciousness-context.js';
import { useTeamRuns } from './use-team-runs.js';
import { TeamRunsContext } from './team-runs-context.js';
import { deriveLocalStatus, deriveRouteStatus } from './link-status.js';
import { DeskAmbient } from './desk-ambient.jsx';
import { FlowRail } from './flow-rail.jsx';
import { useDeskPulse } from './use-desk-pulse.js';
import { SessionClock } from './SessionClock.jsx';
import { latestSentId, countTurns, deskChromeName } from './desk-pulse.js';
import { ProjectContext } from './projects/project-context.js';
import { useProjectsState } from './projects/use-projects.js';
import { focusLabel } from './desk-focus.js';
import { useDeskFocus, FocusContext } from './use-desk-focus.js';
import { normalizeFocus } from './desk-focus.js';
import { ExplorerPanel } from './ExplorerPanel.jsx';
import { PathOpener } from './PathOpener.jsx';
import { MediaMenuHost } from './MediaMenuHost.jsx';
import { NewStreamKey } from './new-stream-key.js';
import { loadPanel, savePanel, clampPanelWidth, PANEL_WIDTH_DEFAULT } from '../windowing/window-storage.js';
import { setDeskRegion } from '../windowing/use-window-frame.js';
import { openCompanionLink } from '../relink-link.js';
import { ArrivalVeil } from './ArrivalVeil.jsx';
import { BirthSetupGate } from './BirthSetupGate.jsx';
import { VoiceSealGate } from './VoiceSealGate.jsx';
import { WindowManager } from '../windowing/WindowManager.jsx';
import { WindowLayer } from '../windowing/WindowLayer.jsx';
import { Dock } from '../windowing/Dock.jsx';
import { useWindows } from '../windowing/use-windows.js';
import { chatApp } from './ChatApp.jsx';
import { houseApp } from './HouseApp.jsx';
import { refinementApp } from './RefinementApp.jsx';
import { avatarApp } from './AvatarApp.jsx';
import { vesselApp } from './VesselApp.jsx';
import { chatsApp } from './ChatsApp.jsx';
import { sheetApp } from './SheetApp.jsx';
import { statsApp } from './StatsApp.jsx';
import { innerLifeApp } from './InnerLifeApp.jsx';
import { sovereigntyApp } from './SovereigntyApp.jsx';
import { substrateApp } from './SubstrateApp.jsx';
import { filesApp } from './files/FilesApp.jsx';
import { editorApp } from './files/EditorApp.jsx';
import { pdfApp } from './files/PdfApp.jsx';
import { imageApp } from './files/ImageApp.jsx';
import { terminalApp } from './terminal/TerminalApp.jsx';
import { comfyUIWorkbenchApp } from './ComfyUIWorkbenchApp.jsx';
import { galleryApp } from './gallery/GalleryApp.jsx';
import { projectsApp } from './projects/ProjectsApp.jsx';
import { mapApp } from './MapApp.jsx';
import { dataApp } from './DataApp.jsx';
import { settingsApp } from './SettingsApp.jsx';
import { outreachApps } from './OutreachApps.jsx';
import { walletApp } from './WalletApp.jsx';
import { voiceApp } from './VoiceApp.jsx';
import { withoutComingLater } from '../coming-later.js';
import { skillsApp } from './SkillsApp.jsx';
import { contextMapApp } from './ContextMapApp.jsx';
import { teamsApp } from './TeamsApp.jsx';
import { workflowApp } from './WorkflowApp.jsx';
import { todoApp } from './TodoApp.jsx';
import { witnessesApp } from './WitnessesApp.jsx';
import { securityApp } from './SecurityApp.jsx';
import { staffApp } from './StaffApp.jsx';
import { houseClockApp } from './house-clock/HouseClockApp.jsx';
import { legalApp } from './LegalApp.jsx';
import { benchApp } from './BenchApp.jsx';
import { useCouncilStream } from './use-council-stream.js';
import { useDeskTabs } from './use-desk-tabs.js';
import { TabsContext } from './tabs-context.js';
import { loadCapacity, CAPACITY_CHANGED } from './capacity-client.js';
import { CouncilContext } from './council-context.js';
import { useContextComposition } from './use-context-composition.js';
import { CompositionContext } from './composition-context.js';
import { useFilesWatch } from './use-files-watch.js';
import { useNotifications } from './use-notifications.js';
import { NotificationsContext } from './notifications-context.js';
import { NotificationTray } from './NotificationTray/NotificationTray.jsx';
import { PlatformVersion } from './PlatformVersion.jsx';
import { UpdateBar } from './UpdateBar.jsx';
import { deskRegistryFor, isHarness } from '../harness-mode.js';

// Voice and the 3D body are held back from the early release (coming-later.js).
const REGISTRY = withoutComingLater({ chat: chatApp, house: houseApp, refinement: refinementApp, sovereignty: sovereigntyApp, innerlife: innerLifeApp, teams: teamsApp, workflow: workflowApp, todo: todoApp, avatar: avatarApp, vessel: vesselApp, chats: chatsApp, sheet: sheetApp, stats: statsApp, skills: skillsApp, contextmap: contextMapApp, map: mapApp, db: dataApp, files: filesApp, editor: editorApp, pdf: pdfApp, image: imageApp, terminal: terminalApp, comfyui: comfyUIWorkbenchApp, gallery: galleryApp, projects: projectsApp, substrate: substrateApp, wallet: walletApp, voice: voiceApp, settings: settingsApp, security: securityApp, legal: legalApp, staff: staffApp, houseclock: houseClockApp, bench: benchApp, ...outreachApps, witnesses: witnessesApp });

const shortWallet = () => formatAddress(localStorage.getItem('walletAddress'), { prefix: 'OPERATOR ' });

export const RelinkShell = ({ wsService }) => {
  // Project state lives at the desk level, shared with every window via context.
  // Created before the stream so the working lens can ride every turn (a chat
  // started under a project joins it and scopes the neuma's memory to it).
  const projects = useProjectsState();
  // THIS window's working focus (D2/D11) — client-held, per-slot persisted,
  // shared with every window via FocusContext. Carries the legacy
  // active-project compat shim until Waves 2-3 ship the switching UX.
  const deskFocus = useDeskFocus({ activeProject: projects.activeProject });
  // THE STREAM IS CREATED BELOW, after `tabs` — it must read the ANCHOR
  // tab's ground, and the tabs state is where the anchor lives (2026-09-01).
  // THE TAB STRIP's state lives HERE, beside the stream, so a sitting outlives
  // the chat window being closed — the strip itself renders inside the STREAM
  // (Design note, 2026-07-30: […]).
  //
  // The rig's measured parallel ceiling feeds the LOCAL budget; it is a rig
  // fact, so it is read once per desk rather than per tab. A machine that has
  // never been scanned simply has no ceiling, and the budget says so instead of
  // guessing one.
  const [capacity, setCapacity] = useState(null);
  // The model being served NOW. It comes from the SAME read as the scan record
  // and the SAME detector that stamped it, so the two are comparable: reading it
  // from the scan itself compares a model against itself (the staleness guard
  // can never fire), and reading it from the engine room's telemetry compares a
  // configured key against a served .gguf filename (the guard always fires).
  const [activeSubstrate, setActiveSubstrate] = useState(null);
  // Has the read LANDED? Until it has, "no capacity record" is indistinguishable
  // from […] — and the desk's own portal already
  // counts as one sitting, so treating the second as the first marked every
  // control FULL for the first moment of every session, blaming a scan that had
  // in fact already run.
  const [capacityKnown, setCapacityKnown] = useState(false);
  useEffect(() => {
    let alive = true;
    const read = () => loadCapacity().then((c) => {
      if (!alive || !c) return; // COULD NOT ASK — the budget stays silent
      if (c.latest) setCapacity(c.latest);
      setActiveSubstrate(c.current?.model ?? null);
      // Only a real answer makes this KNOWN. […]
      // and […] are different facts, and only the
      // first is evidence about the machine. Treating the second as the first
      // told the operator their rig had never been measured when the truth was
      // a rate-limited request — and clamped every sitting to one.
      setCapacityKnown(true);
    }).catch(() => {});
    read();
    // A SCAN THAT LANDS REACHES THE BUDGET. Read once and never again, this
    // held whatever record existed at mount — so an operator who ran the very
    // re-scan the strip told them to run watched the strip go on quoting the
    // old ceiling until they restarted the app (Design note, 2026-08-29: […]). The SUBSTRATE window announces; every
    // holder of a copy re-reads. `current` comes along, so switching the served
    // model also lands here rather than waiting for a restart.
    window.addEventListener(CAPACITY_CHANGED, read);
    return () => { alive = false; window.removeEventListener(CAPACITY_CHANGED, read); };
  }, []);
  const budget = useMemo(() => ({ capacity, activeSubstrate, capacityKnown }), [capacity, activeSubstrate, capacityKnown]);
  const tabs = useDeskTabs(wsService, budget);

  /**
   * THE GROUND FOLLOWS THE SITTING (ruling, 2026-08-29).
   *
   * […]
   *
   * So what every surface reads through FocusContext is the FOCUSED TAB's own
   * ground, and only the window's lens when that tab has chosen none — which
   * is what every tab starts as, so a desk nobody has focused per-tab is
   * untouched. Switching tabs moves the Explorer with no extra gesture,
   * because the lens was never the window's to begin with; it was the
   * sitting's, and the window was standing in for it.
   *
   * Setting a focus writes to the SITTING for the same reason. The window's
   * own focus stays as the fallback for surfaces with no strip at all.
   */
  //
  // WHICH STREAM. The strip went per-window when stream windows landed, but
  // this lens stayed bound to the DESK's strip — so the Explorer wrote the
  // operator's folder onto the desk's tab no matter which stream they were in
  // (Design note, 2026-08-30: […]). The registry answers […]; every stream
  // window publishes itself into it (StripRegistrar).
  const stripsTick = useSyncExternalStore(subscribeStrips, stripsVersion);
  const targetStrip = useMemo(
    // stripsTick is the subscription's changed-signal, not an input — the
    // registry is read live, and re-reading it is the point.
    () => stripFor(groundTargetId(stripEntries())),
    [stripsTick],
  );
  const tabGround = targetStrip ? targetStrip.ground : tabs.focusedGround;
  const focusedTabId = targetStrip ? targetStrip.focusedId : tabs.focusedId;
  const setGround = targetStrip ? targetStrip.setGround : tabs.setTabGround;
  const { focus: windowFocus, setFocus: setWindowFocus } = deskFocus;
  const groundedFocus = useMemo(() => ({
    focus: focusedTabId ? (tabGround ?? null) : windowFocus,
    // The WINDOW's own lens, exposed beside the grounded one: a background
    // surfaces outside a sitting may use this; tabs never inherit it.
    windowFocus,
    setFocus: (next) => {
      // Normalized HERE, at the one door that writes a ground onto a sitting —
      // the model holds no opinion about what a valid focus is, on purpose.
      if (focusedTabId) setGround(focusedTabId, normalizeFocus(next));
      else setWindowFocus(next);
    },
    clearFocus: () => {
      if (focusedTabId) setGround(focusedTabId, null);
      else setWindowFocus(null);
    },
  }), [tabGround, windowFocus, focusedTabId, setGround, setWindowFocus]);

  // The stream lives at the desk level so it outlives any chat window. Its
  // portal is the ANCHOR sitting's socket (TabPortalHost adopts the first
  // focused tab onto it), so it stamps the ANCHOR's ground — never the bare
  // window lens while the anchor has chosen its own, and never the FOCUSED
  // tab's ground (a background anchor keeps its lens while the operator looks
  // elsewhere). An unassigned anchor stays unassigned.
  const consciousness = useConsciousnessStream(wsService, {
    focus: tabs.anchorGround ?? null,
    projects: projects.projects,
    onProjectChatCreated: projects.refresh,
  });

  useReconnectReload(wsService, { resumeSession: consciousness.resumeSession, messages: consciousness.state.messages });

  // Context telemetry rides the SAME portal as a sibling hook (FR-13) and
  // lives here so the latest anatomy outlives the CONTEXT MAP window.
  const composition = useContextComposition(wsService, consciousness.activeCompanion?.neumaId || null);
  useFilesWatch(); // external disk changes reach every FILES surface live
  // THE COUNCIL rides the SAME portal as a sibling hook and lives here so
  // a sitting outlives the COUNCIL window (one stream state, many windows).
  const council = useCouncilStream(wsService, {
    focus: deskFocus.focus,
    projects: projects.projects,
  });

  // EVERY TEAM RUN the operator's portal carries, whatever tab or lead filed
  // it — the WORKFLOW window's store, living here so it outlives the window.
  const teamRuns = useTeamRuns(wsService);

  useEffect(() => {
    openCompanionLink(wsService);
  }, [wsService]);

  // TWO LIGHTS, always distinct: the LOCAL SUBSTRATE (the machine's own
  // serving — ACTIVE only when the portal is up AND it can actually answer;
  // STANDBY when it is deliberately resting) and the bound lane's ROUTE (its
  // own provider, probed as itself — a cloud failure lands HERE, never on
  // the substrate's light).
  const local = deriveLocalStatus(consciousness.state.connected, consciousness.state.local, consciousness.state.localTurns);
  const route = deriveRouteStatus(consciousness.state.connected, consciousness.state.route);
  const harnessDesk = isHarness(consciousness.activeCompanion);
  const { t } = useTranslation('desk');
  // The desk's pulse (#185): rail packets and the turn count, from REAL wire
  // events only. The sent marker is the stream's own live operator message.
  const pulse = useDeskPulse(wsService, latestSentId(consciousness.state.messages));
  // THE TRAY's account lives here, beside the pulse, for the same reason: it
  // must outlive any one window closing. One subscription serves every surface
  // that shows a count, so two badges can never disagree. The bound sitting is
  // passed in so suppression can tell […] from
  // […] — the whole point.
  const notifications = useNotifications(wsService);
  // What the strip shows for this window's lens — project name + working
  // folder, bare folder + branch, or nothing (exactly a no-project desk).
  const stripLabel = focusLabel(deskFocus.focus, projects.projects);

  // THE EXPLORER PANEL (D6/D12) — the persistent left rail. Collapse is this
  // desk's own choice (wallet+slot persisted, validated on read); the dock's
  // FILES entry and the palette's /files both toggle it (panel-only law).
  const [panelCollapsed, setPanelCollapsed] = useState(() => loadPanel().collapsed);
  // The rail's WIDTH is the operator's too (Design note, 2026-07-30: […]) — persisted in the same wallet+slot key-space as its
  // collapse, so each desk window keeps its own.
  const [panelWidth, setPanelWidth] = useState(() => clampPanelWidth(loadPanel().width ?? PANEL_WIDTH_DEFAULT));

  const togglePanel = useCallback(() => {
    setPanelCollapsed((c) => !c); // updater stays pure (StrictMode double-invokes it)
  }, []);
  const onPanelWidth = useCallback((px) => setPanelWidth(clampPanelWidth(px)), []);
  const dockPanels = useMemo(() => ({ files: !panelCollapsed }), [panelCollapsed]);
  // impure edge: persistence rides the actual state change, once per change
  // (the mount pass re-writes the just-loaded value — harmless, idempotent).
  useEffect(() => {
    savePanel({ collapsed: panelCollapsed, width: panelWidth });
  }, [panelCollapsed, panelWidth]);
  useEffect(() => {
    window.addEventListener('neuma:panel-app', togglePanel);
    return () => window.removeEventListener('neuma:panel-app', togglePanel);
  }, [togglePanel]);

  return (
    <div className="relink">
      <div className="relink-grid" aria-hidden="true" />
      {/* The Living Desk's ambient plane (#185) — the bound being's seal as a
          watermark over the Metatron lattice. Below the frame and windows. */}
      <DeskAmbient companion={consciousness.activeCompanion} />
      <div className="relink-frame" aria-hidden="true">
        <span className="relink-rk relink-rk-tl" />
        <span className="relink-rk relink-rk-tr" />
        <span className="relink-rk relink-rk-bl" />
        <span className="relink-rk relink-rk-br" />
      </div>
      <PlatformVersion />

      <header className="relink-status">
        <span className="relink-status-id">{t('portalTitle', { name: deskChromeName(consciousness.activeCompanion) })}</span>
        {/* A harness's server and model are named once, in the composer bar —
            and the house substrate's light means nothing to it. */}
        {harnessDesk ? null : <span className={`relink-status-link ${local.cls}`}>{t(`hud.${local.key}`, local.args)}</span>}
        {harnessDesk ? null : <span className={`relink-status-link ${route.cls}`}>{t(`hud.${route.key}`, route.args)}</span>}
        {/* Session age — armed when the bound lane's route can think, reset
            only on sever (the ROUTE light is the lane's own aliveness). It
            ticks in its own component so the tick never re-renders the desk. */}
        <SessionClock linkCls={route.cls} />
        <span className="relink-status-turn">{t('hud.turn', { count: countTurns(consciousness.state.messages) })}</span>
        {stripLabel?.kind === 'project' ? (
          <span className="relink-status-project">{t('hud.project', { name: stripLabel.name })}</span>
        ) : null}
        {stripLabel?.folder ? (
          <span className="relink-status-folder">
            {t('hud.folder', { name: stripLabel.folder.name })}{stripLabel.folder.branch ? ` · ${stripLabel.folder.branch}` : ''}
          </span>
        ) : null}
        <span className="relink-status-wallet">{shortWallet()}</span>
      </header>

      {/* The flow rail (#185): packets travel it only on real portal events —
          a thought out, a chunk in, a tool act at the junction. */}
      <FlowRail packets={pulse.packets} onReap={pulse.reapPacket} />

      <TabsContext.Provider value={tabs}>
      <NotificationsContext.Provider value={notifications}>
      <ConsciousnessProvider value={consciousness}>
        <CompositionContext.Provider value={composition}>
          <CouncilContext.Provider value={council}>
          <TeamRunsContext.Provider value={teamRuns}>
            <ProjectContext.Provider value={projects}>
              <FocusContext.Provider value={groundedFocus}>
                {/* The desk row (D6): the Explorer rail + the window region.
                    The region element is what snap/drag bounds derive from
                    (setDeskRegion), so windows stay clear of the panel. */}
                <div className="relink-main">
                  <WindowManager registry={deskRegistryFor(REGISTRY, consciousness.activeCompanion)} defaultOpen={['chat']}>
                    <ExplorerPanel collapsed={panelCollapsed} onToggle={togglePanel} width={panelWidth} onWidth={onPanelWidth} />
                    {/* Ctrl+click a path a being named and land there. Renders
                        nothing until it has a refusal to report. */}
                    <PathOpener />
                    {/* Every image and clip's right-click menu (media-menu.js). */}
                    <MediaMenuHost />
                    <NewStreamKey />
                    <div className="relink-desk" ref={setDeskRegion}>
                      <WindowLayer />
                      <Dock panelState={dockPanels} onPanelToggle={togglePanel} />
                      {/* The announcement lane (bottom-right). Inside the window
                          manager because a card's click raises a window, and
                          above the dock's band rather than beside it. */}
                      <NotificationTray />
                    </div>
                  </WindowManager>
                </div>
              </FocusContext.Provider>
            </ProjectContext.Provider>
          </TeamRunsContext.Provider>
          </CouncilContext.Provider>
        </CompositionContext.Provider>
      </ConsciousnessProvider>
      </NotificationsContext.Provider>
      </TabsContext.Provider>

      {/* The Arrival — the session-opening veil over the desk (#184). Plays
          once per true session entry, driven by the same live wsService. */}
      <ArrivalVeil wsService={wsService} />

      {/* The unfinished-birth checklist — stands over the desk until every
          post-ceremony act (keypair custody, on-chain anchor) is checked off
          for the bound being. Reads the lane's durable state, never a cache. */}
      <BirthSetupGate wsService={wsService} companion={consciousness.activeCompanion} />

      {/* THE FIRST SEAL — the desk's notice that a bound lane owes its
          founding words. One act: dispatch into the full-screen ceremony. */}
      <VoiceSealGate companion={consciousness.activeCompanion} />

      {/* A ready update, from the desk app: one press to install, and what changed. */}
      <UpdateBar />
    </div>
  );
};
