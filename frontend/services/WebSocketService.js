import { resolveBoundCompanion } from '../utils/companion-data.js';
import { currentEntryMode } from '../utils/entry-mode-scope.js';
import { setStatus, clearStatus } from '../utils/loading-states.js';
import {
  CONNECT_MS, NUDGE_SILENCE_MS, nextBackoff,
} from './socket-resilience.js';

import { createPortalOutbox } from './portal-outbox-controller.js';

/**
 * WebSocket service for real-time portal communication.
 * Manages connection lifecycle, reconnection with backoff, message queuing,
 * heartbeat stale detection, message deduplication, and session resume.
 * The resilience decisions (backoff schedule, handshake watchdog, the
 * storage-mirrored outbox) live in socket-resilience.js so they can be
 * proven without a browser (Neuma Remote phase 2).
 */
export class WebSocketService {
  /**
   * Create a new WebSocketService with auto-detected protocol and host.
   * @param {{quiet?: boolean}} [opts] - `quiet` keeps this portal off the
   *   desk's GLOBAL status badge entirely (both setting and clearing it). A
   *   tab's own portal (TabPortalHost, #407) connects and reconnects as
   *   background plumbing — flashing "Portal established" on every tab
   *   switch announced an activation the operator never asked to hear about,
   *   on a status node that belongs to the desk's one primary link.
   *
   *   It covers the SOUND for the same reason (Design note, 2026-08-29: […]). The
   *   badge was silenced here in August; the chime lives in the stream
   *   handlers and was missed, so the announcement simply changed senses.
   *   `quiet` means this portal announces itself NOWHERE.
   */
  constructor({ quiet = false } = {}) {
    this._quiet = quiet;
    this.ws = null;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.url = `${protocol}//${window.location.host}/ws`;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this._backoff = null;
    this._connectTimer = null;
    this.listeners = new Map();
    this.messageQueue = [];
    this._outbox = createPortalOutbox(this);
    this.isConnected = false;
    this._lastServerActivity = 0;
    this._staleCheckInterval = null;
    this._sessionState = null;
    // Distinguishes intentional disconnect() from network/server drop so
    // onclose can suppress the auto-reconnect on the former. Cleared in
    // connect() so a later reconnect path works after a disconnect()→
    // connect() cycle. (#112 FE-FIX-007)
    this._intentionalClose = false;
  }

  /**
   * Is this portal background plumbing? A quiet portal announces itself
   * NOWHERE — no status badge, and no chime. Read by the stream handlers,
   * which own the arrival sound and cannot see the constructor's option.
   * @returns {boolean}
   */
  isQuiet() {
    return this._quiet === true;
  }

  /**
   * Open the WebSocket connection with auth token from localStorage.
   * On reconnect, sends portal:resume with session state.
   * On first connect, sends companion manifest.
   * No-ops if already connected. Defers if no auth token is available.
   */
  connect() {
    // CONNECTING counts as taken: a second connect() during the handshake
    // window (React re-mount effects fire ~ms apart) would replace this.ws
    // and orphan the first socket — a zombie portal connection that stays
    // open server-side, holding its own unbound session state.
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      console.log('WebSocket already connected');
      return;
    }

    // Retrieve auth token for WebSocket authentication
    const token = sessionStorage.getItem('authToken');
    if (!token) {
      console.warn('No auth token — WebSocket connection deferred until authenticated');
      return;
    }

    // Re-entry from any caller resets the intentional-close flag so the
    // unexpected-drop path (network/server) is re-armed. Without this, a
    // disconnect() followed by connect() would still suppress reconnect
    // on the next unexpected drop. (#112 FE-FIX-007)
    this._intentionalClose = false;

    console.log('Connecting to WebSocket...');

    // Phase 0.2 — visible status indicator during the handshake wait
    if (!this._quiet) setStatus('Connecting to the void...');

    this._socketWallet = localStorage.getItem('walletAddress');
    // which operator state this desk is — its notices and history follow it (operator-state.js)
    this._declaredState = currentEntryMode();
    this.ws = new WebSocket(`${this.url}?token=${encodeURIComponent(token)}&state=${this._declaredState}`);

