// SystemDictationSection — dictation in every app (Settings): hold a key anywhere on this computer,
// speak, let go, and the words are typed into the window in focus, through the same local speech
// engine as the desk's own dictation. Off until the install owner turns it on; what this computer
// still needs for it is named with the command that adds it.
import { useEffect, useState } from 'react';
import { Select } from './Select.jsx';
import { getSystemDictation, setSystemDictation } from '../../services/system-dictation-client.js';
import { uiSound } from '../../services/ui-sound.js';

const Need = ({ need }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(need.fix); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); }
  };
  return (
    <li className="conn-row">
      <p className="conn-line">{need.why}</p>
      <div className="conn-acts">
        <code className="conn-line">{need.fix}</code>
        <button type="button" className="settings-set" onClick={copy}>{copied ? 'COPIED' : 'COPY'}</button>
      </div>
    </li>
  );
};

export const SystemDictationSection = () => {
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { getSystemDictation().then(setView).catch((e) => setError(e.message)); }, []);

  const change = async (body) => {
    if (busy) return;
    uiSound('toggle');
    setBusy(true);
    setError(null);
    try { setView(await setSystemDictation(body)); } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const ready = view?.readiness;
  const keyLabel = view?.keys?.find((k) => k.id === view.key)?.label || 'THE KEY';
  return (
    <section className="settings-sec conn" data-testid="system-dictation">
      <div className="label-data settings-h">DICTATE IN EVERY APP</div>
      <p className="settings-note">
        Hold {keyLabel}, speak, and let go: your words are typed into whatever window you are in, through the same
        speech engine as dictation here. The microphone is open only while you hold the key, and nothing leaves this computer.
      </p>
      {error ? <p className="settings-err" role="alert">{error}</p> : null}
      {view ? (
        ready && !ready.supported ? <p className="settings-note">{ready.reason}</p> : (
          <>
            <div className="conn-row">
              <div className="conn-head">
                <span className="conn-name">Dictation in every app</span>
                <span className="conn-state label-data">{view.on ? (view.listening ? 'LISTENING' : 'ON — NOT READY') : 'OFF'}</span>
              </div>
              <div className="conn-acts">
                <button type="button" className="settings-set" aria-pressed={view.on} disabled={busy} onClick={() => change({ on: !view.on, key: view.key })}>
                  {busy ? 'SWITCHING…' : view.on ? 'TURN OFF' : 'TURN ON'}
                </button>
                <Select value={view.key} ariaLabel="Hold key" disabled={busy}
                  options={(view.keys || []).map((k) => ({ value: k.id, label: k.label }))}
                  onChange={(key) => change({ on: view.on, key })} />
              </div>
            </div>
            {ready?.missing?.length ? (
              <>
                <div className="label-data conn-group">THIS COMPUTER STILL NEEDS</div>
                <ul className="conn-list">{ready.missing.map((need) => <Need key={need.id} need={need} />)}</ul>
              </>
            ) : null}
          </>
        )
      ) : (!error && <p className="settings-note">Reading…</p>)}
    </section>
  );
};
