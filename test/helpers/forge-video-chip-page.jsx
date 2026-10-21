// impure - browser fixture: the PRODUCTION ToolChip, fed one forge result (a clip and a still).
/* global window, sessionStorage */
import { createRoot } from 'react-dom/client';
import { ToolChip } from '../../frontend/app/RelinkShell/ToolChip.jsx';

const { token, laneId, video, still } = window.chipFixture;
sessionStorage.setItem('authToken', token);
const media = (imageId, mime) => ({ imageId, mime, laneId, url: `/api/v1/image-forge/images/${imageId}`, path: `/art/images/${imageId}` });
createRoot(document.getElementById('root')).render(
  <ToolChip segment={{
    phase: 'resolved', label: 'image/generate', status: 'ok', summary: 'generated 2 renders',
    images: [media(video, 'video/mp4'), media(still, 'image/png')],
  }} />,
);
