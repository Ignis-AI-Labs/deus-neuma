// DictationSetup — the prompt shown when hold-to-talk finds this machine
// missing the speech components, so the witness is invited to install them
// instead of watching a bare error flash.
//
// Two kinds of missing piece, two hands:
//   weights — the Whisper model is the app's own data; one click drives the
//             platform's downloader and the card watches it land.
//   uv      — a system runtime; the app never installs system software
//             silently. The exact command is offered to copy and run.

import { useEffect, useRef, useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import {
  dictationReadiness, startModelDownload, modelDownloadStatus,
} from './stt-client.js';
import './DictationSetup.css';

const UV_INSTALL_CMD = 'curl -LsSf https://astral.sh/uv/install.sh | sh';
const POLL_MS = 3000;

// `upgrade` (from readiness): dictation works on the processor and the graphics card has room for
// the faster model; the same card offers it, once, and NOT NOW is remembered by the caller.
export const DictationSetup = ({ missing, upgrade = null, onDismiss }) => {
  const [needs, setNeeds] = useState(missing);
  const [downloading, setDownloading] = useState(false);
  const [note, setNote] = useState(null);
  const [copied, setCopied] = useState(false);
  // what the engine needs, as the platform names it: an installed app's processor engine says its own
  // model and size (managed-stt.js); without that, the house's Whisper sidecar wording stands
  const [model, setModel] = useState(null);
  // alive escapes every effect's closure — copyCmd, download, and the poll
  // below all read it — so it stays a component-level ref, not useSettled.
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    dictationReadiness().then((r) => { if (alive.current && r?.label) setModel({ label: r.label, bytes: r.bytes, device: r.device, why: r.why }); });
  }, []);

  // Re-probe readiness on a beat while the card is open — an install done in
  // a terminal beside the app is noticed without any button press.
  useEffect(() => {
    const iv = setInterval(async () => {
      const r = await dictationReadiness();
      if (!alive.current || !r) return;
      setNeeds([...r.missing]);
      if (r.label) setModel({ label: r.label, bytes: r.bytes, device: r.device, why: r.why });
      if (r.ready && !(upgrade && r.upgrade)) {
        setNote(upgrade ? 'ON YOUR GRAPHICS CARD — HOLD TO SPEAK' : 'READY — HOLD TO SPEAK');
        setTimeout(() => { if (alive.current) onDismiss(); }, 2500);
        clearInterval(iv);
      }
    }, POLL_MS * 2);
    return () => clearInterval(iv);
  }, [onDismiss, upgrade]);

  const copyCmd = async () => {
    try {
      await navigator.clipboard.writeText(UV_INSTALL_CMD);
      setCopied(true);
      uiSound('activate');
      setTimeout(() => { if (alive.current) setCopied(false); }, 2000);
    } catch {
      setNote('COPY FAILED — SELECT THE COMMAND BY HAND');
    }
  };

  const download = async () => {
    setNote(null);
    setDownloading(true);
    uiSound('activate');
    const started = await startModelDownload();
    if (!started.ok) {
      if (alive.current) { setNote(started.error.toUpperCase()); setDownloading(false); }
      return;
    }
    // watch the platform's downloader until it lands or refuses
    while (alive.current) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const st = await modelDownloadStatus();
      if (!st || st.state === 'running') continue;
      if (!alive.current) return;
      setDownloading(false);
      if (st.state === 'succeeded') {
        setNeeds((m) => m.filter((x) => x !== 'weights'));
        setNote('MODEL DOWNLOADED');
      } else {
        setNote((st.error || 'DOWNLOAD FAILED — SEE voice-engines/_logs').toUpperCase());
      }
      return;
    }
  };

  const needsUv = needs.includes('uv');
  const needsWeights = needs.includes('weights') || Boolean(upgrade);
  const offer = upgrade ? { label: upgrade.label, bytes: upgrade.bytes } : model;

  return (
    <div className="dictation-setup cham" role="dialog" aria-label="Dictation setup">
      <div className="dictation-setup-in cham-in">
        <div className="dictation-setup-title label-data">
          {upgrade ? '«NOTICE» DICTATION CAN RUN ON YOUR GRAPHICS CARD' : '«NOTICE» DICTATION NEEDS COMPONENTS'}
        </div>
        <p className="dictation-setup-lead">
          {upgrade
            ? `Your graphics card has room for the faster, more accurate speech model (${upgrade.why}). Dictation keeps working on your processor until it lands.`
            : model
            ? `Speaking to your neuma runs a local speech engine on your ${model.device === 'gpu' ? 'graphics card' : 'processor'}${model.why ? ` (${model.why})` : ''}. This machine is missing:`
            : 'Speaking to your neuma runs a local Whisper engine. This machine is missing:'}
        </p>

        {needsUv ? (
          <div className="dictation-setup-item">
            <span className="dictation-setup-name label-data">UV — PYTHON RUNTIME MANAGER</span>
            <p>System software is installed by your hand, never silently. Run this in a terminal:</p>
            <div className="dictation-setup-cmd">
              <code>{UV_INSTALL_CMD}</code>
              <button type="button" className="sub-btn" onClick={copyCmd}>
                {copied ? 'COPIED' : 'COPY'}
              </button>
            </div>
          </div>
        ) : null}

        {needsWeights ? (
          <div className="dictation-setup-item">
            <span className="dictation-setup-name label-data">
              {offer ? `${offer.label} · ${(offer.bytes / 1e9).toFixed(1)} GB` : 'WHISPER LARGE-V3 — SPEECH MODEL · 3.1 GB'}
            </span>
            <p>The platform downloads and keeps this beside your other engines.</p>
            <button
              type="button"
              className="sub-btn is-primary"
              disabled={downloading || needsUv}
              title={needsUv ? 'Install uv first — the downloader runs through it' : 'Download the model'}
              onClick={download}
            >
              {downloading ? 'DOWNLOADING…' : 'DOWNLOAD MODEL'}
            </button>
            {needsUv ? <span className="dictation-setup-gate label-data">install uv first</span> : null}
          </div>
        ) : null}

        {note ? <div className="dictation-setup-note label-data">{note}</div> : null}

        <div className="dictation-setup-actions">
          <button type="button" className="sub-btn" onClick={onDismiss}>NOT NOW</button>
        </div>
      </div>
    </div>
  );
};
