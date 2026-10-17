// StreamPalette.jsx — the slash palette: typing "/" opens one surface over
// two sources — native platform commands (actions the composer runs) ranked
// first, then the installed-skills library (the same registry the neuma
// summons from). Open only while the first token is being typed; it closes
// itself the moment the value stops looking like one. Split from
// StreamInput.jsx (size law); bodies moved verbatim. `runOrSay` and `submit`
// stay the composer's own — they are threaded in, never imported back.

import { useState } from 'react';
import { paletteQuery, buildPalette, moveSelection } from './slash-palette.js';
import { PLATFORM_COMMANDS } from './commands.js';
import { listSkills } from '../../services/skills-client.js';
import { uiSound } from '../../services/ui-sound.js';
import { useSettled } from './use-settled.js';

export const useSlashPalette = ({ value, setValue, fieldRef, runOrSay, submit }) => {
  const [palette, setPalette] = useState(null); // { items, sel } | null
  useSettled((settled) => {
    const query = paletteQuery(value);
    if (query === null) { setPalette(null); return undefined; }
    const show = (skills) => {
      const items = buildPalette(PLATFORM_COMMANDS, skills, query);
      setPalette(items.length ? { items, sel: 0 } : null);
    };
    // Native commands resolve even if the skills library is unreachable.
    listSkills().then((skills) => { if (!settled()) show(skills); })
      .catch(() => { if (!settled()) show([]); });
  }, [value]);

  const acceptSkill = (skill) => {
    uiSound('tick');
    setValue(`/${skill.name} `);
    fieldRef.current?.focus();
  };

  // Accept a palette item by kind: a command runs its action and clears the
  // field (it is not chat speech); a skill completes into the composer.
  const acceptItem = (item) => {
    if (item.kind === 'command') {
      uiSound('tick');
      if (runOrSay(item)) { setValue(''); setPalette(null); fieldRef.current?.focus(); }
      return;
    }
    acceptSkill(item);
  };

  // Palette keys take the field's keys while it is open; everything else
  // falls through to the normal composer behavior. Returns handled.
  const onPaletteKey = (e) => {
    if (!palette) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      uiSound('tick');
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      setPalette((p) => ({ ...p, sel: moveSelection(p.sel, delta, p.items.length) }));
      return true;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      acceptItem(palette.items[palette.sel]);
      return true;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const selected = palette.items[palette.sel];
      // A command runs its action; a fully-typed exact skill name sends the
      // summons; otherwise Enter completes the highlighted skill into the field.
      if (selected.kind === 'command') {
        acceptItem(selected);
      } else if (paletteQuery(value) === selected.name) {
        setPalette(null);
        submit();
      } else {
        acceptSkill(selected);
      }
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      uiSound('close');
      setPalette(null);
      return true;
    }
    return false;
  };

  return { palette, acceptItem, onPaletteKey };
};

export const StreamPalette = ({ palette, acceptItem }) => (
  palette ? (
    <div className="relink-palette" role="listbox" aria-label="Commands and skills">
      {palette.items.map((item, idx) => (
        <button
          key={`${item.kind}:${item.name}`}
          type="button"
          role="option"
          aria-selected={idx === palette.sel}
          className={`relink-palette-row${idx === palette.sel ? ' is-sel' : ''}${item.kind === 'command' ? ' is-command' : ''}`}
          onMouseDown={(e) => {
            e.preventDefault(); // keep the field focused
            acceptItem(item);
          }}
        >
          <span className="relink-palette-name">/{item.name}</span>
          <span className="relink-palette-desc">{item.description}</span>
          {item.kind === 'command' ? <span className="relink-palette-kind">action</span> : null}
        </button>
      ))}
    </div>
  ) : null
);
