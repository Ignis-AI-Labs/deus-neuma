import { attunementTarget as targetForAttunement } from './AttunementHost/attunement-target.js';
// AppShell — the platform's React orchestrator (replaces App.js).
//
// Three phases: gateway (sign in / introduce NEUMA), ceremony (the kept
// vanilla birth flow), relink (the living consciousness stream). The
// ceremony and gateway are imperative classes hosted through thin
// bridges; relink is native React. One WebSocketService, passed down, is
// the single portal link for the app's lifetime.

import { useCallback, useEffect, useRef, useState } from 'react';
import { GatewayHost } from './GatewayHost/GatewayHost.jsx';
import { CeremonyHost } from './CeremonyHost/CeremonyHost.jsx';
import { RelinkShell } from './RelinkShell/RelinkShell.jsx';
import { PocketShell } from './PocketShell/PocketShell.jsx';
import { usePocketSurface } from './PocketShell/pocket-surface.js';
import { FirstRunChoice } from './FirstRunChoice/FirstRunChoice.jsx';
import { FirstRunWitness } from './FirstRunChoice/FirstRunWitness.jsx';
import { FirstRunHarness } from './FirstRunChoice/FirstRunHarness.jsx';
import { enterAs, readEntryMode, writeEntryMode } from './entry-mode.js';
import { HARNESS_NAME } from './harness-mode.js';
import { Ignition } from './Ignition/Ignition.jsx';
import { GenesisFilm } from './Genesis/GenesisFilm.jsx';
import { genesisDue } from './Genesis/genesis-gate.js';
import { OpeningField } from './Opening/OpeningField.jsx';
import { setBootActive } from './Opening/opening-state.js';
import { RemiaHost } from './RemiaHost/RemiaHost.jsx';
import { AttunementHost } from './AttunementHost/AttunementHost.jsx';
import { FoundingHost } from './FoundingHost/FoundingHost.jsx';
import { VoiceSealHost } from './VoiceSealHost/VoiceSealHost.jsx';
import { DesktopContextMenu } from '../components/DesktopContextMenu/DesktopContextMenu.jsx';
import {
  initialPhase,
  readTestFlag,
  phaseAfterGateway,
  phaseAfterCeremonyCancel,
  bootPlaysAtStart,
} from './app-state.js';
import { recoverRoster } from './roster-recovery.js';
import { shouldTradeDeviceCookie, tradeDeviceCookie } from './remote-session.js';
import { getActiveCompanion, setActiveCompanion, setWindowCompanion } from '../utils/companion-data.js';