    // THE HANDSHAKE WATCHDOG: a tunnel that swallows the upgrade never fires
    // onopen OR onclose — the socket sits CONNECTING forever and no retry is
    // ever scheduled. Force it shut so onclose runs the ordinary path.
    this._clearConnectTimer();
    this._connectTimer = setTimeout(() => {
      if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
        console.warn(`WebSocket handshake did not complete in ${CONNECT_MS}ms — forcing close`);
        this.ws.close();
      }
    }, CONNECT_MS);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this._clearConnectTimer();
      this.isConnected = true;
      this._lastServerActivity = Date.now();
      this._startStaleCheck();

      // Phase 0.2 — brief "connected" flash, then dismiss
      if (!this._quiet) {
        setStatus('Portal established', 'ok');
        setTimeout(() => clearStatus(), 1200);
      }

      const isReconnect = this.reconnectAttempts > 0;
      // Only count the connection as healthy after it survives a beat —
      // a server that accepts the socket and immediately rejects it
      // (auth failure) must not reset the retry budget, or the loop
      // never ends
      this._stableTimer = setTimeout(() => {
        this.reconnectAttempts = 0;
        this._backoff = null;
        this._slowCycle = false;
      }, 5000);
      this.emit('connection');

      // On reconnect with session state, attempt resume
      if (this._sessionState?.sessionId || (isReconnect && this._sessionState)) {
        this.send('portal:resume', { ...this._sessionState });
      } else if (this._sessionState) {
        // First connect with a held binding — THIS WINDOW's truth (F-01).
        // Never re-read the shared last-used key here: a companion switch
        // in a sibling window must not rebind this one on connect.
        this.send('companion:manifest', {
          companion: this._sessionState.companionName || 'Unknown',
          neumaId: this._sessionState.neumaId || null,
        });
      } else {
        // Brand-new window, nothing held — seed from the window-first
        // resolution (spawn seed, then shared last-used).
        const companion = resolveBoundCompanion();
        if (companion) {
          const name = companion.name || 'Unknown';
          const neumaId = companion.neumaId || null;
          this._sessionState = { neumaId, companionName: name, sessionId: null };
          this.send('companion:manifest', { companion: name, neumaId });
        }
      }

      // Send queued messages
      this.flushMessageQueue();
    };

    this.ws.onmessage = (event) => {
      this._lastServerActivity = Date.now();
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(data);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      if (!this._quiet) setStatus('Portal disrupted', 'error');
      this.emit('error', error);
    };

    this.ws.onclose = (event) => {
      console.log('WebSocket disconnected', event.code);
      this._clearConnectTimer();
      this.isConnected = false;
      this._stopStaleCheck();
      if (this._stableTimer) {
        clearTimeout(this._stableTimer);
        this._stableTimer = null;
      }

      // 4001 = the portal rejected our session token. Reconnecting with
      // the same dead token loops forever — clear it and surface the
      // need to re-sign instead.
      this._outbox.invalidate();
      if (event.code === 4003) {
        this._intentionalClose = true;
        sessionStorage.removeItem('authToken');
        if (!this._quiet) setStatus('Phone access ended — pair again from your desktop', 'error');
        this.emit('auth_expired');
        this.emit('disconnection');
        return;
      }
      if (event.code === 4001) {
        sessionStorage.removeItem('authToken');
        if (!this._quiet) setStatus('Session expired — reconnect your wallet', 'error');
        this.emit('auth_expired');
        this.emit('disconnection');
        return;
      }

      // Intentional disconnect() — no auto-reconnect, no "Reconnecting…"
      // status. The user explicitly closed it; honor that.
      // (#112 FE-FIX-007 — the load-bearing gate that was missing.)
      //
      // And no BADGE either. The only caller of disconnect() is a stream
      // window unmounting, so this path has never meant "the portal closed" —
      // it means the operator shut one chat window, and the window vanishing is
      // already the feedback. It announced itself as a portal-level event on a
      // status indicator that is GLOBAL to the desk (one DOM node), so closing
      // a second stream painted a notice across the primary window's chrome.
      //
      // It also never went away: 'Portal established' clears itself after
      // 1200ms (above), and this was the one 'ok' status that forgot to. So the
      // badge sat there permanently, over the Explorer, until a reload.
      //
      // clearStatus rather than nothing, because a window closed mid-connect
      // would otherwise leave […] stranded on screen.
      if (this._intentionalClose) {
        if (!this._quiet) clearStatus();
        this.emit('disconnection');
        return;
      }

      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        if (!this._quiet) setStatus('Reconnecting to the void...');
      } else {
        // Distinct from the intentional close above, which says nothing at all:
        // this path is an exhausted reconnect budget, not the operator's own
        // choice (#135). A link that died on its own is the one case here that
        // genuinely owes the operator a word.
        if (!this._quiet) setStatus('Portal severed', 'error');
      }
      this.emit('disconnection');

      // Attempt to reconnect (unexpected-drop path only — intentional
      // closes returned above before reaching here)
      this.reconnect();
    };
  }

  /**
   * Attempt reconnection with exponential backoff (1s doubling to 15s,
   * reset once a link proves stable). After maxReconnectAttempts the fast
   * budget is spent and a slow re-link cycle takes over — never abandoned.
   */
  reconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      // Fast budget spent — never abandon the link. Drop to a slow
      // re-link cycle so a server that comes back is found again.
      if (!this._slowCycle) {
        this._slowCycle = true;
        console.warn('Fast reconnect budget exhausted — slow re-link cycle');
        this.emit('reconnect_failed');
      }
      if (!this._quiet) setStatus('Portal severed — re-linking…', 'error');
      setTimeout(() => this.connect(), 20_000);
      return;
    }

    this.reconnectAttempts++;
    this._backoff = nextBackoff(this._backoff);
    const delay = this._backoff;

    console.log(`Reconnecting in ${delay}ms... (Attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * A page coming back from the background (a phone unlocking). A socket the
   * OS froze can sit OPEN having heard nothing for minutes with no close
   * event ever arriving; one that died is simply gone. Either way the
   * ordinary reconnect path is the cure: close the silent zombie so onclose
   * runs, or connect if nothing is there. A recently-heard socket is left be.
   */
  nudge() {
    const state = this.ws?.readyState;
    if (state === WebSocket.CONNECTING) return;
    if (state === WebSocket.OPEN) {
      if (Date.now() - this._lastServerActivity > NUDGE_SILENCE_MS) {
        console.warn('Socket silent since before the page went to sleep — forcing reconnect');
        this.ws.close();
      }
      return;
    }
    this.connect();
  }

  /** ENTER AS crossed into another operator state: re-link once, declaring it —
   *  the server sends a state's notices and tray history by the word a socket
   *  connected with (core/runtime/operator-state.js). @param {'harness'|'full'} state */
  relinkFor(state) {
    if (!this.ws || this._declaredState === state) return;
    this.disconnect();
    this.connect();
  }

  /**
   * Close the WebSocket connection intentionally — no auto-reconnect.
   * Sets _intentionalClose so the socket's own onclose handler
   * recognizes this as user-initiated and skips the reconnect path.
   * A subsequent connect() re-arms the unexpected-drop path.
   * (#112 FE-FIX-007)
   */
  disconnect() {
    this._intentionalClose = true;
    this._outbox.invalidate();
    this._stopStaleCheck();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    }
  }

  /**
   * Send a message through the WebSocket. Queues if not connected.
   * Each message gets a unique messageId for deduplication on reconnect.
   * @param {string} type - Message type (e.g. 'companion:manifest', 'chat:message')
   * @param {object} [payload={}] - Message payload (merged flat with type and timestamp)
   */
  send(type, payload = {}) {
    const messageId = crypto.randomUUID();
    // The desk's IANA zone rides every navigation frame (2026-09-25 — every
    // clock a being reads renders on the operator's wall, not the machine's).
    // Stamped at this one seam so no bind path can forget it; the server
    // validates the zone and fails closed to the machine's own.
    const navigation = ['companion:manifest', 'portal:resume', 'portal:new-session'].includes(type);
    const framed = navigation
      ? { ...payload, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
      : payload;
    const message = { type, ...framed, messageId, timestamp: Date.now() };
    if (navigation) this._outbox.navigate(type, framed);
    if (type === 'consciousness:stream' && (!this.isConnected || this.ws?.readyState !== WebSocket.OPEN)) {
      void this._outbox.queue(message);
      return;
    }


    if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      // Queue message for when connection is established (messageId stable through queue)
      this.messageQueue.push(message);
      console.log('Message queued (not connected):', type);
    }
  }

  /** Send all queued messages that accumulated while disconnected. */
  flushMessageQueue() {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      this.ws.send(JSON.stringify(message));
    }
    void this._outbox.flush();
  }

  _clearConnectTimer() {
    if (this._connectTimer) {
      clearTimeout(this._connectTimer);
      this._connectTimer = null;
    }
  }

  /**
   * Route an incoming message to type-specific and general listeners.
   * @param {object} data - Parsed message with `type` field
   */
  handleMessage(data) {
    // Emit to specific listeners - pass the whole data object (not just payload)
    this.emit(data.type, data);

    // Emit to general message listeners
    this.emit('message', data);
    if (data.type === 'portal:resumed') this._outbox.confirm(data);
  }

  /**
   * Store session state for reconnection resume.
   * Components should call this when companion loads or session is established.
   * @param {{ neumaId?: string, sessionId?: string, companionName?: string, connectionId?: string }} state
   */
  setSessionState(state) {
    if (this._sessionState?.neumaId !== state?.neumaId || this._sessionState?.sessionId !== state?.sessionId) this._outbox.invalidate();
    this._sessionState = state ? { ...state } : null;
    // SESSION TABS: a tab has to learn which sitting it is holding, and the
    // binding changes on paths that never reach a completed turn — a being
    // switch, a resume, a fresh mint. Announcing it here means the strip reads
    // the binding at the moment it moves instead of inferring it later.
    // Local-only: no server frame carries this type.
    this.emit('session:state', this._sessionState ? { ...this._sessionState } : null);
  }

  /**
   * Read the held session state (or null). Callers that re-declare identity
   * (e.g. relink entry) use this to carry the bound sessionId forward
   * instead of clobbering it.
   * @returns {{ neumaId?: string, sessionId?: string, companionName?: string } | null}
   */
  getSessionState() {
    return this._sessionState ? { ...this._sessionState } : null;
  }

  /**
   * Register an event listener.
   * @param {string} event - Event name (message type or 'connection'/'disconnection'/'message')
   * @param {Function} callback - Listener function
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  /**
   * Remove an event listener.
   * @param {string} event - Event name
   * @param {Function} callback - Listener to remove
   */
  off(event, callback) {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event);
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * Emit an event to all registered listeners.
   * @param {string} event - Event name
   * @param {*} [data] - Data to pass to listeners
   */
  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error);
        }
      });
    }
  }

  // --- Stale connection detection ---

  /**
   * Start checking for stale server activity. Default 45s, but callers
   * can pause via pauseStaleCheck() during birth ceremonies where the
   * user is reading stage responses before clicking CONTINUE.
   */
  _startStaleCheck() {
    this._stopStaleCheck();
    this._staleCheckPaused = false;
    this._staleCheckInterval = setInterval(() => {
      if (this._staleCheckPaused) return;
      if (Date.now() - this._lastServerActivity > 120_000) {
        console.warn('Server activity stale (>120s) — forcing reconnect');
        if (this.ws) this.ws.close();
      }
    }, 15_000);
  }

  /** Pause the stale check (e.g. during birth ceremony reading time). */
  pauseStaleCheck() { this._staleCheckPaused = true; }

  /** Resume the stale check after pausing. */
  resumeStaleCheck() {
    this._staleCheckPaused = false;
    this._lastServerActivity = Date.now();
  }

  /** Stop the stale check interval. */
  _stopStaleCheck() {
    if (this._staleCheckInterval) {
      clearInterval(this._staleCheckInterval);
      this._staleCheckInterval = null;
    }
  }
}
