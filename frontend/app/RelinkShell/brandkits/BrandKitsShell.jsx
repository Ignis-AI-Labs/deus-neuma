// BrandKitsShell — header, rail, editor, preview.
//
// ⚠️ THREE ZONES, NOT FOUR. A docked panel may be 900px wide. A card preview
// wants 400 and a rail wants 200; leave both up permanently and the EDITOR —
// where the honest specimens and the colour bands actually live — is squeezed
// to 300, which would defeat the point of the rebuild. So the preview
// collapses, and only opens itself on a panel wide enough to hold it. The
// editor column is designed to be the widest thing on screen.

import { useEffect, useState } from 'react';
import { KitContext } from './kit-context.js';
import { useKitDraft } from './use-kit-draft.js';
import { useKitSpec } from './use-kit-spec.js';
import { useKitPreview } from './use-kit-preview.js';
import { useKitMarks } from './use-kit-marks.js';
import { sectionProgress, firstUnfinished } from './kit-progress.js';
import { KitHeader } from './KitHeader.jsx';
import { SectionRail } from './SectionRail.jsx';
import { SectionEditor, RAW_SECTION, SOURCES_SECTION } from './SectionEditor.jsx';
import { ReadinessReport } from './ReadinessReport.jsx';
import { NewKitDialog } from './NewKitDialog.jsx';
import { CardPreview } from './CardPreview.jsx';
import { EmptyState } from '../empty-state.jsx';
import { takeBrandSection, onBrandSection } from './brand-landing.js';

/** Below this the preview would take the editor's room, so it starts closed. */
const PREVIEW_FROM = 1180;

const RAW_ENTRY = { id: RAW_SECTION, label: 'THE WHOLE KIT', done: 0, total: 0, ready: true, gaps: [] };

/**
 * `brand` opens that kit on arrival (MARKETING's BRAND tab: a company is its
 * kit); a door that names one of its sections (brand-landing.js) opens on it.
 */
export const BrandKitsShell = ({ brand = null }) => {
  const kit = useKitDraft();
  const { openKit } = kit;
  const listed = kit.kits !== null;
  useEffect(() => { if (brand && listed) openKit(brand); }, [brand, listed, openKit]);
  const { spec, error: specError } = useKitSpec();
  const [active, setActive] = useState(() => takeBrandSection(brand));
  useEffect(() => onBrandSection(brand, setActive), [brand]);
  const [naming, setNaming] = useState(false);
  const [showPreview, setShowPreview] = useState(
    () => (typeof window === 'undefined' ? false : window.innerWidth >= PREVIEW_FROM),
  );

  const marks = useKitMarks(kit.open, kit.detail);
  const preview = useKitPreview(kit.open, kit.draft, { enabled: showPreview && Boolean(kit.draft) });

  if (specError) return <EmptyState title="THE BRAND KIT FORM COULD NOT BE READ" tone="error"><small>{specError}</small></EmptyState>;
  if (!spec || kit.kits === null) return <EmptyState title="READING BRAND KITS…" />;

  const progress = kit.draft ? sectionProgress(spec.form, kit.draft) : [];
  // Opens on the first section that still needs something — the panel's job is
  // getting a kit FINISHED, not showing it from the top.
  const current = active || (kit.draft ? firstUnfinished(spec.form, kit.draft) : null);
  const section = current === RAW_SECTION || current === SOURCES_SECTION
    ? { id: current }
    : spec.form.sections.find((s) => s.id === current);

  return (
    <KitContext.Provider value={{ ...kit, ...spec, brand: kit.open, marks: marks.marks, reloadMarks: marks.reload }}>
      <div className={`bk${showPreview ? ' has-preview' : ''}`}>
        <KitHeader
          kits={kit.kits}
          totals={kit.totals}
          open={kit.open}
          detail={kit.detail}
          draft={kit.draft}
          dirty={kit.dirty}
          saving={kit.saving}
          notice={kit.notice}
          ground={kit.ground}
          onOpen={(brand) => { setActive(null); kit.openKit(brand); }}
          onNew={() => setNaming(true)}
          onSave={kit.save}
          onGround={(root) => kit.setNotice(`House ground set to ${root}.`)}
          onRetryGround={() => kit.readGround()}
        />

        {!kit.open ? (
          <EmptyState title="CHOOSE A BRAND KIT, OR START A NEW ONE">
            <small>
              A kit is the standing instruction for what a company says and never
              says — set up once, before the marketing work.
            </small>
          </EmptyState>
        ) : kit.detail?.error ? (
          <EmptyState title="THAT KIT COULD NOT BE READ" tone="error"><small>{kit.detail.error}</small></EmptyState>
        ) : !kit.draft ? (
          <EmptyState title="OPENING…" />
        ) : (
          <div className="bk-body">
            <div className="bk-rail-col">
              <SectionRail sections={progress} active={current} onPick={setActive} />
              <button
                type="button"
                className={`bk-rail-row bk-rail-raw${current === SOURCES_SECTION ? ' is-on' : ''}`}
                onClick={() => setActive(SOURCES_SECTION)}
              >
                <span className="bk-rail-name label-data">SITE &amp; CODE</span>
              </button>
              <button
                type="button"
                className={`bk-rail-row bk-rail-raw${current === RAW_SECTION ? ' is-on' : ''}`}
                onClick={() => setActive(RAW_SECTION)}
              >
                <span className="bk-rail-name label-data">{RAW_ENTRY.label}</span>
              </button>
              <ReadinessReport report={kit.detail?.report} stale={kit.dirty} />
              {!showPreview ? (
                <button type="button" className="bk-show-preview label-data" onClick={() => setShowPreview(true)}>
                  SHOW THE CARD
                </button>
              ) : null}
            </div>

            <main className="bk-editor">
              <SectionEditor section={section} progress={progress.find((p) => p.id === current)} />
            </main>

            {showPreview ? <CardPreview preview={preview} onCollapse={() => setShowPreview(false)} /> : null}
          </div>
        )}

        {naming ? (
          <NewKitDialog
            onCancel={() => setNaming(false)}
            onCreate={(name) => { setNaming(false); setActive(null); kit.startNew(name); }}
          />
        ) : null}
      </div>
    </KitContext.Provider>
  );
};
