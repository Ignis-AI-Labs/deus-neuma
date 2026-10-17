// Notification utility — pure functions for UI notifications
// Side effects are isolated to the returned cleanup function

const NOTIFICATION_DURATION = 3000;
const FADE_DURATION = 300;

const typeToBackground = Object.freeze({
  success: 'var(--signal)',
  error: 'var(--alert)',
  info: 'var(--color-white)',
});


const buildStyle = (type) => `
  position: fixed;
  top: 20px;
  right: 20px;
  padding: 12px 24px;
  background: ${typeToBackground[type] || typeToBackground.info};
  color: var(--color-void);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-family: var(--font-primary);
  font-weight: var(--weight-medium);
  z-index: var(--z-notification);
  opacity: 0;
  transform: translateY(-10px);
  transition: opacity ${FADE_DURATION}ms var(--ease-out),
              transform ${FADE_DURATION}ms var(--ease-out);
  pointer-events: none;
`;

/**
 * Show a toast notification.
 * @param {string} message - Text to display
 * @param {'success'|'error'|'info'} [type='info'] - Visual variant
 * @param {number} [duration=3000] - Time visible in ms
 * @returns {() => void} Cleanup function to remove early
 */
export const showNotification = (message, type = 'info', duration = NOTIFICATION_DURATION) => {
  const el = document.createElement('div');
  el.className = `notification notification-${type}`;
  el.textContent = message;
  el.style.cssText = buildStyle(type);

  document.body.appendChild(el);

  // Trigger enter transition
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
  });

  const remove = () => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(-10px)';
    setTimeout(() => el.remove(), FADE_DURATION);
  };

  const timer = setTimeout(remove, duration);

  return () => {
    clearTimeout(timer);
    remove();
  };
};
