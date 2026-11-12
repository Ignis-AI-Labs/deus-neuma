// PlatformSpace — ONE platform's whole marketing space, nothing from any other
// platform mixed in: its console head, its standing (keys · holder · crew —
// StandingPanel, the one shared component), its account board where the
// platform reads one (TikTok), and its queue. Every platform renders this same
// format, so a new platform's space is a catalog entry away, never a redesign.
//
// Two homes (marketing-panel-plan.md §5, slice 6):
//   • MARKETING's ACCOUNT level (`accountId` given — null when the house has
//     no account there yet): the public platforms. One head says it by mark
//     (account-level/AccountHead.jsx, show-dont-tell SDT-6): the account,
//     KEYS · HOLDER · CREW (each a door when not fine; the holder and crew
//     open their drawer in place), the next out, the month once, the four
//     weeks. The boards narrow to that one account; the queue's composer
//     speaks as it. Campaigns live at the company level, so there is no
//     CAMPAIGNS tab — a door to the company's. Its landings come from
//     MARKETING (`landing`), never a latch of its own.
//   • its own window (COMMUNITY's TELEGRAM and DISCORD), as it always stood:
//     CAMPAIGNS · QUEUE, the company strip, landings on its own latch.

import { useCallback, useEffect, useRef, useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import { CampaignsSection } from './CampaignsSection.jsx';
import { CampaignQueueSection } from './CampaignQueueSection.jsx';
import { ChatsSection } from './ChatsSection.jsx';
import { TikTokAccount } from './TikTokAccount.jsx';
import { PlatformHeader } from './PlatformHeader.jsx';
import { StandingPanel, StandingNotice } from './StandingPanel.jsx';
import { usePlatformPulse } from './use-platform-pulse.js';
import { usePlatformStanding } from './use-platform-standing.js';
import { useCalmGate } from './use-calm-gate.js';
import { platformPulse, scopeQueue } from './platform-pulse.js';
import { AccountStrip } from './accounts/AccountStrip.jsx';
import { useHouseAccounts } from './accounts/use-house-accounts.js';
import { entryAccountId } from './accounts/account-words.js';
import { WaitingBand } from './waiting/WaitingBand.jsx';
import { useWaitingAccount } from './waiting/use-waiting.js';
import { takeCardLanding, onCardLanding } from './card-landing.js';
import { useViewHeight } from './use-view-height.js';
import { AccountHead } from './account-level/AccountHead.jsx';
import { AccountDrawers } from './account-level/AccountDrawers.jsx';
import { AccountCampaigns } from './account-level/AccountCampaigns.jsx';
import { dayKeyOf } from './month-grid.js';
import './PlatformConsole.css';

const SUBS = [
  { id: 'campaigns', label: 'CAMPAIGNS' },
  { id: 'queue', label: 'QUEUE' },
];

// A platform whose API reads the house's own account opens on an ACCOUNT
// board: the account as the platform shows it (TikTok today).
const ACCOUNT_BOARDS = Object.freeze({ tiktok: TikTokAccount });
const ACCOUNT_SUB = { id: 'account', label: 'ACCOUNT', title: 'the account as the platform shows it — read through the platform\'s one connection' };
// A platform whose bot can be talked with (the chat bridge) has a CHATS board: who may.
const CHAT_PLATFORMS = Object.freeze(['telegram', 'discord']);
const CHATS_SUB = { id: 'chats', label: 'CHATS', title: 'who may talk with the house through its bot' };
const subsFor = (channelId, inOffice) => {
  const subs = inOffice ? SUBS.filter((s) => s.id !== 'campaigns') : SUBS;
  const chats = !inOffice && CHAT_PLATFORMS.includes(channelId) ? [CHATS_SUB] : [];
  return [...(ACCOUNT_BOARDS[channelId] ? [ACCOUNT_SUB] : []), ...subs, ...chats];
};

// A window this short or shorter folds its console head to its counts, so the
// decisions below it are on screen on arrival (#585: […] at 560x600). The four weeks stay one press away.
const SHORT_WINDOW_PX = 720;

// A WAITING ON YOU landing (card-landing.js) as the queue door it opens: a reply
// lands in REPLIES, a post on POSTS' day view, whose head holds every open draft.
const landingFocus = (item) => (item?.section === 'replies' ? { section: 'replies' } : { section: 'posts', day: null, entryId: item?.entryId || null });

// A social-check door lands on STANDING instead, its holder or crew drawer open.
const STANDING_DRAWERS = Object.freeze(['holder', 'crew']);
const standingDrawer = (item) => (STANDING_DRAWERS.includes(item?.section) ? item.section : null);

/**
 * @param {{channelId: string, accountId?: ?string, landing?: ?{entryId?: ?string, section?: ?string, n: number}, companyId?: ?string}} props
 *   accountId — given (null = no account yet) only on MARKETING's account level; landing and companyId there too
 */
export const PlatformSpace = ({ channelId, accountId = undefined, landing = null, companyId: levelCompany = null, campaigns = null, onCampaign = () => {} }) => {
  const inOffice = accountId !== undefined;
  const standing = usePlatformStanding(channelId);
  const { channel, holder, notice, loadError } = standing;
  const AccountBoard = ACCOUNT_BOARDS[channelId] || null;
  // A WAITING ON YOU row that opened this window (or MARKETING's account level) names the card it lands on.
  const [landed] = useState(() => (inOffice ? landing : takeCardLanding(channelId)));
  const toChats = landed?.section === 'chats';
  const toQueue = Boolean(landed && !toChats && !standingDrawer(landed) && (!inOffice || landed.entryId || landed.section));
  const [sub, setSub] = useState(toChats ? 'chats' : toQueue ? 'queue' : AccountBoard ? 'account' : inOffice ? 'queue' : 'campaigns');
  const [chatCode, setChatCode] = useState(toChats ? landed.code ?? null : null);
  const [standingOpen, setStandingOpen] = useState(Boolean(standingDrawer(landed)));
  const [drawer, setDrawer] = useState(() => standingDrawer(landed));
  // A console door's destination; `n` remounts the queue board on each press.
  const [focus, setFocus] = useState(() => (toQueue ? { ...landingFocus(landed), n: 1 } : { n: 0 }));
  // A decision taken in the band re-reads the board below it.
  const [boardReload, setBoardReload] = useState(0);
  const [fullHead, setFullHead] = useState(false);
  // The company the boards below show ('' = every company's accounts); on the account level, that one account.
  const [companyId, setCompanyId] = useState('');
  const house = useHouseAccounts();
  // The account level's own record (its binding): undefined while the house is unread, null when it holds none here.
  const levelAccount = !inOffice || !house.known ? undefined : house.accounts.find((a) => a.id === accountId) ?? null;
  // A binding the window made by itself (the CMO, keys set) is this account's too once it is the first: re-read the house.
  useEffect(() => { if (inOffice && notice) house.refresh(); }, [inOffice, notice]);
  const shownAccounts = inOffice ? (accountId ? new Set([accountId]) : null) : companyId
    ? new Set(house.accounts.filter((a) => a.channelId === channelId && a.companyId === companyId).map((a) => a.id))
    : null;
  const ofCompany = (e) => !shownAccounts || shownAccounts.has(entryAccountId(e));
  // Background news (polls, a being's acts) waits while the person works this
  // window — it never re-lays what they are pointing at (calm-gate.js).
  const calm = useCalmGate();
  const pulseRead = usePlatformPulse({ calm });
  const waiting = useWaitingAccount();
  // Whatever the board decides, the desk's WAITING ON YOU hears at once — and
  // after the person's own act there, the band lands the news without waiting.
  const [ownAct, setOwnAct] = useState(0);
  const boardChanged = ({ own = false } = {}) => {
    pulseRead.refresh();
    if (own) setOwnAct((n) => n + 1);
    waiting?.refresh();
  };
  const { watch } = pulseRead;
  // "Short" is the person's view — the window body this space scrolls in — never its own content.
  const [viewRef, h] = useViewHeight();
  const rootRef = useCallback((node) => { viewRef(node); watch(node); }, [watch, viewRef]);
  const short = h > 0 && h <= SHORT_WINDOW_PX && !fullHead;

  const openQueue = (to) => {
    uiSound('toggle');
    setSub('queue');
    setFocus((f) => ({ ...to, n: f.n + 1 }));
  };
  const openStanding = (to) => { uiSound('toggle'); setStandingOpen(true); setDrawer(to); };
  const land = (item) => {
    if (item?.section === 'chats') { setSub('chats'); setChatCode(item.code ?? null); return; }
    if (standingDrawer(item)) openStanding(standingDrawer(item)); else openQueue(landingFocus(item));
  };
  useEffect(() => (inOffice ? undefined : onCardLanding(channelId, land)), [channelId, inOffice]);
  // MARKETING hands each new landing down numbered; the one this level mounted on is already open.
  const handled = useRef(landing?.n ?? 0);
  useEffect(() => {
    if (!inOffice || !landing || landing.n === handled.current) return;
    handled.current = landing.n;
    if (landing.entryId || landing.section) land(landing);
  }, [inOffice, landing]);
  const ownQueue = pulseRead.queue ? scopeQueue(pulseRead.queue, channelId) : null;
  const pulse = ownQueue ? platformPulse(inOffice ? ownQueue.filter(ofCompany) : ownQueue, pulseRead.now) : null;
  // The account level's WAITING ON YOU: that account's posts only (none until the queue is read, never another's).
  const ownIds = inOffice && ownQueue ? new Set(ownQueue.filter(ofCompany).map((e) => e.id)) : null;
  const keepWaiting = inOffice ? (item) => Boolean(ownIds) && (!item.where?.entryId || ownIds.has(item.where.entryId)) : null;
  const test = channel ? (pulseRead.tests[channel.id] ?? null) : null;
  const subs = channel ? subsFor(channel.id, inOffice) : [];
  // One board needs no tab: the account level's lone QUEUE is simply the board.
  const tabs = channel && (!inOffice || subs.length > 1) ? (
    <div className="outreach-tabs" role="tablist" aria-label={`${channel.name} boards`}>
      {subs.map((s) => (
        <button
          key={s.id}
          type="button"
          role="tab"
          aria-selected={sub === s.id}
          title={s.title}
          className={`outreach-tab label-data${sub === s.id ? ' is-on' : ''}`}
          onClick={() => { uiSound('toggle'); setSub(s.id); }}
        >
          {s.label}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div className={`outreach-panel settings${short ? ' is-short' : ''}`} ref={rootRef} {...calm.handlers}>
      <WaitingBand channelId={channelId} calm={calm} now={pulseRead.now} ownAct={ownAct} keep={keepWaiting}
        onDecided={() => { pulseRead.refresh(); setBoardReload((n) => n + 1); }} />
      {loadError ? <p className="settings-err">{loadError}</p> : null}
      {!channel && !loadError ? <p className="settings-note">Reading the channel board…</p> : null}

      {channel ? (
        <>
          {pulse && inOffice ? (
            <AccountHead channel={channel} accountId={accountId} account={levelAccount} test={test} standing={standing}
              read={house.known} pulse={pulse} now={pulseRead.now} lit={focus.highlight ?? null} onOpen={openQueue}
              drawer={drawer} onDrawer={setDrawer}
              compact={short} onWhole={h > 0 && h <= SHORT_WINDOW_PX ? () => { uiSound('toggle'); setFullHead((v) => !v); } : null} />
          ) : pulse ? (
            <PlatformHeader
              channel={channel} test={test}
              holderName={holder?.holder?.name ?? (channel.binding ? channel.binding.neumaId : null)}
              crewCount={standing.crew.length} pulse={pulse} now={pulseRead.now} onOpen={openQueue}
              standingOpen={standingOpen} onStanding={() => { uiSound('toggle'); setStandingOpen((v) => !v); }}
              compact={short} onWhole={h > 0 && h <= SHORT_WINDOW_PX ? () => { uiSound('toggle'); setFullHead((v) => !v); } : null}
            />
          ) : <p className="settings-note">Reading the queue…</p>}
          {notice ? (
            <StandingNotice notice={notice} channelName={channel.name}
              onChange={() => { uiSound('toggle'); setStandingOpen(true); setDrawer('holder'); }}
              onDismiss={() => { uiSound('toggle'); standing.dismissNotice(); }} />
          ) : null}
          {inOffice ? (
            <>
              {accountId ? <AccountDrawers drawer={drawer} channel={channel} account={levelAccount} standing={standing} onBound={house.refresh} /> : null}
              {/* No account here yet: its first is added right here (+ ACCOUNT). */}
              {accountId ? null : <AccountStrip channelId={channel.id} companyId="" roster={standing.roster} onCompany={() => {}} />}
            </>
          ) : (
            <>
              {standingOpen || !pulse
                ? <StandingPanel standing={standing} test={test} drawer={drawer} onDrawer={setDrawer} /> : null}
              <AccountStrip channelId={channel.id} companyId={companyId} roster={standing.roster}
                onCompany={(id) => { uiSound('toggle'); setCompanyId(id); }} />
            </>
          )}

          {inOffice ? (
            <div className="ps-tabrow">
              {tabs}
              {/* The campaigns this account carries, each a door to its page; none → its company's CAMPAIGNS. */}
              <AccountCampaigns campaigns={campaigns} accountId={accountId} companyId={levelCompany} onCampaign={onCampaign} />
            </div>
          ) : tabs}

          {/* Keyed by board so each mounts fresh on entry (the account re-reads on every entry). */}
          {sub === 'chats' ? <ChatsSection key={`chats-${channel.id}-${chatCode ?? ''}`} channelId={channel.id} focusCode={chatCode} />
            : sub === 'account' && AccountBoard ? <AccountBoard key={`account-${channel.id}`} />
            : sub === 'campaigns' ? <CampaignsSection key={`campaigns-${channel.id}`} channelId={channel.id} calm={calm} />
            : <CampaignQueueSection key={`queue-${channel.id}-${focus.n}`} channelId={channel.id} channelName={inOffice ? null : channel.name} entryFilter={ofCompany}
                focus={focus.n ? focus : null} onChanged={boardChanged} calm={calm} reload={boardReload}
                accountId={inOffice ? accountId : undefined} monthAbove={inOffice ? dayKeyOf(new Date(pulseRead.now).toISOString()).slice(0, 7) : null} />}
        </>
      ) : null}
    </div>
  );
};
