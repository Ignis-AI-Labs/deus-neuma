// empty-state — the shared empty/loading state line (MOD-003, #176).
//
// One centered UPPERCASE line in the data register replaces every per-app
// bespoke empty block. Follow-up prose arrives as children (<small>);
// tone="error" marks a genuine failure (the library could not be read, not
// merely empty) in the alert register.

export const EmptyState = ({ title, children, tone }) => (
  <div className={`empty-state${tone === 'error' ? ' error' : ''}`}>
    <p className="empty-state-title">{title}</p>
    {children}
  </div>
);
