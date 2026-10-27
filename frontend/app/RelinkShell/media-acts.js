// media-acts — what the media menu's items DO to the page (impure, every one).
//
// The menu's decisions are pure (media-menu.js); these are the browser calls
// behind them. Each one that the browser only grants inside a user gesture
// (full screen, picture in picture, play, the clipboard) is called
// SYNCHRONOUSLY from the menu's click — an await before it would spend the
// gesture and the browser would refuse.

/**
 * impure — the live state of a clip's player, or null when there is no player.
 * @param {HTMLVideoElement|null} video
 */
export const playerStateOf = (video) => {
  if (!video) return null;
  const pipAllowed = typeof document !== 'undefined' && document.pictureInPictureEnabled === true
    && typeof video.requestPictureInPicture === 'function' && !video.disablePictureInPicture;
  return {
    paused: video.paused,
    muted: video.muted,
    loop: video.loop,
    controls: video.controls,
    rate: video.playbackRate,
    pip: pipAllowed,
    pipOn: pipAllowed && document.pictureInPictureElement === video,
  };
};

/**
 * impure — the player a gesture landed on: the element itself, or the one
 * clip inside it (a card's frame, a wrapping button).
 * @param {Element|null} el
 * @returns {HTMLVideoElement|null}
 */
export const playerIn = (el) => {
  if (!el || typeof HTMLVideoElement === 'undefined') return null;
  if (el instanceof HTMLVideoElement) return el;
  const inner = el.querySelector?.('video');
  return inner instanceof HTMLVideoElement ? inner : null;
};

/** impure — does this page's clipboard take pictures? */
export const clipboardTakesImages = () => typeof ClipboardItem === 'function'
  && typeof navigator !== 'undefined' && typeof navigator.clipboard?.write === 'function';

/** impure — does this page allow full screen? */
export const fullscreenAllowed = () => typeof document !== 'undefined' && document.fullscreenEnabled === true;

/**
 * impure — act on a clip's player. Returns a promise for the acts the browser
 * answers asynchronously (play, picture in picture, full screen).
 * @param {HTMLVideoElement} video
 * @param {'play'|'mute'|'loop'|'controls'|'pip'|'full-screen'} id
 */
export const actOnPlayer = (video, id) => {
  switch (id) {
    case 'play': return video.paused ? video.play() : Promise.resolve(video.pause());
    case 'mute': video.muted = !video.muted; return Promise.resolve();
    case 'loop': video.loop = !video.loop; return Promise.resolve();
    case 'controls': video.controls = !video.controls; return Promise.resolve();
    case 'pip': return document.pictureInPictureElement === video
      ? document.exitPictureInPicture()
      : video.requestPictureInPicture();
    case 'full-screen': return video.requestFullscreen();
    default: return Promise.resolve();
  }
};

/**
 * impure — hand the bytes over as a download under `name` (the desktop app
 * asks where to save it, as the press's PDFs do).
 * @param {string} src
 * @param {string} name
 */
export const downloadFrom = (src, name) => {
  const a = Object.assign(document.createElement('a'), { href: src, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
};

// impure — the clipboard holds pictures as PNG only, so any other format is
// redrawn into one first.
const pngOf = async (src) => {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`the image did not load (${res.status})`);
  const blob = await res.blob();
  if (blob.type === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return new Promise((resolve, reject) => canvas.toBlob(
    (png) => (png ? resolve(png) : reject(new Error('the image could not be drawn'))), 'image/png',
  ));
};

/**
 * impure — put the picture itself on the clipboard. The write is started at
 * once with the bytes still on their way (ClipboardItem takes a promise), so
 * the menu's click is the gesture that grants it.
 * @param {string} src
 */
export const copyImageFrom = (src) => navigator.clipboard.write([new ClipboardItem({ 'image/png': pngOf(src) })]);
