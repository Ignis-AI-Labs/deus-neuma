// SnapOverlay — the snap grid, shown only while dragging.
//
// Draws the 2x2 grid guides across the snap bounds so the witness sees the
// cells they can lock to, and highlights the active target zone. The cell
// animates between zones (the --snap transition) for the "locking" feel.

export const SnapOverlay = ({ bounds, active }) => (
  <div
    className="fwin-snap"
    aria-hidden="true"
    style={{
      transform: `translate(${bounds.x}px, ${bounds.y}px)`,
      width: `${bounds.w}px`,
      height: `${bounds.h}px`,
    }}
  >
    <span className="fwin-snap-line fwin-snap-v" />
    <span className="fwin-snap-line fwin-snap-h" />
    {active ? (
      <span
        className="fwin-snap-cell"
        style={{
          left: `${active.x - bounds.x}px`,
          top: `${active.y - bounds.y}px`,
          width: `${active.w}px`,
          height: `${active.h}px`,
        }}
      />
    ) : null}
  </div>
);
