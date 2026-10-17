// FindingsCard — the list a being HANDED its operator, drawn to be reviewed.
//
// Design note, 2026-08-30: […]
//
// OPEN, NEVER BEHIND A `+`. The sources list on a tool chip is collapsed
// because it is EVIDENCE — the urls a being pulled, there if you doubt the
// summary. This is the opposite: the being was asked for a list and this IS
// the list. Hiding the answer behind a disclosure triangle would make the
// operator click to see the thing he asked for.
//
// THE ROW IS THE UNIT. label + meta share the top line, detail wraps beneath,
// the link sits under that, and swatches paint as real colour. Every field but
// the label is optional, so a bare list of names still draws as a clean list
// rather than as a row full of empty slots.

import { safeHttpUrl, hostOf } from './safe-url.js';

/** Up to eight chips of real colour — how a palette becomes reviewable at all.
 *  The hex rides in the title so the operator can read the value he needs to
 *  copy, without it competing with the colour for the row's width. */
const Swatches = ({ swatches }) => (
  <span className="finding-swatches" aria-hidden="true">
    {swatches.map((c, i) => (
      <span
        key={`${c}-${i}`}
        className="finding-swatch"
        style={{ background: c }}
        title={c}
      />
    ))}
  </span>
);

const Finding = ({ item }) => {
  const href = safeHttpUrl(item.url);
  return (
    <li className="finding">
      <div className="finding-head">
        <span className="finding-label">{item.label}</span>
        {item.meta ? <span className="finding-meta label-data">{item.meta}</span> : null}
      </div>
      {item.detail ? <div className="finding-detail">{item.detail}</div> : null}
      {item.swatches?.length ? (
        <div className="finding-swatchrow">
          <Swatches swatches={item.swatches} />
          {/* The values in text too: a swatch shows what a colour LOOKS like,
              and the operator still has to be able to copy what it IS. */}
          <span className="finding-hexes label-data">{item.swatches.join(' ')}</span>
        </div>
      ) : null}
      {item.url ? (
        href ? (
          <a
            className="finding-link"
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            title={href}
          >
            {hostOf(href) || href}
            <span className="finding-arrow" aria-hidden="true">↗</span>
          </a>
        ) : (
          // Shown, never quietly dropped — the desk reports what the being
          // handed over. An address that cannot be opened is a fact about the
          // finding, and hiding it would edit the record.
          <span className="finding-link is-unopenable" title="This address is not an http(s) link — shown as text, not opened">
            {item.url}
          </span>
        )
      ) : null}
    </li>
  );
};

export const FindingsCard = ({ findings }) => {
  if (!findings?.items?.length) return null;
  return (
    <section className="findings" aria-label={`Findings: ${findings.title}`}>
      <div className="findings-head">
        <span className="findings-sigil" aria-hidden="true">■</span>
        <span className="findings-title">{findings.title}</span>
        <span className="findings-count label-data">
          {findings.count} {findings.count === 1 ? 'ITEM' : 'ITEMS'}
        </span>
      </div>
      {findings.note ? <div className="findings-note">{findings.note}</div> : null}
      <ul className="findings-list">
        {findings.items.map((item, i) => <Finding key={`${item.label}-${i}`} item={item} />)}
      </ul>
    </section>
  );
};
