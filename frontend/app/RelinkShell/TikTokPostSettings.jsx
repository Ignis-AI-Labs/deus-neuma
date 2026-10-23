// TikTokPostSettings — a TikTok post's choices on its queue card, as TikTok's
// Content Sharing Guidelines require of a Direct Post: the account it goes
// to (creator info, read as the card renders), who can watch (chosen from an
// empty dropdown), Allow comments / duet / stitch (all off until pressed,
// greyed when the account turned one off), the commercial content
// disclosure, the AI-generated label (always on, shown fixed), and TikTok's
// declaration just above APPROVE. The video plays above, in place. Once
// approved, the card reads back exactly what was approved.
// The law is frontend/utils/tiktok-consent.js; the state, use-tiktok-approval.js.

import { uiSound } from '../../services/ui-sound.js';
import { Select } from './Select.jsx';
import {
  PRIVACY_LABELS, TIKTOK_WORDS, MUSIC_USAGE_URL, BRANDED_CONTENT_URL, commercialLabel, consentDeclaration,
} from '../../utils/tiktok-consent.js';
import './SettingsApp.css';
import './SettingsApp-sections.css';
import './TikTokPostSettings.css';

const PRIVATE_UNTIL_REVIEW = 'TikTok keeps posts private until the app passes its review.';
const DRAFTS_NOTE = 'This video goes to the TikTok app\'s inbox: finish the post there, and turn the AI-generated label on.';
const ACCOUNT_OFF = 'Turned off in this account\'s TikTok settings';
const AI_LABEL_NOTE = 'Every house post carries TikTok\'s AI-generated label.';
const PROMOTION_QUESTION = 'Does this video promote yourself, a brand, product or service?';
const POLICY_LINKS = Object.freeze({
  branded: { href: BRANDED_CONTENT_URL, words: 'Branded Content Policy' },
  music: { href: MUSIC_USAGE_URL, words: 'Music Usage Confirmation' },
});

// One on/off press, the desk's own toggle (DeskSection).
const Toggle = ({ on, disabled, title, onFlip, children }) => (
  <button type="button" className={`settings-desk-toggle${on ? ' on' : ''}`} aria-pressed={on}
    disabled={disabled} title={title} onClick={() => { uiSound('toggle'); onFlip(); }}>
    {children}
  </button>
);

// One choice: its name, the control, and what it means — the words sit beside
// the control while the card is wide and fold under it when narrow, never
// past the card's edge (TikTokPostSettings.css).
const Row = ({ k, children, help, suggestion }) => (
  <div className="tt-row">
    <span className="settings-k tt-k">{k}</span>
    <div className="tt-cell">
      <span className="tt-controls">{children}</span>
      {help || suggestion ? (
        <span className="tt-aside">
          {help ? <span className="tt-help">{help}</span> : null}
          {suggestion ? <span className="tt-suggest">SUGGESTED · {suggestion}</span> : null}
        </span>
      ) : null}
    </div>
  </div>
);

// The declaration, with TikTok's policies linked. Pure render.
const TikTokDeclaration = ({ commercial }) => {
  const { policies } = consentDeclaration(commercial);
  const link = (key) => (
    <a key={key} href={POLICY_LINKS[key].href} target="_blank" rel="noopener noreferrer">{POLICY_LINKS[key].words}</a>
  );
  return (
    <p className="settings-note tt-declaration">
      By posting, you agree to TikTok&apos;s {policies.length > 1 ? <>{link('branded')} and {link('music')}</> : link('music')}.
    </p>
  );
};

// pure — the suggestion words a being's settings lines carry, per row.
const suggestionWords = (suggested) => {
  const allow = ['comment', 'duet', 'stitch'].filter((k) => suggested?.allow?.[k]);
  const promo = suggested?.promotion?.paid ? 'Branded content' : suggested?.promotion?.ownBrand ? 'Your brand' : null;
  return {
    privacy: suggested?.privacyLevel ? PRIVACY_LABELS[suggested.privacyLevel] : null,
    allow: allow.length ? allow.join(', ') : null,
    promotion: promo,
  };
};

