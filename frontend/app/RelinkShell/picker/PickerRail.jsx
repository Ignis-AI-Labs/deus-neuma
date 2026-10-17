// PickerRail — the FolderPicker's left rail: PLACES / PINNED / DRIVES /
// RECENT as one vertical instrument. A click navigates there (the list
// shows what is inside; OPEN picks); a double-click opens it directly. The
// place that holds the current folder is lit — you always know where you are.

import { SECTION_GLYPHS, RootGlyph } from './picker-glyphs.jsx';

/**
 * @param {{
 *   sections: ReadonlyArray<{key: string, label: string, items: ReadonlyArray<{path: string, name: string, sub: string}>}>,
 *   activePath: string|null,
 *   onGo: (path: string) => void,
 *   onOpen: (path: string) => void,
 * }} props
 */
export const PickerRail = ({ sections, activePath, onGo, onOpen }) => (
  <nav className="picker-rail" aria-label="Places">
    {sections.map((section) => (
      <section key={section.key} className="picker-railsec">
        <h3 className="picker-railhead">
          <span className="picker-railhead-label">{section.label}</span>
          <span className="picker-railhead-rule" aria-hidden="true" />
          <span className="picker-railhead-count">{String(section.items.length).padStart(2, '0')}</span>
        </h3>
        <ul className="picker-raillist">
          {section.items.map((it) => {
            const Glyph = section.key === 'places' && it.name === 'Filesystem' ? RootGlyph : SECTION_GLYPHS[section.key];
            const active = it.path === activePath;
            return (
              <li key={`${section.key}:${it.path}`}>
                <button
                  type="button"
                  className={`picker-railitem${section.key === 'recent' ? ' picker-recent' : ''}${active ? ' is-active' : ''}`}
                  aria-current={active ? 'location' : undefined}
                  onClick={() => onGo(it.path)}
                  onDoubleClick={() => onOpen(it.path)}
                  title={it.path}
                >
                  <span className="picker-railglyph"><Glyph /></span>
                  <span className="picker-railtext">
                    <span className="picker-railname">{it.name}</span>
                    <span className="picker-railsub"><bdi>{it.sub}</bdi></span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    ))}
  </nav>
);
