// Actual Explorer rows and HTTP client; this fixture exercises display only.
import { createRoot } from 'react-dom/client';
import { FileNode } from '../../frontend/app/RelinkShell/files/FileNode.jsx';
import { listDir, gitStatus } from '../../frontend/services/user-files.js';

const folder = new URLSearchParams(location.search).get('folder');
try {
  const [entries, status] = await Promise.all([listDir(folder), gitStatus(folder)]);
  createRoot(document.getElementById('root')).render(
    <FileNode entry={{ path: folder, type: 'dir' }} depth={0} isRoot
      expanded={new Set([folder])} childrenMap={{ [folder]: entries }} showHidden={false}
      rootPath={folder} gitFiles={status.files} gitIgnored={status.ignored}
      selected={new Set()} actions={{}} />,
  );
} catch (error) {
  document.getElementById('root').textContent = error.message;
  throw error;
}
