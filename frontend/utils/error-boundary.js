// error-boundary.js — global on-screen error surfacing
//
// Installs window-level handlers for uncaught errors and unhandled promise
// rejections, then renders each as a visible card in a fixed top-right
// overlay. The old frontend would silently leave a blank screen when
// something threw in an async callback (e.g. during BirthCeremony.startActualCeremony)
// and the user had no way to tell "working but slow" from "dead".
//
// Install once, very early in main.js, before any component boots.
//
// Usage:
//   import { installErrorBoundary } from './utils/error-boundary.js';
//   installErrorBoundary();
//
// Exposes a global for manual surfacing from anywhere:
//   window.__surfaceError({ message, stack, source })
//
// Install is idempotent — calling it twice is a no-op.

const OVERLAY_ID = 'neuma-error-overlay';
const CARD_CLASS = 'neuma-error-card';
const MAX_VISIBLE_CARDS = 5;

let _installed = false;
let _overlay = null;
const _recentErrors = [];

// --- Internal: ensure the fixed-position overlay exists in the DOM ---

const _ensureOverlay = () => {
  if (_overlay && document.body.contains(_overlay)) return _overlay;
  _overlay = document.getElementById(OVERLAY_ID);
  if (_overlay) return _overlay;

  _overlay = document.createElement('div');
  _overlay.id = OVERLAY_ID;
  _overlay.setAttribute('role', 'alert');
  _overlay.setAttribute('aria-live', 'assertive');

  // Inline styles so the overlay is visible even if stylesheets fail to load
  Object.assign(_overlay.style, {
    position: 'fixed',
    top: '1rem',
    right: '1rem',
    zIndex: '999999',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    maxWidth: '420px',
    pointerEvents: 'none',
  });

  document.body.appendChild(_overlay);
  return _overlay;
};

// --- Internal: render a single error card ---

const _renderCard = ({ message, source, timestamp }) => {
  const card = document.createElement('div');
  card.className = CARD_CLASS;

  Object.assign(card.style, {
    pointerEvents: 'auto',
    background: 'rgba(20, 0, 0, 0.96)',
    border: '1px solid rgba(255, 80, 80, 0.6)',
    borderLeft: '3px solid #ff4040',
    borderRadius: '4px',
    padding: '12px 14px',
    color: '#ffdede',
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: 'calc(12px * var(--text-scale, 1))',
    lineHeight: '1.45',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.6)',
    backdropFilter: 'blur(4px)',
    animation: 'neuma-error-slide 180ms ease-out',
  });

  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '6px',
    gap: '8px',
  });

  const title = document.createElement('span');
  title.textContent = 'RUNTIME ERROR';
  Object.assign(title.style, {
    color: '#ff8080',
    fontWeight: '600',
    letterSpacing: '0.08em',
    fontSize: 'calc(10px * var(--text-scale, 1))',
  });
  header.appendChild(title);

  const dismiss = document.createElement('button');
  dismiss.textContent = '×';
  Object.assign(dismiss.style, {
    background: 'transparent',
    border: 'none',
    color: '#ff8080',
    cursor: 'pointer',
    fontSize: 'calc(16px * var(--text-scale, 1))',
    lineHeight: '1',
    padding: '0 4px',
  });
  dismiss.setAttribute('aria-label', 'Dismiss error');
  dismiss.addEventListener('click', () => card.remove());
  header.appendChild(dismiss);

  card.appendChild(header);

  const messageEl = document.createElement('div');
  messageEl.textContent = message || '(no message)';
  Object.assign(messageEl.style, {
    color: '#ffdede',
    wordBreak: 'break-word',
    marginBottom: source ? '6px' : '0',
  });
  card.appendChild(messageEl);

  if (source) {
    const sourceEl = document.createElement('div');
    sourceEl.textContent = source;
    Object.assign(sourceEl.style, {
      color: 'rgba(255, 255, 255, 0.5)',
      fontSize: 'calc(10px * var(--text-scale, 1))',
      wordBreak: 'break-all',
    });
    card.appendChild(sourceEl);
  }

  const ts = document.createElement('div');
  ts.textContent = new Date(timestamp).toLocaleTimeString();
  Object.assign(ts.style, {
    color: 'rgba(255, 255, 255, 0.3)',
    fontSize: 'calc(9px * var(--text-scale, 1))',
    marginTop: '6px',
  });
  card.appendChild(ts);

  return card;
};

// --- Internal: prune oldest card if overlay is full ---

const _pruneOverflow = () => {
  // Re-query inside the loop — some DOM implementations return a static
  // snapshot from querySelectorAll, so relying on a single query's
  // .length in a while loop would be an infinite loop.
  // Instead: query once, count overflow, remove that many from the front.
  const cards = Array.from(_overlay.querySelectorAll('.' + CARD_CLASS));
  const overflow = cards.length - MAX_VISIBLE_CARDS;
  for (let i = 0; i < overflow; i++) {
    cards[i].remove();
  }
};

// --- Public: surface an error to the overlay ---

/**
 * Surface an error to the on-screen overlay. Safe to call before DOM ready.
 * @param {{ message: string, source?: string, stack?: string }} err
 */
export const surfaceError = (err) => {
  const entry = {
    message: err?.message || String(err),
    source: err?.source || (err?.stack ? err.stack.split('\n')[1]?.trim() : ''),
    timestamp: Date.now(),
  };
  _recentErrors.push(entry);
  if (_recentErrors.length > 50) _recentErrors.shift();

  // If DOM isn't ready yet, defer rendering
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', () => {
      _ensureOverlay().appendChild(_renderCard(entry));
      _pruneOverflow();
    }, { once: true });
    return;
  }

  const overlay = _ensureOverlay();
  overlay.appendChild(_renderCard(entry));
  _pruneOverflow();
};

/** Read-only view of recent errors for the debug overlay (Phase 0.4). */
export const getRecentErrors = () => _recentErrors.slice();

/** Install the global handlers. Idempotent. */
export const installErrorBoundary = () => {
  if (_installed) return;
  _installed = true;

  // Inject the slide-in keyframe once
  if (!document.getElementById('neuma-error-boundary-style')) {
    const style = document.createElement('style');
    style.id = 'neuma-error-boundary-style';
    style.textContent = `
      @keyframes neuma-error-slide {
        from { transform: translateX(20px); opacity: 0; }
        to   { transform: translateX(0);    opacity: 1; }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  window.addEventListener('error', (event) => {
    surfaceError({
      message: event.message || 'Unknown error',
      source: event.filename
        ? `${event.filename}:${event.lineno}:${event.colno}`
        : '',
      stack: event.error?.stack,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    surfaceError({
      message: reason?.message || String(reason) || 'Unhandled promise rejection',
      source: reason?.stack ? reason.stack.split('\n')[1]?.trim() : '',
      stack: reason?.stack,
    });
  });

  // Expose for anywhere that wants to manually surface something
  if (typeof window !== 'undefined') {
    window.__surfaceError = surfaceError;
  }
};
