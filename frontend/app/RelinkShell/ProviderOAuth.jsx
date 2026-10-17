// ProviderOAuth — subscription sign-in for OAuth-capable providers.
//
// Three states, all honest:
//   • credentialKind 'oauth' — CONNECTED · <account> (signal: it IS live)
//     plus SIGN OUT (the DELETE key endpoint also clears oauth credentials).
//   • a flow in flight — PENDING: the device userCode prominent (data
//     register, letter-spaced, copy-on-click) with the verification URL as a
//     link; polling runs on the server's pollAfterMs cadence until terminal.
//   • otherwise — SIGN IN, one button per offered mode when both exist.
// Polling cancels on unmount, on provider switch, and on strict-mode remount
// (effect cleanup). impure — network + clipboard + window.open.

import { useEffect, useRef, useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import { startProviderOAuth, pollProviderOAuth, removeProviderKey } from '../../services/routing.js';
import './ProviderOAuth.css';

const DEFAULT_POLL_MS = 5000;

/**
 * @param {object} props
 * @param {object} props.provider catalog entry ({id, credentialKind, account, oauth})
 * @param {() => void} props.onChanged reload the provider catalog (connect/sign-out landed)
 */
export const ProviderOAuth = ({ provider, onChanged }) => {
  const [flow, setFlow] = useState(null); // { mode, verificationUrl, userCode?, pollAfterMs? }
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  // The parent re-creates its reload each render; the polling effect must not
  // restart for that, so the latest reload rides a ref.
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  const copyTimer = useRef(null);
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  // Poll on the server's cadence until the flow lands. The cleanup cancels
  // the pending tick, so switching provider (or closing the window) never
  // writes into a dead flow.
  useEffect(() => {
    if (!flow) return undefined;
    let alive = true;
    let timer = null;
    const tick = async () => {
      const r = await pollProviderOAuth(provider.id, flow.mode);
      if (!alive) return;
      if (r.status === 'pending') {
        timer = setTimeout(tick, r.pollAfterMs || DEFAULT_POLL_MS);
        return;
      }
      setFlow(null);
      if (r.status === 'complete') {
        uiSound('confirm');
        onChangedRef.current();
      } else {
        setError(r.error || (r.status === 'denied'
          ? 'Sign-in was denied.'
          : r.status === 'expired'
            ? 'The sign-in code expired — start again.'
            : 'Sign-in failed.'));
      }
    };
    timer = setTimeout(tick, flow.pollAfterMs || DEFAULT_POLL_MS);
    return () => { alive = false; clearTimeout(timer); };
  }, [flow, provider.id]);

  if (provider.credentialKind === 'oauth') {
    const signOut = async () => {
      uiSound('deny');
      setBusy(true); setError(null);
      try {
        await removeProviderKey(provider.id);
        await onChangedRef.current();
      } catch (e) { setError(e.message); }
      setBusy(false);
    };
    return (
      <div className="provider-oauth">
        <div className="settings-control">
          <span className="settings-tag-ok provider-oauth-account label-data">
            CONNECTED · {(provider.account || provider.id).toUpperCase()}
          </span>
          <button type="button" className="settings-set is-danger" onClick={signOut} disabled={busy}>
            {busy ? '…' : 'SIGN OUT'}
          </button>
        </div>
        {error ? <p className="settings-err">{error}</p> : null}
      </div>
    );
  }

  const modes = Array.isArray(provider.oauth) ? provider.oauth : [];
  if (!modes.length) return null;

  const start = async (mode) => {
    uiSound('activate');
    setBusy(true); setError(null); setCopied(false);
    try {
      const r = await startProviderOAuth(provider.id, mode);
      if (!r.success) { setError(r.error || 'Could not start sign-in.'); setBusy(false); return; }
      if (r.status === 'complete') {
        uiSound('confirm');
        await onChangedRef.current();
        setBusy(false);
        return;
      }
      if (mode === 'browser' && r.verificationUrl) window.open(r.verificationUrl, '_blank', 'noopener');
      setFlow({
        mode,
        verificationUrl: r.verificationUrl || null,
        userCode: r.userCode || null,
        pollAfterMs: r.pollAfterMs,
      });
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const copyCode = async () => {
    if (!flow?.userCode) return;
    uiSound('tick');
    try {
      await navigator.clipboard.writeText(flow.userCode);
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch { setCopied(false); }
  };

  return (
    <div className="provider-oauth">
      {flow ? (
        <div className="cham provider-oauth-flow">
          <div className="cham-in provider-oauth-flow-in">
            <span className="settings-tag-dim label-data">
              SIGN-IN PENDING{flow.mode === 'browser' ? ' — COMPLETE IT IN THE BROWSER WINDOW' : ''}
            </span>
            {flow.userCode ? (
              <button type="button" className="provider-oauth-code" onClick={copyCode} title="Copy the code">
                {flow.userCode}
                <span className="provider-oauth-copy label-data">{copied ? 'COPIED' : 'COPY'}</span>
              </button>
            ) : null}
            {flow.verificationUrl ? (
              <a className="provider-oauth-link label-data" href={flow.verificationUrl} target="_blank" rel="noreferrer">
                {flow.verificationUrl} ↗
              </a>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="settings-control">
          {modes.map((m) => (
            <button key={m} type="button" className="settings-set" onClick={() => start(m)} disabled={busy}>
              {busy ? '…' : modes.length > 1 ? `SIGN IN — ${m.toUpperCase()}` : 'SIGN IN'}
            </button>
          ))}
        </div>
      )}
      {error ? <p className="settings-err">{error}</p> : null}
    </div>
  );
};
