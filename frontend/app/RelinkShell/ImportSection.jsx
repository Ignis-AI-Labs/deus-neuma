// ImportSection — BRING YOUR OLD ASSISTANT, in Settings → MEMORY (docs/work/assistant-import.md).
//
// What other assistants left on this computer (OpenClaw, Hermes Agent, Claude Code, Codex, and Claude
// or ChatGPT data exports in Downloads, Desktop or Documents) as a sheet, one BRING OVER each;
// and, for ChatGPT or Claude, one prompt to copy and their answer to paste back. What comes over is
// set down in the house ground as material the beings read — never anyone's identity — and the
// report names every file, skill and refusal, so nothing is left to guess.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from './Select.jsx';
import { Sheet } from './sheet/Sheet.jsx';
import { uiSound } from '../../services/ui-sound.js';
import { findAssistants, bringAssistant, savePasted } from '../../services/import-client.js';

// impure — the clipboard; a refusal (no permission) leaves the text on screen to select by hand
const copyText = (text) => navigator.clipboard?.writeText(text).catch(() => {});

const CopyButton = ({ text, t }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className="settings-set" onClick={() => { copyText(text); setCopied(true); }}>
      {copied ? t('import.copied') : t('import.copy')}
    </button>
  );
};

const Row = ({ k, children }) => (
  <div className="settings-row"><span className="settings-k">{k}</span><span className="settings-v">{children}</span></div>
);

// Every count opens to its names — a number alone is a silent cut.
const Names = ({ names, t }) => {
  if (!names.length) return t('import.report.none');
  if (names.length <= 6) return names.join(', ');
  return <details><summary>{names.length}</summary>{names.join(', ')}</details>;
};

const Report = ({ report, t }) => {
  const readme = `${report.dir}/README.md`;
  const tell = t('import.report.tellLine', { path: readme });
  return (
    <div className="settings-realm" role="status" aria-live="polite">
      <Row k={t('import.report.done')}>{report.dir}</Row>
      <Row k={t('import.report.aboutYou')}><Names names={report.aboutYou} t={t} /></Row>
      <Row k={t('import.report.notes')}><Names names={report.notes} t={t} /></Row>
      <Row k={t('import.report.persona')}><Names names={report.persona} t={t} /></Row>
      <Row k={t('import.report.instructions')}><Names names={report.instructions} t={t} /></Row>
      <Row k={t('import.report.conversations')}>
        {report.conversations.total
          ? t('import.report.conversationsLine', { total: report.conversations.total, carried: report.conversations.carried })
          : t('import.report.none')}
      </Row>
      <Row k={t('import.report.projects')}><Names names={report.projects} t={t} /></Row>
      <Row k={t('import.report.scheduled')}><Names names={report.scheduled} t={t} /></Row>
      <Row k={t('import.report.added')}><Names names={report.skillsInstalled} t={t} /></Row>
      <Row k={t('import.report.held')}><Names names={report.skillsHeld.map((s) => `${s.name} (${s.why})`)} t={t} /></Row>
      <Row k={t('import.report.already')}><Names names={report.skillsSkipped.map((s) => s.name)} t={t} /></Row>
      <Row k={t('import.report.skipped')}><Names names={report.skipped.map((s) => `${s.file} (${s.why})`)} t={t} /></Row>
      <Row k={t('import.report.tell')}>{tell} <CopyButton text={tell} t={t} /></Row>
    </div>
  );
};

