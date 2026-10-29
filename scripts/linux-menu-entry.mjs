// linux-menu-entry.mjs — the menu entry the rpm and deb install as
// /usr/share/applications/neuma.desktop. One text for both packages; it
// carries the display flag every Linux launch path passes
// (electron/display-flags.cjs).
import displayFlags from '../electron/display-flags.cjs';

/**
 * The .desktop text for an installed package. Pure.
 * @param {string} description - package.json's description
 * @returns {string}
 */
export const menuEntry = (description) => `[Desktop Entry]
Type=Application
Name=NEUMA
Comment=${description}
Exec=neuma ${displayFlags.LINUX_DISPLAY_FLAG} %U
Icon=neuma
Categories=Utility;
Terminal=false
StartupWMClass=NEUMA
`;
