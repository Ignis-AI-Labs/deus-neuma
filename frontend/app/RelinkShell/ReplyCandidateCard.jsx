// ReplyCandidateCard — one inbound knock's card, extracted verbatim from
// CampaignQueueSection.jsx (size-law breakdown, 2026-08-26). This module
// never imports CampaignQueueSection.jsx.

import { replyDispositionLabel, replyWhenLabel } from './campaigns-helpers.js';
import { XPostLink } from './XPostLink.jsx';

// THE KNOCK, VISIBLE (Design note, 2026-07-28: […]). One inbound
// reply to the house's own post, VERBATIM, with its reads attached: who
// (verified standing named honestly — a signal, never a gate), the substance
// and escalation heuristics marked as the first passes they are, WHICH house
// post it answers (the post's own words when this lane published it), and
// what the house has done about it so far. Always open: a knock is a record
// to read, not a pile to fold.
export const ReplyCandidateCard = ({ candidate: c, now, children }) => {
  const category = c.category && c.category !== 'ordinary' ? String(c.category) : null;
  const alert = ['financial', 'legal', 'threat'].includes(c.category);
  const tone = c.disposition === 'none' ? 'await' : 'done';
  return (
    <div className={`queue-card cham is-${tone}`}>
      <div className="cham-in queue-card-in">
        <div className="queue-entry-head">
          <span className="queue-entry-id">
            {/* THE LINK BACK (ruling, 2026-08-28): a knock is verified on the
                real X post, never on the card's say-so — the author opens the
                replier's own post, and the ANSWERS label opens the house post
                it answers when this lane published it. */}
            <XPostLink postId={c.postId} className="settings-k">
              @{c.username || 'unknown'}
            </XPostLink>
            <span className={`queue-standing is-${tone}`}>{replyDispositionLabel(c.disposition)}</span>
          </span>
          <span className="settings-v"><span className="settings-sec-tags">
            <span className="settings-tag-dim">
              {c.substance === 'low-effort' ? 'LOW-EFFORT' : 'SUBSTANTIVE'}
            </span>
          </span></span>
        </div>
        <div className="queue-preview">
          <div className="queue-preview-head">
            <span className="queue-preview-via">
              {c.verifiedType && c.verifiedType !== 'none'
                ? `VERIFIED · ${String(c.verifiedType).toUpperCase()}`
                : 'UNVERIFIED'} · REPLIED TO THE HOUSE
            </span>
            {category ? (
              <span className={`queue-preview-via${alert ? ' is-alert' : ''}`}>
                {category.toUpperCase()}
              </span>
            ) : null}
          </div>
          <p className="queue-preview-text">{c.text}</p>
          {c.answersPost ? (
            <div className="queue-reply-context">
              <div className="queue-preview-head">
                <XPostLink postId={c.answersPost.postId} className="queue-preview-via">
                  ANSWERS THE HOUSE'S POST
                </XPostLink>
              </div>
              <p className="queue-preview-text">{c.answersPost.text}</p>
            </div>
          ) : null}
          {/* What the house said back, in its own words — staged or sent. */}
          {(c.answers || []).map((a) => (
            <div key={a.id} className="queue-reply-context reply-house-answer">
              <div className="queue-preview-head">
                <span className="queue-preview-via">THE HOUSE'S ANSWER · {String(a.status).toUpperCase()}</span>
              </div>
              <p className="queue-preview-text">{a.text}</p>
            </div>
          ))}
          {c.dismissed ? (
            <p className="settings-note">
              IN THE BIN{c.dismissedBy ? ` — set aside by ${c.dismissedBy}` : ''}{c.reason ? ` (${c.reason})` : ''}
            </p>
          ) : null}
        </div>
        <div className="queue-entry-foot">
          <span className="queue-entry-meta">{replyWhenLabel(c, now)}</span>
          {children}
        </div>
      </div>
    </div>
  );
};
