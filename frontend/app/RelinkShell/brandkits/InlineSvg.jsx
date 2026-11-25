// Card previews use an inert image document, never an HTML parsing sink.
export const InlineSvg = ({ svg, label }) => (
  <div className="bk-svg">
    {svg ? (
      <img
        src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
        alt={label || 'card preview'}
        style={{ display: 'block', width: '100%', height: 'auto' }}
      />
    ) : null}
  </div>
);
