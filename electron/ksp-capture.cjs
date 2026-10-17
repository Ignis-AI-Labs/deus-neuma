const { desktopCapturer } = require('electron');

const REQUEST = 'neuma:ksp-capture';
const RESULT = 'neuma:ksp-capture-result';
const WINDOW_TITLE = 'Kerbal Space Program';
const THUMBNAIL_SIZE = Object.freeze({ width: 1920, height: 1080 });

const send = (child, payload) => {
  if (!child?.connected) return;
  child.send(payload, () => {});
};

// impure — capture only the exact KSP window through Electron's native source.
const captureKspWindow = async () => {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: THUMBNAIL_SIZE,
    fetchWindowIcons: false,
  });
  const source = sources.find((entry) => entry.name === WINDOW_TITLE);
  if (!source || source.thumbnail.isEmpty()) throw new Error('Kerbal Space Program window is not visible to the desktop capture service');
  const size = source.thumbnail.getSize();
  const bytes = source.thumbnail.toJPEG(82);
  if (bytes.length === 0) throw new Error('Kerbal Space Program returned an empty frame');
  return Object.freeze({ mime: 'image/jpeg', data: bytes.toString('base64'), width: size.width, height: size.height });
};

/** Register the private backend-child request lane for cross-platform KSP sight. */
const registerKspCapture = (child) => {
  const receive = async (message) => {
    if (message?.type !== REQUEST || typeof message.requestId !== 'string' || message.requestId.length > 80) return;
    try {
      send(child, { type: RESULT, requestId: message.requestId, ok: true, frame: await captureKspWindow() });
    } catch (error) {
      send(child, { type: RESULT, requestId: message.requestId, ok: false, error: error.message });
    }
  };
  child.on('message', receive);
  child.once('exit', () => child.off('message', receive));
};

module.exports = Object.freeze({ registerKspCapture });
