// ChatsSection — a COMMUNITY platform's CHATS tab: who may talk with the house
// through its bot (channel connections C-04/C-05). Default-deny: a stranger
// who writes to the bot gets a pairing code and waits here (and in WAITING ON
// YOU) for the operator's APPROVE or DENY; an approved person, or a group
// (heard only when it names the bot), stands on the list until TAKEN OFF. The
// line's own state says whether the bot hears at all: the […] connection, a holder, its keys. Its own IO, like the sections beside it.

import './ChatsSection.css';
import { useCallback, useEffect, useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import { getChatBridge, answerChatCode, revokeChat } from '../../services/chat-bridge-client.js';
import { chatLineWords, whoWords, codeAge } from './chats-view.js';

export const ChatsSection = ({ channelId, focusCode = null }) => {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setState(await getChatBridge()); setError(null); } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const act = async (fn) => {
    uiSound('activate');
    setBusy(true);
    try { const r = await fn(); if (r?.status) setState(r.status); else await load(); setError(null); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const accounts = (state?.accounts ?? []).filter((a) => a.channel === channelId);
  const now = Date.now();
  return (
    <section className="chats" data-chats={channelId}>
      {error ? <p className="settings-err" role="alert">{error}</p> : null}
      {!state ? <p className="settings-note">Reading the chats…</p> : (
        <>
          <p className="chats-line" data-chats-line={state.on ? 'on' : 'off'}>{chatLineWords(state.on, accounts)}</p>
          <p className="chats-note">
            Nobody is heard until you say so. Someone who writes to the bot gets a code; approve it here and they can talk with the being who holds
            the bot. In a group you approve, the bot answers only when it is named.
          </p>
          {accounts.map((a) => (
            <div key={a.accountId} className="chats-account" data-chat-account={a.accountId}>
              {a.lastError ? <p className="chats-err">{a.stopped ? 'STOPPED' : 'LAST TROUBLE'}: {a.lastError}</p> : null}
              <p className="chats-h">WAITING FOR YOUR YES — {a.pending.length}</p>
              {a.pending.map((p) => (
                <div key={p.code} className={`chats-row${focusCode === p.code ? ' is-focus' : ''}`} data-chat-code={p.code}>
                  <span className="chats-who">{whoWords(p)} — CODE <span className="chats-exact">{p.code}</span> · {codeAge(p.at, now)}</span>
                  <span className="chats-acts">
                    <button type="button" className="sec-scan" disabled={busy} onClick={() => act(() => answerChatCode(a.accountId, p.code, true))}>APPROVE</button>
                    <button type="button" className="sec-scan legal-danger" disabled={busy} onClick={() => act(() => answerChatCode(a.accountId, p.code, false))}>DENY</button>
                  </span>
                </div>
              ))}
              <p className="chats-h">MAY TALK WITH THE HOUSE — {a.allowed.length}</p>
              {a.allowed.map((w) => (
                <div key={`${w.kind}:${w.id}`} className="chats-row" data-chat-allowed={`${w.kind}:${w.id}`}>
                  <span className="chats-who">{whoWords(w)}</span>
                  <button type="button" className="sec-scan legal-danger" disabled={busy} onClick={() => act(() => revokeChat(a.accountId, w.kind, w.id))}>TAKE OFF</button>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </section>
  );
};
