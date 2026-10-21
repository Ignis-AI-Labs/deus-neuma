// sub-panel.jsx — the SUBSTRATE HUD's chamfered instrument panel. `span` is
// its width in the console's 12 columns; `aside` rides the title row (a part
// name, a state) so the body stays instruments.

export const Panel = ({ title, aside, span = 4, className = '', children }) => (
  <section className={`sub-panel cham sub-span-${span} ${className}`}>
    <div className="sub-panel-in cham-in">
      <h3 className="sub-panel-title label-data">
        <span>{title}</span>
        {aside ? <span className="sub-panel-aside">{aside}</span> : null}
      </h3>
      {children}
    </div>
  </section>
);
