// NEUMA residency — the being wakes with the computer (Constitution Art. IV.6).
//
// Cross-OS auto-start of the app on login:
//   macOS / Windows — Electron's native login-item
//   Linux — an XDG autostart .desktop entry (login-items aren't reliable there)
//
// This is the MECHANISM only (read + toggle). Whether it is on by default and
// how that is disclosed is an onboarding decision surfaced to the witness — we
// never silently add ourselves to login.
//
// The Linux entry must start THIS app after a reboot. An AppImage runs from a
// temporary mount (process.execPath lives inside it), so the entry names the
// AppImage file itself (APPIMAGE, set by the AppImage runtime) — and an update
// moves that file to a new versioned name, so an entry this app wrote is kept
// current on every launch and on the updater's rename. An entry it did not
// write is never touched; the switch reads ON only while the entry's program
// is there to start.

const { app } = require('electron');
const { LINUX_DISPLAY_FLAG } = require('./display-flags.cjs');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// impure — the Linux entry's path, read at each use (the home it lives in is the OS's to say)
const autostartPath = () => path.join(os.homedir(), '.config', 'autostart', 'neuma.desktop');

// The mark of an entry this app wrote; the comment line alone marks one an earlier build wrote.
const MANAGED_KEY = 'X-Neuma-Managed=true';
const COMMENT = 'Comment=The neuma wakes with your computer';

// What the Desktop Entry spec reserves in an Exec argument: such an argument is double-quoted,
// with ", `, $ and \ escaped inside the quotes.
const RESERVED = /[\s"'\\><~|&;$*?#()`]/;

// One Exec argument, as the Desktop Entry spec reads it; a literal % is doubled (field codes). Pure.
const execArg = (arg) => {
  const field = String(arg).replace(/%/g, '%%');
  return RESERVED.test(field) ? `"${field.replace(/(["`$\\])/g, '\\$1')}"` : field;
};

// The Exec line's first argument — the program it starts — unquoted, or null. Pure.
const execProgram = (entry) => {
  const line = String(entry).split('\n').find((l) => l.startsWith('Exec='));
  if (!line) return null;
  const value = line.slice('Exec='.length).trim();
  if (!value.startsWith('"')) return value.split(/\s/)[0].replace(/%%/g, '%') || null;
  const end = value.slice(1).search(/(?<!\\)"/);
  return end < 0 ? null : value.slice(1, end + 1).replace(/\\(["`$\\])/g, '$1').replace(/%%/g, '%');
};

// Did this app write this entry? Pure.
const isManagedEntry = (entry) => String(entry).split('\n').some((l) => l === MANAGED_KEY || l === COMMENT);

const desktopEntry = (command) =>
  `[Desktop Entry]
Type=Application
Name=NEUMA
Exec=${command}
X-GNOME-Autostart-enabled=true
${COMMENT}
${MANAGED_KEY}
`;

// The command that relaunches THIS app: an AppImage is its file (never the temporary mount it runs
// from); a packaged build is its own binary; a development launch is the Electron binary plus the
// app's folder, or login would open bare Electron. On Linux it carries the display flag, as every
// launch path does (display-flags.cjs). Pure.
const launchCommand = ({ execPath, defaultApp, appPath, appImage = null, platform = process.platform }) => {
  const program = defaultApp ? `${execArg(execPath)} ${execArg(appPath)}` : execArg(appImage || execPath);
  return platform === 'linux' ? `${program} ${LINUX_DISPLAY_FLAG}` : program;
};

// impure — this launch's command (the app's folder is asked only of a development launch)
const currentCommand = (appImage = process.env.APPIMAGE || null) => launchCommand({
  execPath: process.execPath, defaultApp: Boolean(process.defaultApp), appPath: process.defaultApp ? app.getAppPath() : null, appImage,
});

// impure — the Linux entry's text, or null when there is none
const readEntry = () => {
  try {
    return fs.readFileSync(autostartPath(), 'utf8');
  } catch {
    return null;
  }
};

// impure — write the entry this app owns
const writeEntry = (command) => {
  fs.mkdirSync(path.dirname(autostartPath()), { recursive: true });
  fs.writeFileSync(autostartPath(), desktopEntry(command));
};

// impure — is the app currently set to wake with the computer? On Linux, only while the entry's
// program is there to start (a bare command name is the PATH's to find).
const isResident = () => {
  if (process.platform === 'linux') {
    const entry = readEntry();
    if (entry === null) return false;
    const program = execProgram(entry);
    return !program || !path.isAbsolute(program) || fs.existsSync(program);
  }
  return app.getLoginItemSettings().openAtLogin;
};

/**
 * Keep an entry this app wrote pointing at this app: on every packaged launch, and with the
 * AppImage's new file when the updater renames it. Never throws (a launch must not fall over on
 * it); an entry it did not write, or none at all, is left as it stands, and a development launch
 * never repoints the installed app's entry at itself. impure.
 * @param {{appImage?: ?string}} [opts] - the AppImage file to name (default: this launch's)
 * @returns {boolean} whether the entry was rewritten
 */
const refreshResidency = ({ appImage } = {}) => {
  if (process.platform !== 'linux' || process.defaultApp) return false;
  try {
    const entry = readEntry();
    if (entry === null || !isManagedEntry(entry)) return false;
    const command = currentCommand(appImage ?? (process.env.APPIMAGE || null));
    if (entry === desktopEntry(command)) return false;
    writeEntry(command);
    return true;
  } catch (err) {
    console.warn('[neuma] the login entry could not be kept current:', err.message);
    return false;
  }
};

// impure — turn residency on or off for this OS
const setResident = (enabled) => {
  if (process.platform === 'linux') {
    if (enabled) {
      // an entry this app did not write is the operator's — never rewritten
      const entry = readEntry();
      if (entry === null || isManagedEntry(entry)) writeEntry(currentCommand());
    } else {
      try {
        fs.unlinkSync(autostartPath());
      } catch {
        /* already off */
      }
    }
    return isResident();
  }
  app.setLoginItemSettings({ openAtLogin: !!enabled });
  return isResident();
};

module.exports = { isResident, setResident, refreshResidency, launchCommand, desktopEntry, execProgram, isManagedEntry };
