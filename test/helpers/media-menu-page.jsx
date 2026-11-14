// impure - browser fixture: the PRODUCTION media menu host, a PRODUCTION ToolChip carrying one forge
// clip and one still (with their real paths on disk), the PRODUCTION gallery body (mounted when the
// window manager opens it) and the PRODUCTION Files tree — all over real routes, no fake transport.
/* global window, sessionStorage, document */
import { createRoot } from 'react-dom/client';
import { ToolChip } from '../../frontend/app/RelinkShell/ToolChip.jsx';
import { MediaMenuHost } from '../../frontend/app/RelinkShell/MediaMenuHost.jsx';
import { galleryApp } from '../../frontend/app/RelinkShell/gallery/GalleryApp.jsx';
import { filesApp } from '../../frontend/app/RelinkShell/files/FilesApp.jsx';
import { WindowManager } from '../../frontend/app/windowing/WindowManager.jsx';
import { useWindows } from '../../frontend/app/windowing/use-windows.js';
import { appIdOf } from '../../frontend/app/windowing/window-manager-reducer.js';

const { token, laneId, video, still, videoPath, stillPath } = window.menuFixture;
sessionStorage.setItem('authToken', token);
const media = (imageId, mime, path) => ({ imageId, mime, laneId, url: `/api/v1/image-forge/images/${imageId}`, path });

// The desk's window layer draws a window's Body; here the Body itself stands, once the manager holds it.
const GalleryWhenOpen = () => {
  const windows = useWindows();
  const open = windows.state.windows.some((w) => appIdOf(w.id) === 'gallery');
  return open ? <section id="gallery-window"><galleryApp.Body /></section> : null;
};

createRoot(document.getElementById('root')).render(
  <WindowManager registry={{ gallery: galleryApp }}>
    <MediaMenuHost />
    <ToolChip segment={{
      phase: 'resolved', label: 'image/generate', status: 'ok', summary: 'generated 2 renders',
      images: [media(video, 'video/mp4', videoPath), media(still, 'image/png', stillPath)],
    }} />
    <aside id="explorer"><filesApp.Body /></aside>
    <GalleryWhenOpen />
  </WindowManager>,
);
