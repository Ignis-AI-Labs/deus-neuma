// SectionRail — twelve sections, and how far along each one is.
//
// Design note, 2026-08-31: […]
//
// WHY TWELVE AND NOT NINE. The gate has nine sections and IDENTITY is nineteen
// of its thirty-nine fields — a name, a handle, five colours, eleven type
// slots, two marks, an owner. As one heading that is the wall in the screenshot.
// So the form splits it four ways (IDENTITY · COLOUR · TYPOGRAPHY · MARKS) and
// kit-form.js on the server owns that regrouping, pinned by a test that makes
// the four still sum to the gate's nineteen.
//
// THE RAIL IS ALSO THE CHECKLIST. The old panel had a separate STILL NEEDED
// block listing gaps by path — `logoRules.minWidthPx` — three sections away
// from any box that could answer them. The same information is better as
// navigation: a count here, and the gap marked on the field itself.
//
// THE COUNTS RECOMPUTE AS YOU TYPE. They come from the draft in hand, not from
// the server's readiness, which is a round trip stale the moment anything
// changes — i.e. stale for the entire time the rail is being read.

export const SectionRail = ({ sections, active, onPick, collapsed }) => (
  <nav className={`bk-rail${collapsed ? ' is-narrow' : ''}`} aria-label="brand kit sections">
    <ul>
      {sections.map((section) => (
        <li key={section.id}>
          <button
            type="button"
            className={`bk-rail-row${section.id === active ? ' is-on' : ''}${section.ready ? ' is-done' : ''}`}
            onClick={() => onPick(section.id)}
            aria-current={section.id === active ? 'true' : undefined}
            title={`${section.label} — ${section.done} of ${section.total}`}
          >
            <span className="bk-rail-name label-data">{section.label}</span>
            <span className="bk-rail-n label-data">
              {section.ready ? '✓' : `${section.done}/${section.total}`}
            </span>
          </button>
        </li>
      ))}
    </ul>
  </nav>
);
