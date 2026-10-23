// TikTokAccount — the TIKTOK window's ACCOUNT board: the company's own TikTok
// account as TikTok shows it, read when the board opens and on REFRESH
// (nothing polls). Overview first (JŌHŌ SEKKEI): who the account is, the four
// counts, then the recent videos as small multiples on one shared view axis.
//
// TikTok's API reads a profile and never edits one, so the account's one
// act is EDIT ON TIKTOK: the profile opens in the person's browser, where the
// bio, name and picture are changed. A connection made before this view keeps
// posting and is told plainly that it needs RECONNECT for the rest.
// Pictures travel the backend's narrow TikTok relay (the desk's content
// policy admits no outside image host). impure — network + window.open.

import { useCallback, useEffect, useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import { fetchTikTokProfile } from '../../services/social-channels-client.js';
import { useWindows } from '../windowing/use-windows.js';
import { requestSettingsFocus } from './settings-focus.js';
import { AuthImage } from './AuthImage.jsx';
import {
  durationLabel, exactCount, formatCount, postedLabel, relayedImage, viewShares,
} from '../../utils/tiktok-account-view.js';
import './PlatformStanding.css';
import './TikTokAccount.css';

const COUNTS = Object.freeze([
  ['followers', 'FOLLOWERS', 'followers'],
  ['following', 'FOLLOWING', 'accounts followed'],
  ['likes', 'LIKES', 'likes across every video'],
  ['videos', 'VIDEOS', 'public videos'],
]);

const VIDEO_COUNTS = Object.freeze([['views', 'VIEWS'], ['likes', 'LIKES'], ['comments', 'COMMENTS'], ['shares', 'SHARES']]);

// Opens in the person's browser (the desk routes window.open of an https link there).
const openOutside = (url) => { uiSound('activate'); window.open(url, '_blank', 'noopener'); };

const VerifiedMark = () => (
  <svg className="tta-verified" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" role="img" aria-label="verified">
    <path d="M8 1.5l1.7 1.3 2.1-.2.7 2 1.8 1.1-.6 2 .6 2.1-1.8 1.1-.7 2-2.1-.2L8 14.5l-1.7-1.3-2.1.2-.7-2-1.8-1.1.6-2.1-.6-2 1.8-1.1.7-2 2.1.2z" />
    <path d="M5.5 8.2l1.7 1.7 3.4-3.6" />
  </svg>
);

/** Who the account is, its four counts, and the way to edit it. */
const ProfileHead = ({ account, reading, readAt, onRefresh }) => (
  <header className="tta-head">
    <div className="tta-id">
      {account.avatarUrl
        ? <AuthImage className="tta-avatar" src={relayedImage(account.avatarUrl)} alt={`${account.displayName} profile picture`} />
        : <span className="tta-avatar authimg-loading" aria-hidden="true" />}
      <div className="tta-names">
        <span className="tta-name">{account.displayName || '—'}{account.verified ? <VerifiedMark /> : null}</span>
        <span className="tta-handle">{account.username ? `@${account.username}` : '@—'}</span>
        {account.bio !== null ? <p className="tta-bio">{account.bio || 'No bio yet.'}</p> : null}
      </div>
      <div className="tta-acts">
        <button type="button" className="ps-btn tta-edit" disabled={!account.profileUrl}
          title={account.profileUrl ? 'Opens the profile on TikTok, where the bio, name and picture are changed' : 'TikTok gave no profile link to this connection yet'}
          onClick={() => openOutside(account.profileUrl)}>EDIT ON TIKTOK</button>
        <button type="button" className="ps-btn" disabled={reading} onClick={onRefresh}>{reading ? 'READING…' : 'REFRESH'}</button>
        {readAt ? <span className="tta-read">read {new Date(readAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span> : null}
      </div>
    </div>
    <div className="tta-counts" role="group" aria-label="account counts">
      {COUNTS.map(([key, label, noun]) => (
        <span key={key} className={`tta-count${account.counts[key] === null ? ' is-unread' : ''}`} title={exactCount(account.counts[key], noun)}>
          <b>{formatCount(account.counts[key])}</b><span>{label}</span>
        </span>
      ))}
    </div>
  </header>
);

/** One video: cover, caption, date and length, its four counts, its share of the most-watched. */
const VideoCard = ({ video, share }) => (
  <li className="tta-video">
    <span className="tta-cover">
      {video.coverUrl
        ? <AuthImage className="tta-cover-img" src={relayedImage(video.coverUrl)} alt={video.caption || 'video cover'} />
        : <span className="tta-cover-img authimg-loading" aria-hidden="true" />}
      <span className="tta-duration">{durationLabel(video.durationSec)}</span>
    </span>
    <span className="tta-caption">{video.caption || 'No caption'}</span>
    <span className="tta-date">{postedLabel(video.postedAt)}</span>
    <span className="tta-share" title={share === null ? 'views not readable' : `${Math.round(share * 100)}% of the most-watched video's views`}>
      {share === null ? null : <i style={{ width: `${share * 100}%` }} />}
    </span>
    <span className="tta-video-counts">
      {VIDEO_COUNTS.map(([key, label]) => (
        <span key={key} title={exactCount(video.counts[key], label.toLowerCase())}><b>{formatCount(video.counts[key])}</b> {label}</span>
      ))}
    </span>
    {video.shareUrl ? <button type="button" className="ps-btn tta-open" onClick={() => openOutside(video.shareUrl)}>OPEN ON TIKTOK</button> : null}
  </li>
);

const Videos = ({ view }) => {
  if (view.videosError) return <p className="settings-err">{view.videosError}</p>;
  if (view.videos === null) return null;
  if (!view.videos.length) return <p className="settings-note">No public videos on this account yet.</p>;
  const shares = viewShares(view.videos);
  return (
    <section className="tta-videos" aria-label="recent videos">
      <span className="tta-k">RECENT VIDEOS · {view.videos.length}{view.hasMore ? ' newest shown' : ''} · bar = views against the most-watched</span>
      <ul>{view.videos.map((v, i) => <VideoCard key={v.id || i} video={v} share={shares[i]} />)}</ul>
    </section>
  );
};

/**
 * The board as drawn from one read: reading, refused, or the account.
 * @param {{view: ?object, error: ?string, reading: boolean, onRefresh: () => void, onKeys: () => void}} props
 */
export const TikTokAccountBoard = ({ view, error, reading, onRefresh, onKeys }) => {
  if (!view && reading) return <p className="settings-note">Reading the TikTok account…</p>;
  if (!view) {
    return (
      <div className="ps-notice" role="status">
        <span className="settings-err">{error}</span>
        <button type="button" className="ps-btn" onClick={onKeys}>MANAGE KEYS</button>
        <button type="button" className="ps-btn" onClick={onRefresh}>TRY AGAIN</button>
      </div>
    );
  }
  return (
    <div className="tta">
      {error ? <p className="settings-err">{error}</p> : null}
      {view.reconnect ? (
        <p className="ps-notice" role="status">
          <span>{view.reconnect}</span>
          <button type="button" className="ps-btn" onClick={onKeys}>RECONNECT</button>
        </p>
      ) : null}
      <ProfileHead account={view.account} reading={reading} readAt={view.readAt} onRefresh={onRefresh} />
      <Videos view={view} />
    </div>
  );
};

/** The ACCOUNT board: reads on open and on REFRESH. impure — network. */
export const TikTokAccount = () => {
  const { dispatch } = useWindows();
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);
  const [reading, setReading] = useState(true);

  const read = useCallback(async () => {
    setReading(true);
    try {
      setView(await fetchTikTokProfile());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setReading(false);
    }
  }, []);

  useEffect(() => { read(); }, [read]);

  const onKeys = () => { uiSound('toggle'); dispatch({ type: 'OPEN', id: 'settings' }); requestSettingsFocus('channel-keys'); };
  const onRefresh = () => { uiSound('toggle'); read(); };
  return <TikTokAccountBoard view={view} error={error} reading={reading} onRefresh={onRefresh} onKeys={onKeys} />;
};
