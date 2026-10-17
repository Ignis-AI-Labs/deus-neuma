// SheetDossier — the RECORD's dossier frame (Design note, 2026-09-26: […]). Pure rendering:
//
//   SheetSection — a numbered file section: code · title · rule · aside.
//   SheetIndex   — the file's tab strip, sticky at the top of the scroll.
//                  Real tabs, not jump links (Design note, 2026-09-26: […]):
//                  one section shows at a time; ← → walk the strip.
//   SheetPanel   — one tab's page; hidden unless its tab is selected.
//   SpecGrid     — the parts-sheet cell: a small label over its value, laid
//                  in a grid, so the eye reads down columns instead of
//                  travelling across a full-width row per fact.
//
// No sound imports — node-renderable (sheet-app.test.js).

export const sectionId = (key) => `sheet-sec-${key}`;

export const SheetSection = ({ id, code, title, aside = null, children, className = '' }) => (
  <section className={`sheet-sec dos-sec${className ? ` ${className}` : ''}`} id={id ? sectionId(id) : undefined}>
    <header className="dos-h">
      {code ? <span className="dos-h-code label-data">{code}</span> : null}
      <h3 className="sheet-h dos-h-title label-data">{title}</h3>
      <span className="dos-h-rule" aria-hidden="true" />
      {aside ? <span className="dos-h-aside label-data">{aside}</span> : null}
    </header>
    {children}
  </section>
);

const tabId = (key) => `sheet-tab-${key}`;
const panelId = (key) => `sheet-panel-${key}`;

// The tab one arrow-press away, wrapping at both ends — pure.
export const stepTab = (items, active, delta) => {
  const at = items.findIndex((it) => it.key === active);
  return items[(at + delta + items.length) % items.length].key;
};

const ARROW_STEP = Object.freeze({ ArrowLeft: -1, ArrowRight: 1 });

// impure (focus) on keydown only — the render stays pure.
const onArrow = (items, active, onSelect) => (e) => {
  const delta = ARROW_STEP[e.key];
  if (!delta) return;
  e.preventDefault();
  const next = stepTab(items, active, delta);
  onSelect(next);
  document.getElementById(tabId(next))?.focus();
};

export const SheetIndex = ({ items, active, onSelect }) => (
  <nav className="dos-index" role="tablist" aria-label="Record sections" onKeyDown={onArrow(items, active, onSelect)}>
    {items.map((it) => {
      const on = it.key === active;
      return (
        <button key={it.key} id={tabId(it.key)} type="button" role="tab"
          aria-selected={on} aria-controls={panelId(it.key)} tabIndex={on ? 0 : -1}
          className={`dos-index-tab label-data${on ? ' is-on' : ''}`} onClick={() => onSelect(it.key)}>
          <span className="dos-index-code">{it.code}</span>{it.title}
        </button>
      );
    })}
  </nav>
);

export const SheetPanel = ({ tab, active, children }) => (
  <div className="dos-page" role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)} hidden={tab !== active}>
    {children}
  </div>
);

// impure (scroll) on a tab switch only. Once the strip has stuck, the new
// page opens at its own top — never mid-way down where the last one was left.
export const rewindTo = (panelsEl) => {
  const scroller = panelsEl?.closest('.sheet');
  const strip = scroller?.querySelector('.dos-index');
  if (!strip) return;
  const hidden = panelsEl.getBoundingClientRect().top - strip.getBoundingClientRect().bottom;
  if (hidden < 0) scroller.scrollTop += hidden;
};

/**
 * @param {{cells: Array<{k: string, v: *, note?: string, wide?: boolean}>, className?: string}} props
 */
export const SpecGrid = ({ cells, className = '' }) => (
  <dl className={`dos-spec${className ? ` ${className}` : ''}`}>
    {cells.map((c) => (
      <div key={c.k} className={`dos-cell${c.wide ? ' is-wide' : ''}`}>
        <dt className="dos-cell-k label-data">{c.k}</dt>
        <dd className="dos-cell-v">{c.v}{c.note ? <span className="dos-cell-note label-data">{c.note}</span> : null}</dd>
      </div>
    ))}
  </dl>
);