// The choices of a Direct Post still awaiting approval.
const PostChoices = ({ creator, suggested, choice, setChoice, blockers }) => {
  const words = suggestionWords(suggested);
  const set = (patch) => setChoice({ ...choice, ...patch });
  const flipAllow = (key) => set({ allow: { ...choice.allow, [key]: !choice.allow[key] } });
  const c = choice.commercial;
  const setCommercial = (patch) => set({ commercial: { ...c, ...patch } });
  const privacyOptions = creator.privacyOptions.map((value) => {
    const brandedBlocks = value === 'SELF_ONLY' && c.on && c.branded;
    return { value, label: PRIVACY_LABELS[value], disabled: brandedBlocks, title: brandedBlocks ? TIKTOK_WORDS.brandedNotPrivate : undefined };
  });
  const label = commercialLabel(c);
  return (
    <>
      <Row k="Posts to">
        <span className="tt-account">{creator.nickname || creator.username}</span>
        {creator.username ? <span className="settings-tag-dim">@{creator.username}</span> : null}
      </Row>
      <Row k="Who can watch" suggestion={words.privacy}>
        <Select value={choice.privacyLevel} options={privacyOptions} placeholder="CHOOSE"
          ariaLabel="Who can watch this video" onChange={(privacyLevel) => set({ privacyLevel })} />
      </Row>
      <Row k="Allow" suggestion={words.allow}>
        <Toggle on={choice.allow.comment} disabled={creator.commentDisabled} title={creator.commentDisabled ? ACCOUNT_OFF : undefined} onFlip={() => flipAllow('comment')}>COMMENTS</Toggle>
        <Toggle on={choice.allow.duet} disabled={creator.duetDisabled} title={creator.duetDisabled ? ACCOUNT_OFF : undefined} onFlip={() => flipAllow('duet')}>DUET</Toggle>
        <Toggle on={choice.allow.stitch} disabled={creator.stitchDisabled} title={creator.stitchDisabled ? ACCOUNT_OFF : undefined} onFlip={() => flipAllow('stitch')}>STITCH</Toggle>
      </Row>
      <Row k="AI-generated" help={AI_LABEL_NOTE}>
        <span className="tt-fixed">ON · ALWAYS</span>
      </Row>
      <Row k="Promotion" help={PROMOTION_QUESTION} suggestion={words.promotion}>
        <Toggle on={c.on} onFlip={() => setCommercial(c.on ? { on: false, yourBrand: false, branded: false } : { on: true })}>
          {c.on ? 'DISCLOSED' : 'NOT DISCLOSED'}
        </Toggle>
      </Row>
      {c.on ? (
        <Row k="">
          <Toggle on={c.yourBrand} title="You are promoting yourself or your own business." onFlip={() => setCommercial({ yourBrand: !c.yourBrand })}>YOUR BRAND</Toggle>
          <Toggle on={c.branded} disabled={choice.privacyLevel === 'SELF_ONLY'}
            title={choice.privacyLevel === 'SELF_ONLY' ? TIKTOK_WORDS.brandedNotPrivate : 'You are promoting another brand or a third party.'}
            onFlip={() => setCommercial({ branded: !c.branded })}>BRANDED CONTENT</Toggle>
          {label ? <span className="tt-label">{label}</span> : null}
        </Row>
      ) : null}
      <p className="settings-note">{PRIVATE_UNTIL_REVIEW} {TIKTOK_WORDS.processing}</p>
      <TikTokDeclaration commercial={c} />
      {blockers.length ? <p className="tt-blocker">TO APPROVE · {blockers[0]}</p> : null}
    </>
  );
};

// pure — an approved post's choices, read back in the card's own words.
const approvedWords = (consent) => [
  PRIVACY_LABELS[consent.privacyLevel],
  ...['comment', 'duet', 'stitch'].map((k) => `${k} ${consent.allow?.[k] ? 'on' : 'off'}`),
  consent.commercial?.branded ? 'Paid partnership' : consent.commercial?.yourBrand ? 'Promotional content' : 'no promotion',
  'AI-generated label on',
].join(' · ');

/** A TikTok post's settings block on its queue card. Pure render over the hook's state. */
export const TikTokPostSettings = ({ entry, state }) => {
  if (!state?.live) {
    // Settled or armed: the record of what was approved, nothing to choose.
    const consent = entry.tiktokConsent;
    if (!consent) return null;
    return (
      <div className="tt-settings">
        <Row k="Approved as">
          <span className="settings-v">{approvedWords(consent)}{consent.account?.username ? ` · to @${consent.account.username}` : ''}</span>
        </Row>
        {['approved', 'sending', 'sent'].includes(entry.status) ? <p className="settings-note">{TIKTOK_WORDS.processing}</p> : null}
      </div>
    );
  }
  const { card } = state;
  let body;
  if (!card) body = <p className="settings-note">READING THE TIKTOK ACCOUNT…</p>;
  else if (card.error) body = <p className="settings-err">{card.error}</p>;
  else if (card.mode === 'drafts') body = <p className="settings-note">{DRAFTS_NOTE}</p>;
  else body = <PostChoices creator={card.creator} suggested={card.suggested} choice={state.choice} setChoice={state.setChoice} blockers={state.blockers} />;
  return <div className="tt-settings">{body}</div>;
};
