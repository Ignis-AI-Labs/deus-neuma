import { useId, useRef } from 'react';

/** Controlled horizontal tabs with one mounted, labelled panel. */
export const DeskTabs = ({ items, value, onChange, label, className, tabClassName,
  panelClassName, headerClassName, headerAside, children }) => {
  const id = useId();
  const buttons = useRef(new Map());
  // impure — keyboard selection moves focus within this tablist only.
  const selectFromKey = (event, index) => {
    const targets = { ArrowRight: (index + 1) % items.length,
      ArrowLeft: (index + items.length - 1) % items.length, Home: 0, End: items.length - 1 };
    if (!Object.hasOwn(targets, event.key)) return;
    event.preventDefault();
    const next = items[targets[event.key]].id;
    onChange(next);
    buttons.current.get(next)?.focus();
  };
  const tabs = (
    <nav className={className} role="tablist" aria-label={label} aria-orientation="horizontal">
      {items.map((item, index) => <button key={item.id} type="button" role="tab"
        ref={node => { if (node) buttons.current.set(item.id, node); else buttons.current.delete(item.id); }}
        id={`${id}-tab-${item.id}`} aria-controls={`${id}-panel-${item.id}`}
        aria-selected={value === item.id} tabIndex={value === item.id ? 0 : -1}
        className={`${tabClassName}${value === item.id ? ' is-on' : ''}`}
        onKeyDown={event => selectFromKey(event, index)} onClick={() => onChange(item.id)}>
        {item.label}
      </button>)}
    </nav>
  );
  return <>
    {headerClassName ? <header className={headerClassName}>{tabs}{headerAside}</header> : tabs}
    {items.map(item => <div key={item.id} role="tabpanel" id={`${id}-panel-${item.id}`}
      aria-labelledby={`${id}-tab-${item.id}`} hidden={value !== item.id}
      className={value === item.id ? panelClassName : undefined} tabIndex={0}>
      {value === item.id ? children : null}
    </div>)}
  </>;
};
