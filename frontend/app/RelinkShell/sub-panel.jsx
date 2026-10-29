// sub-panel.jsx — the SUBSTRATE HUD's chamfered instrument panel. `span` is
// its width in the console's 12 columns; `aside` rides the title row (a part
// name, a state) so the body stays instruments. A machine part's panel names
// its `part` (the health strip's door lands on it) and wears its `level`;
// `hint` is the title's hover (a glyph key, said once there, never as a
// legend sentence under the panel). `tools` rides the title row's end (a
// board's own levers on the panel: its marks and its ⋯ menu).

import './panel-grid.css';
import { LevelMark } from './level-mark.jsx';

export const Panel = ({ title, aside, span = 4, part, level, hint, tools, className = '', children }) => (
  <section className={`sub-panel cham sub-span-${span} ${className}`} data-part={part}>
    <div className="sub-panel-in cham-in">
      <h3 className="sub-panel-title label-data">
        <span className="sub-panel-name" title={hint}>{level ? <LevelMark level={level} size={16} /> : null}{title}</span>
        {aside ? <span className="sub-panel-aside">{aside}</span> : null}
        {tools || null}
      </h3>
      {children}
    </div>
  </section>
);
