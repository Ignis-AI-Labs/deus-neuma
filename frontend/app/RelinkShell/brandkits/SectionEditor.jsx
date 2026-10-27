// SectionEditor — mount the right editor for the chosen section.
//
// Nine of the twelve sections render straight from the spec, because a text
// field is a text field. Three do not: a palette, a type system and a board of
// artwork are not lists of fields, and pretending otherwise is how COLOUR ended
// up as twenty-five undifferentiated swatches and TYPOGRAPHY as eleven flat
// rows. `layout` on the form spec says which.

import { FieldList } from './FieldList.jsx';
import { ColourEditor } from './ColourEditor.jsx';
import { TypographyEditor } from './TypographyEditor.jsx';
import { MarksSection } from './MarksSection.jsx';
import { RawEditor } from './RawEditor.jsx';
import { CompanySources } from './CompanySources.jsx';
import { useKit } from './kit-context.js';

export const RAW_SECTION = 'raw';
// The company's SITE & CODE is no kit field: it is saved on its own (the
// companies route), the moment the owner changes it.
export const SOURCES_SECTION = 'sources';

export const SectionEditor = ({ section, progress }) => {
  const { brand, roster } = useKit();
  if (section?.id === RAW_SECTION) return <RawEditor />;
  if (section?.id === SOURCES_SECTION) return <CompanySources companyId={brand} roster={roster} />;
  if (!section) return null;
  const gaps = progress?.gaps || [];

  return (
    <div className="bk-section">
      <header className="bk-section-head">
        <h4 className="label-data">
          {section.label}
          <span className="bk-section-n">{progress?.done}/{progress?.total}</span>
        </h4>
        {section.note ? <p className="bk-note">{section.note}</p> : null}
      </header>

      {section.layout === 'palette' ? <ColourEditor /> : null}
      {section.layout === 'type' ? <TypographyEditor gaps={gaps} /> : null}
      {section.layout === 'marks' ? <MarksSection gaps={gaps} /> : null}
      {(!section.layout || section.layout === 'fields')
        ? <FieldList section={section} gaps={gaps} /> : null}
    </div>
  );
};
