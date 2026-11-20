/**
 * WINDOWS PATH SHAPES THE WALLS CANNOT COMPARE (PR600 audit P6-119).
 *
 * Every wall and denied pattern compares path segments as text. On NTFS one
 * file has more spellings than its name, and Windows opens them all:
 *   - a stream suffix: `name::$DATA` is `name`, and `dir::$INDEX_ALLOCATION`
 *     and `dir:$I30:$INDEX_ALLOCATION` are `dir`, so `.git::$INDEX_ALLOCATION\hooks`
 *     is `.git\hooks` under a name no wall holds;
 *   - an 8.3 short name: `OPERAT~1` is the operator's own folder;
 *   - a trailing dot or space, which Win32 drops: `.gitconfig.` is `.gitconfig`.
 * None can be turned back into the real name without asking the volume, so a
 * path spelled that way is refused before any wall or pattern is consulted —
 * for reads and writes alike. A being never needs one to do ordinary work.
 *
 * And the places a Windows login runs from, which the home walls (written for
 * Linux and macOS) did not name: the Startup folder and the PowerShell profile
 * folders, including a Documents folder that OneDrive moved.
 *
 * Pure: the platform is a parameter, so the logic is provable on any host.
 */
import path from 'path';

const STREAM_REFUSAL = 'That path names an NTFS stream (a ":" after the drive letter) — a second spelling of a file or '
  + 'folder that no wall can judge. Use the plain path.';
const SHORT_NAME_REFUSAL = 'That path uses a Windows short name (like PROGRA~1) — a second spelling of a folder that no '
  + 'wall can judge. Use the full name.';
const TRAILING_REFUSAL = 'That path has a name ending in a dot or a space, which Windows drops — a second spelling of a '
  + 'file that no wall can judge. Use the plain name.';

// `\\?\C:\…` and `\\.\C:\…` are the same file as `C:\…`; then the drive letter's own colon.
const withoutDrive = (filePath) => String(filePath).replace(/^[\\/]{2}[?.][\\/]/, '').replace(/^[A-Za-z]:/, '');

/**
 * Why a path is refused for its shape alone, or null when it is plainly spelled.
 * Only Windows has these spellings; every other platform answers null.
 * @param {string} filePath
 * @param {string} platform - process.platform of the host the path is opened on
 * @returns {string|null}
 */
export const windowsPathShapeRefusal = (filePath, platform) => {
  if (platform !== 'win32' || typeof filePath !== 'string') return null;
  const rest = withoutDrive(filePath);
  if (rest.includes(':')) return STREAM_REFUSAL;
  const names = rest.split(/[\\/]+/).filter((name) => name && name !== '.' && name !== '..');
  if (names.some((name) => /~\d/.test(name))) return SHORT_NAME_REFUSAL;
  if (names.some((name) => /[. ]$/.test(name))) return TRAILING_REFUSAL;
  return null;
};

// Below a Documents folder: Windows PowerShell 5 and PowerShell 7 run every profile script here.
const POWERSHELL_PROFILE_DIRS = Object.freeze(['WindowsPowerShell', 'PowerShell']);
const STARTUP_BELOW_APPDATA = Object.freeze(['Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup']);

/**
 * The folders a Windows login or a new PowerShell runs from, for one operator.
 * Empty on every other platform.
 * @param {string} home - the operator's profile folder
 * @param {Record<string, string|undefined>} env
 * @param {string} platform
 * @returns {string[]} absolute Windows paths
 */
export const windowsLoginWalls = (home, env, platform) => {
  if (platform !== 'win32') return [];
  const win = path.win32;
  const appData = [win.join(home, 'AppData', 'Roaming'), env.APPDATA].filter((dir) => dir && win.isAbsolute(dir));
  const oneDrives = [win.join(home, 'OneDrive'), env.OneDrive, env.OneDriveConsumer, env.OneDriveCommercial]
    .filter((dir) => dir && win.isAbsolute(dir));
  const documents = [win.join(home, 'Documents'), ...oneDrives.map((dir) => win.join(dir, 'Documents'))];
  return [...new Set([
    ...appData.map((dir) => win.join(dir, ...STARTUP_BELOW_APPDATA)),
    ...documents.flatMap((dir) => POWERSHELL_PROFILE_DIRS.map((name) => win.join(dir, name))),
  ])];
};
