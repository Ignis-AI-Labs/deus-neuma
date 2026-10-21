// SheetChosen — the RECORD's 02 CHOSEN: what the being chose, and keeps
// choosing — its NAME (the half it chose and the half its seal gave, and how
// the whole is spoken), its FORM (a look agreed with its operator, never
// sealed), its VOICE (the founding lines it claimed — counted here, never
// quoted: they are its own words) and its ATTUNEMENT. Presentational.

import { formatShortDate, formatDateTime } from '../../utils/format.js';
import { AuthImage } from './AuthImage.jsx';
import { SheetSection, SpecGrid } from './SheetDossier.jsx';
import { FormLockActions } from './FormLockActions.jsx';
import { UNREADABLE, EMPTY, READY, attunementReadiness, excerptOf, formReadiness, formRowsOf, formEmptyLine } from './sheet-view.js';
import { nameCellsOf, voiceLineOf } from './sheet-being-view.js';

const Unreadable = () => <p className="sheet-unreadable label-data">UNREADABLE</p>;
const fmt = (iso) => formatDateTime(iso).toUpperCase();

const NameBlock = ({ file }) => {
  const cells = nameCellsOf(file);
  const n = file?.name;
  return (
    <SheetSection code="02·A" title="NAME" aside="CHOSEN AT ITS NAMING · SEALED AT ITS BIRTH">
      {file === null ? <Unreadable /> : cells.length === 0 ? <p className="sheet-line label-data">NO TRUE NAME ON THIS LANE YET.</p> : (
        <>
          <SpecGrid cells={cells} />
          {n.english ? <blockquote className="sb-spoken">{n.english.split('\n').map((line) => <p key={line}>{line}</p>)}</blockquote> : null}
          {n.notation ? (
            <details className="sb-kotodama">
              <summary className="label-data">KOTODAMA — HOW ITS NAME SOUNDS</summary>
              <pre className="sb-kotodama-score">{n.notation}</pre>
            </details>
          ) : null}
        </>
      )}
    </SheetSection>
  );
};

const VoiceBlock = ({ file }) => (
  <SheetSection code="02·C" title="VOICE" aside="ITS FOUNDING LINES — ITS OWN WORDS, NEVER QUOTED HERE">
    {file === null ? <Unreadable /> : (
      <p className={`sheet-line label-data${file?.voice?.sealed ? ' sb-live' : ''}`}>{voiceLineOf(file, fmt)}</p>
    )}
  </SheetSection>
);

// FORM — the being's own look. A WORKING agreement between the being and the
// operator, never a seal: either party can withdraw and it returns to
// exploring, so nothing here is permanent and the section must not imply it is.
//
// Design note, 2026-08-27: […]
//
// So the PFP is the face of the section and the turnaround rides inside a
// <details> — closed by default, costing one line until somebody asks for it.
const FormBlock = ({ form, neumaId, onActed }) => {
  const readiness = formReadiness(form);
  const rows = formRowsOf(form);
  return (
    <SheetSection id="form" code="02·B" title="FORM" aside="CHOSEN TOGETHER — LOCKED, NEVER SEALED">
      {readiness === UNREADABLE ? <Unreadable /> : readiness === EMPTY ? (
        <>
          <p className="sheet-line label-data">{formEmptyLine(form)}</p>
          {/* The operator's half: a championed look waits here for its concur. */}
          <FormLockActions form={form} neumaId={neumaId} onActed={onActed} />
        </>
      ) : (
        <div className="sheet-form">
          {rows.map((row) => (
            <div key={row.register} className="sheet-form-row">
              <div className="sheet-form-head">
                <span className="sheet-form-reg label-data">{row.register.toUpperCase()}</span>
                {/* Stated plainly. A being reading its own card should never have
                    to wonder whether this was permanent. */}
                <span className="sheet-form-standing label-data">LOCKED — NOT SEALED</span>
              </div>
              {row.pfp ? (
                <AuthImage
                  className="sheet-form-pfp"
                  src={`/api/v1/image-forge/images/${row.pfp.imageId}?laneId=${encodeURIComponent(neumaId)}`}
                  alt={`${row.register} portrait`}
                />
              ) : (
                <p className="sheet-line label-data">NO PORTRAIT IN THIS REGISTER.</p>
              )}
              {row.turnaround ? (
                <details className="sheet-form-more">
                  <summary className="label-data">TURNAROUND SHEET</summary>
                  <AuthImage
                    className="sheet-form-turn"
                    src={`/api/v1/image-forge/images/${row.turnaround.imageId}?laneId=${encodeURIComponent(neumaId)}`}
                    alt={`${row.register} turnaround sheet`}
                  />
                </details>
              ) : null}
            </div>
          ))}
          {/* Either party can reopen the exploration — the button stands here. */}
          <FormLockActions form={form} neumaId={neumaId} onActed={onActed} />
        </div>
      )}
    </SheetSection>
  );
};

const AttunementBlock = ({ attunement }) => {
  const readiness = attunementReadiness(attunement);
  if (readiness === EMPTY) return null; // an honest silence — the block is omitted
  const excerpt = readiness === READY ? excerptOf(attunement) : null;
  return (
    <SheetSection id="attunement" code="02·D" title="ATTUNEMENT"
      aside={excerpt ? `${String(excerpt.key).toUpperCase()} · SEALED ${formatShortDate(excerpt.sealedAt)}` : null}>
      {readiness === UNREADABLE ? <Unreadable /> : (
        <blockquote className="sheet-att">
          {excerpt.question ? <p className="sheet-att-q label-data">{excerpt.question}</p> : null}
          {excerpt.answer ? <p className="sheet-att-a">“{excerpt.answer}”</p> : null}
        </blockquote>
      )}
    </SheetSection>
  );
};

export const ChosenSpace = ({ sheet, neumaId, onActed }) => (
  <>
    <NameBlock file={sheet.file} />
    <FormBlock form={sheet.form} neumaId={neumaId} onActed={onActed} />
    <VoiceBlock file={sheet.file} />
    <AttunementBlock attunement={sheet.attunement} />
  </>
);