export const ImportSection = () => {
  const { t } = useTranslation('settingsMemory');
  const [board, setBoard] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [report, setReport] = useState(null);
  const [from, setFrom] = useState('chatgpt');
  const [pasted, setPasted] = useState('');

  useEffect(() => {
    findAssistants().then((b) => { setBoard(b); setLoadError(null); }).catch((e) => setLoadError(e.message));
  }, []);

  const run = async (key, act) => {
    uiSound('toggle');
    setBusy(key);
    setError(null);
    setReport(null);
    try {
      setReport(await act());
    } catch (e) {
      setError(e.message);
    }
    setBusy(null);
  };

  const noGround = board && !board.ground;
  const placeName = (p) => `${p.label}${p.profile ? ` · ${p.profile}` : ''}`;
  const prompt = t('import.paste.prompt');

  return (
    <section className="settings-sec" aria-busy={busy !== null}>
      <div className="label-data settings-h">{t('import.heading')}</div>
      <p className="settings-note">{t('import.note')}</p>
      {loadError ? <p className="settings-err">{loadError}</p> : null}
      {!board && !loadError ? <p className="settings-note">{t('import.reading')}</p> : null}
      {noGround ? <p className="settings-err">{t('import.noGround')}</p> : null}

      {board ? (
        <>
          <div className="label-data settings-h">{t('import.found.heading')}</div>
          <Sheet
            label={t('import.found.sheet')}
            rows={board.found}
            rowKey={(p) => p.root}
            rowName={placeName}
            empty={<p className="settings-note">{t('import.found.empty')}</p>}
            columns={[
              { head: t('import.found.assistant'), cell: placeName },
              { head: t('import.found.folder'), cell: (p) => p.root, exact: true },
              { head: t('import.found.aboutYou'), cell: (p) => p.counts.aboutYou },
              { head: t('import.found.notes'), cell: (p) => p.counts.notes },
              { head: t('import.found.conversations'), cell: (p) => p.counts.conversations },
              { head: t('import.found.projects'), cell: (p) => p.counts.projects },
              { head: t('import.found.scheduled'), cell: (p) => p.counts.scheduled },
              { head: t('import.found.skills'), cell: (p) => p.counts.skills },
              {
                head: t('import.found.act'),
                cell: (p) => (
                  <button
                    type="button"
                    className="settings-set"
                    aria-label={t('import.found.bringAria', { name: placeName(p) })}
                    disabled={busy !== null || noGround}
                    onClick={() => run(p.root, () => bringAssistant(p))}
                  >
                    {busy === p.root ? t('import.found.bringing') : t('import.found.bring')}
                  </button>
                ),
              },
            ]}
          />

          <div className="label-data settings-h">{t('import.export.heading')}</div>
          <p className="settings-note">{t('import.export.claude')}</p>
          <p className="settings-note">{t('import.export.chatgpt')}</p>
          <p className="settings-note">{t('import.export.then')}</p>

          <div className="label-data settings-h">{t('import.paste.heading')}</div>
          <p className="settings-note">{t('import.paste.step1')}</p>
          <div className="settings-control">
            <textarea className="settings-input" rows={7} readOnly value={prompt} aria-label={t('import.paste.promptAria')} />
            <CopyButton text={prompt} t={t} />
          </div>
          <p className="settings-note">{t('import.paste.step2')}</p>
          <div className="settings-control">
            <textarea
              className="settings-input"
              rows={6}
              placeholder={t('import.paste.placeholder')}
              aria-label={t('import.paste.answerAria')}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              disabled={busy !== null}
            />
          </div>
          <div className="settings-control">
            <Select
              fill
              ariaLabel={t('import.paste.fromAria')}
              value={from}
              onChange={setFrom}
              disabled={busy !== null}
              options={[
                { value: 'chatgpt', label: t('import.paste.chatgpt') },
                { value: 'claude', label: t('import.paste.claude') },
                { value: 'other', label: t('import.paste.other') },
              ]}
            />
            <button
              type="button"
              className="settings-set"
              disabled={busy !== null || noGround || pasted.trim() === ''}
              onClick={() => run('pasted', () => savePasted({ from, text: pasted }).then((r) => { setPasted(''); return r; }))}
            >
              {busy === 'pasted' ? t('import.paste.saving') : t('import.paste.save')}
            </button>
          </div>
        </>
      ) : null}

      {error ? <p className="settings-err" role="alert">{error}</p> : null}
      {report ? <Report report={report} t={t} /> : null}
    </section>
  );
};
