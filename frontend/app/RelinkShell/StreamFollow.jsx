// StreamFollow — the follow control's own lane, under a transcript (never
// inside it). FOLLOWING = the stream snaps to the live tail; released
// (clicked, or the reader scrolled up), the view stands still while the
// stream keeps landing, and ▼ LIVE returns to now. A lane of its own, so the
// control never covers the words it follows — the sticky overlay it replaced
// sat on whatever reached the transcript's bottom edge. Shared by the
// one-on-one stream and the council transcript (stream-follow.js is the law).

export const StreamFollow = ({ following, setFollowing, scroller, shown = true }) => (
  <div className="stream-follow-lane">
    {shown ? (
      <button
        type="button"
        className="stream-follow label-data"
        data-on={following ? 'true' : undefined}
        title={following
          ? 'Following the live tail — click to read freely (scrolling up releases it too)'
          : 'Jump to the live tail and follow again'}
        onClick={() => {
          if (following) { setFollowing(false); return; }
          setFollowing(true);
          const el = scroller.current;
          if (el) el.scrollTop = el.scrollHeight;
        }}
      >
        {following ? 'FOLLOWING ▼' : '▼ LIVE'}
      </button>
    ) : null}
  </div>
);
