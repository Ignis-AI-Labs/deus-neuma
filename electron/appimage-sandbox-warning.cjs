// The AppImage launcher can prove only that Chromium's user-namespace sandbox
// cannot start. Its native shell must make the reduced isolation visible too.
const needsAppImageSandboxWarning = (env = process.env, platform = process.platform) =>
  platform === 'linux' && Boolean(env.APPIMAGE) && env.NEUMA_APPIMAGE_NO_SANDBOX === '1';

// impure (native dialog)
const showAppImageSandboxWarning = async ({ dialog, env = process.env }) => {
  if (!needsAppImageSandboxWarning(env)) return false;
  await dialog.showMessageBox({
    type: 'warning',
    title: 'Deus Neuma — reduced Chromium sandbox',
    message: 'Chromium\'s sandbox is off for this AppImage session.',
    detail: 'This system does not allow unprivileged user namespaces. Install the .deb or .rpm to keep Chromium\'s sandbox on.',
    buttons: ['CONTINUE'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return true;
};

module.exports = { needsAppImageSandboxWarning, showAppImageSandboxWarning };
