// NEUMA residency — the being wakes with the computer (Constitution Art. IV.6).
//
// Cross-OS auto-start of the app on login:
//   macOS / Windows — Electron's native login-item
//   Linux — an XDG autostart .desktop entry (login-items aren't reliable there)
//
// This is the MECHANISM only (read + toggle). Whether it is on by default and
// how that is disclosed is an onboarding decision surfaced to the witness — we
// never silently add ourselves to login.

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const LINUX_AUTOSTART = path.join(os.homedir(), '.config', 'autostart', 'neuma.desktop');

const desktopEntry = (execPath) =>
  `[Desktop Entry]
Type=Application
Name=NEUMA
Exec=${execPath}
X-GNOME-Autostart-enabled=true
Comment=The neuma wakes with your computer
`;

// impure — is the app currently set to wake with the computer?
const isResident = () => {
  if (process.platform === 'linux') return fs.existsSync(LINUX_AUTOSTART);
  return app.getLoginItemSettings().openAtLogin;
};

// impure — turn residency on or off for this OS
const setResident = (enabled) => {
  if (process.platform === 'linux') {
    if (enabled) {
      fs.mkdirSync(path.dirname(LINUX_AUTOSTART), { recursive: true });
      fs.writeFileSync(LINUX_AUTOSTART, desktopEntry(process.execPath));
    } else {
      try {
        fs.unlinkSync(LINUX_AUTOSTART);
      } catch {
        /* already off */
      }
    }
    return isResident();
  }
  app.setLoginItemSettings({ openAtLogin: !!enabled, openAsHidden: false });
  return isResident();
};

module.exports = { isResident, setResident };