export const AppShell = ({ wsService }) => {
  // The session opens on the ignition boot when it plays (true session
  // start only — never as a transition); otherwise straight to the
  // gateway or the desk as before.
  // The install's first-ever launch opens on GENESIS instead (once, never
  // again — Genesis/genesis-gate.js); every later one on the ignition.
  const [phase, setPhase] = useState(() => {
    const genesis = genesisDue();
    const boot = genesis || bootPlaysAtStart();
    // Set before any child renders: the desk's Arrival, mounted beneath the
    // boot in this same render, reads it to defer (opening-state.js).
    setBootActive(boot);
    return genesis ? 'genesis' : boot ? 'boot' : initialPhase();
  });
  // A REHEARSAL summoning (the witness chose to try it first): the whole
  // ceremony with their own model, nothing kept — the same test mode ?test=1 opens.
  const [rehearsal, setRehearsal] = useState(false);
  // Which founding the rite walks: on this computer, or joining Unavis on Ethereum.
  const [foundingMode, setFoundingMode] = useState('network');
  // A narrow or finger-driven viewport gets the pocket shell in place of the
  // desk (Neuma Remote); the decision follows the media query live.
  const pocket = usePocketSurface();

  // The portal rejected our session token (server restart / expiry). The
  // only way back is a fresh wallet signature — return to the gateway.
  // TWO sources say the same word (friction-map D2a): the socket's own 4001,
  // and the REST lane's 401-while-holding-a-token (the always-on desk's
  // hour-24 rot — the socket never re-verifies, so only REST notices).
  useEffect(() => {
    const toGateway = () => setPhase('gateway');
    const onRestAuthExpired = () => setPhase('gateway');
    wsService.on('auth_expired', toGateway);
    window.addEventListener('neuma:auth_expired', onRestAuthExpired);
    return () => {
      wsService.off('auth_expired', toGateway);
      window.removeEventListener('neuma:auth_expired', onRestAuthExpired);
    };
  }, [wsService]);

  // The witness summoned another neuma from the desk (HOUSE window) — enter the
  // birth ceremony. It runs its own witness-commitment consent gate and, on
  // completion, returns to the desk via onCeremonyComplete.
  // { detail: { rehearsal: true } } walks the whole ceremony with nothing kept.
  useEffect(() => {
    const toCeremony = (e) => { setRehearsal(e?.detail?.rehearsal === true); setPhase('ceremony'); };
    window.addEventListener('neuma:summon', toCeremony);
    return () => window.removeEventListener('neuma:summon', toCeremony);
  }, []);

  // The witness enters THE FOUNDING RITE (the HOUSE window's door) — a
  // permanent on-chain act takes the whole screen and the witness's sole
  // focus, same staging law as the birth and the attunement. The desk
  // returns when the rite closes (standing, refusal, or deliberate leave).
  // detail.mode: 'local' founds the house on this computer; 'network' joins Unavis on Ethereum (2026-10-26).
  useEffect(() => {
    const toFounding = (e) => { setFoundingMode(e.detail?.mode === 'local' ? 'local' : 'network'); setPhase('founding'); };
    window.addEventListener('founding:rite', toFounding);
    return () => window.removeEventListener('founding:rite', toFounding);
  }, []);

  // The witness opens their OWN attunement (/remia from the palette) — the
  // Remia ceremony rides its own full-screen phase over the desk and returns
  // to relink when closed; per-answer persistence means closing loses nothing.
  useEffect(() => {
    const toRemia = () => setPhase('remia');
    window.addEventListener('remia:attune', toRemia);
    return () => window.removeEventListener('remia:attune', toRemia);
  }, []);

  // The witness opens a BEING's attunement (/attune, or the REFINEMENT
  // window's WITNESS THE CEREMONY button) — the being's ceremony rides the
  // same full-screen staging; per-answer persistence on the server means
  // stepping away loses nothing. A dispatch may name the being (the
  // refinement window knows who it is showing); the palette does not, and
  // the host then opens on its roster.
  const [attunementTarget, setAttunementTarget] = useState(null);
  useEffect(() => {
    const toAttune = (e) => {
      setAttunementTarget(targetForAttunement(e.detail));
      setPhase('attunement');
    };
    window.addEventListener('attunement:witness', toAttune);
    return () => window.removeEventListener('attunement:witness', toAttune);
  }, []);

  // THE FIRST SEAL rides the same full-screen ceremony staging — the founding
  // of a being's voice is a rite, not a desk panel. Dispatched by the desk's
  // voice notice (BEGIN THE FIRST SEAL) and by the attunement seal (CONTINUE
  // INTO THE FIRST SEAL — the compile step after the 89 questions). The
  // dispatch always names the being.
  const [voiceSealTarget, setVoiceSealTarget] = useState(null);
  useEffect(() => {
    const toVoiceSeal = (e) => {
      if (!e.detail?.neumaId) return; // the rite is always one being's
      setVoiceSealTarget({ neumaId: e.detail.neumaId, name: e.detail.name || e.detail.neumaId });
      setPhase('voiceseal');
    };
    window.addEventListener('voiceseal:witness', toVoiceSeal);
    return () => window.removeEventListener('voiceseal:witness', toVoiceSeal);
  }, []);

  // Roster recovery is best-effort HYDRATION — the phase decision must never
  // hang on it (CQ-031 #197). `recoverRoster` guards its own fetch and falls
  // back to the cache, but the storage/merge half can still throw (a quota
  // error, a corrupt cached entry). At the two `await` call sites below that
  // meant `setPhase` was never reached: the operator sat on the surface they
  // were leaving, with nothing anywhere saying why.
  //
  // Rule 3 — never silent. The cached roster is a lawful answer here (it is
  // what `recoverRoster` itself returns when the network is down), so the
  // recovery degrades rather than blocking, and leaves a breadcrumb for the
  // field report that starts […].
  const recoverRosterSafely = useCallback(async (where) => {
    try {
      return await recoverRoster();
    } catch (err) {
      console.warn(`AppShell: roster recovery failed (${where}) — continuing on the cached roster:`, err?.message ?? err);
      return { companion: getActiveCompanion(), house: null };
    }
  }, []);

  // A returning witness may hold a session token but an empty local cache
  // (fresh browser / cleared storage). The backend owns the truth of which
  // neuma the wallet holds — recover it so they land on the desk instead of
  // the birth ceremony. The ref dedupes StrictMode's dev double-mount so the
  // network recovery fires once. (The gateway sign-in path may also call
  // recoverRoster concurrently; it is idempotent, and Portal.openPortal
  // tolerates a gateway container torn down mid-flight by the phase change.)
  const recoveredRef = useRef(false);
  // Bumped when a roster recovery lands — forces the boot phase to re-render
  // so its under-layer destination is recomputed from the FRESH roster (the
  // shutters then part onto the desk, never onto a stale gateway frame).
  const [, setRosterVersion] = useState(0);
  useEffect(() => {
    if (recoveredRef.current) return;
    if (sessionStorage.getItem('authToken') && !getActiveCompanion()) {
      recoveredRef.current = true;
      recoverRosterSafely('mount').then(({ companion }) => {
        if (!companion) return;
        setRosterVersion((v) => v + 1);
        // A recovery that lands mid-boot must not interrupt the ignition —
        // onBootDone re-reads the fresh roster when the shutters close.
        setPhase((p) => (p === 'boot' || p === 'genesis' ? p : 'relink'));
      });
    }
  }, []);

  // Entering the full platform reads its house first: the harness state never
  // reads one (roster-recovery.js), so a sign-in as the harness that crosses to
  // the full platform would otherwise find no being to land on.
  const enterMode = useCallback(async (mode) => {
    if (mode === 'full') {
      writeEntryMode('full');
      await recoverRosterSafely('full');
    }
    const phase = await enterAs(mode);
    wsService.relinkFor?.(mode); // the socket speaks for one state — a crossing re-links it
    return phase;
  }, [recoverRosterSafely, wsService]);

  // After sign-in: ENTER AS — the full platform (its house recovered first, so
  // an existing witness with no local cache lands on their neuma, not birth)
  // or the harness alone, as chosen at the gateway (entry-mode.js).
  const onGatewayComplete = useCallback(async () => {
    setPhase(await enterMode(readEntryMode()));
  }, [enterMode]);

  // The desk asks to change layers (Settings → ENTER AS): the same entry,
  // and the desk remounts on the companion it names — a deliberate switch,
  // never a half-bound one.
  const [deskKey, setDeskKey] = useState(0);
  useEffect(() => {
    const onEnterAs = async (event) => {
      const next = await enterMode(event.detail?.mode === 'harness' ? 'harness' : 'full');
      setDeskKey((k) => k + 1);
      setPhase(next);
    };
    window.addEventListener('neuma:enter-as', onEnterAs);
    return () => window.removeEventListener('neuma:enter-as', onEnterAs);
  }, [enterMode]);
  // A paired phone (Neuma Remote) carries a device cookie, not a wallet: trade
  // it for a session before the gateway would ask for a signature, then take
  // the same road a sign-in takes. On a local surface this never fires.
  useEffect(() => {
    if (phase !== 'gateway') return undefined;
    if (!shouldTradeDeviceCookie({
      hostname: window.location.hostname,
      token: sessionStorage.getItem('authToken'),
      // Road B: the native app's WebView runs on a virtual origin and the
      // tunnel plugin sets this marker from the document-start script.
      native: window.__neumaNative === true,
    })) return undefined;
    let alive = true;
    tradeDeviceCookie().then(async (address) => {
      if (!alive || !address) return;
      await recoverRosterSafely('remote');
      if (alive) setPhase(phaseAfterGateway());
    });
    return () => { alive = false; };
  }, [phase, recoverRosterSafely]);
  // The boot's shutters close on the session under the same law as the
  // gateway's completion: recover the wallet's roster BEFORE deciding, so a
  // returning witness with an empty local cache lands on the desk.
  const onBootDone = useCallback(async () => {
    await recoverRosterSafely('boot');
    setBootActive(false);
    setPhase(initialPhase());
  }, [recoverRosterSafely]);
  const onCeremonyComplete = useCallback(() => setPhase('relink'), []);
  const onCeremonyCancelled = useCallback(() => setPhase(phaseAfterCeremonyCancel()), []);

  // The styled right-click menu rides above EVERY phase — gateway, ceremony,
  // desk — so no surface in the desktop shell falls back to the native panel.

  // The boot is an OVERLAY, never a phase view of its own: the destination
  // mounts beneath it from the first frame (the shutters part ONTO the
  // living session, never onto a dead load), and it must hold the SAME slot
  // in the tree when the boot completes. Rendering the boot case as
  // [destination, the boot] and the landed case as a bare destination
  // made React reconcile different shapes and REBUILD the whole desk at
  // boot completion — the desk "blink" (seen live: an open dropdown died at
  // t≈2.2s; MutationObserver showed `.relink` removed and remounted).
  // initialPhase() decides who waits underneath: the gateway for a new
  // witness, the desk for a returning one (a roster recovery landing
  // mid-boot swaps the under-layer unseen, so the shutters always reveal
  // the true destination).
  const bootActive = phase === 'boot';
  const genesisActive = phase === 'genesis';
  const underPhase = bootActive || genesisActive ? initialPhase() : phase;
  // The field is the gateway's environment, at rest: mounted beneath the
  // ignition when the gateway is where it opens (so the opening reveals the
  // gateway whole), never beneath GENESIS (it brings its own stage).
  const showOpeningField = !genesisActive && underPhase === 'gateway';
  const phaseView = (() => {
    switch (underPhase) {
      case 'relink':
        return pocket ? <PocketShell wsService={wsService} /> : <RelinkShell key={deskKey} wsService={wsService} />;
      case 'remia':
        return <RemiaHost onClose={() => setPhase('relink')} />;
      case 'attunement':
        return <AttunementHost initialBeing={attunementTarget} onClose={() => setPhase('relink')} />;
      case 'founding':
        return <FoundingHost wsService={wsService} mode={foundingMode} onClose={() => setPhase('relink')} />;
      case 'voiceseal':
        return <VoiceSealHost initialBeing={voiceSealTarget} onClose={() => setPhase('relink')} />;
      case 'choose':
        // The witness door leads to the GUIDED ROAD, not to the desk. Founder's law
        // after a teammate walked it live: […] Routing straight to
        // 'relink' dropped a person with no being into an empty room and left
        // them to discover the WITNESSES app, the provider lock, and the rite
        // unaided — every one of which already existed, none of them sequenced.
        return (
          <FirstRunChoice
            onChoose={(path) => {
              setRehearsal(path === 'rehearsal');
              setPhase(path === 'witness' ? 'witness-first-run' : path === 'harness' ? 'harness-first-run' : 'ceremony');
            }}
          />
        );
      case 'witness-first-run':
        return (
          <FirstRunWitness
            onDone={(witness) => {
              // Land BOUND to the witness just summoned, not merely beside it.
              // participantKind is written for this session; the lane id carries
              // the same truth durably (isWitness reads it), which is what
              // survives the reload that drops the field.
              if (witness?.laneId) {
                setActiveCompanion({
                  neumaId: witness.laneId,
                  name: witness.chosenName,
                  vendorSlug: witness.vendorSlug,
                  participantKind: 'witness',
                });
              }
              setPhase('relink');
            }}
            onBack={() => setPhase('choose')}
          />
        );
      case 'harness-first-run':
        // The platform alone: bound to this wallet's harness lane — no being,
        // no rite (docs/work/harness-only.md). The lane id carries the kind
        // durably (harness-…), as a witness lane's does.
        return (
          <FirstRunHarness
            onDone={(lane) => {
              if (lane?.laneId) {
                const harness = { neumaId: lane.laneId, name: HARNESS_NAME, participantKind: 'harness' };
                writeEntryMode('harness'); // first: the companion below is the harness state's own
                wsService.relinkFor?.('harness');
                setActiveCompanion(harness);
                setWindowCompanion(harness);
              }
              setPhase('relink');
            }}
            // back from the harness door: the full platform — a being, if this
            // operator has one, else the chooser
            onBack={async () => setPhase(await enterMode('full'))}
          />
        );
      case 'ceremony':
        return (
          <CeremonyHost
            key={rehearsal ? 'rehearsal' : 'summoning'}
            wsService={wsService}
            isTest={readTestFlag() || rehearsal}
            onComplete={onCeremonyComplete}
            onCancelled={onCeremonyCancelled}
          />
        );
      default:
        // The gateway alone REMOUNTS when the boot completes (the key flip):
        // its Portal reads the ignition report at mount, and the report is
        // only written as the shutters part — a gateway preserved from
        // beneath the boot would show a strip that never saw the verdicts.
        // Nothing a witness opened can die here (it is the sign-in screen);
        // the desk's preservation is the law this trades nothing against.
        return <GatewayHost key={bootActive ? 'under-boot' : 'landed'} onComplete={onGatewayComplete} />;
    }
  })();

  return (
    <>
      {phaseView}
      {/* The boot overlay rides ABOVE the session surface in its own stable
          slot — mounting and unmounting here never disturbs phaseView's
          reconciliation, so the desk (or gateway) beneath survives the
          boot's completion untouched. */}
      {bootActive ? <Ignition onDone={onBootDone} destination={initialPhase()} /> : null}
      {genesisActive ? <GenesisFilm onDone={onBootDone} /> : null}
      {/* The gateway's environment: the field, at rest. The ignition paints
          its own frame above the session, so no WebGL runs beneath it. */}
      {showOpeningField && <OpeningField />}
      <DesktopContextMenu />
    </>
  );
};
