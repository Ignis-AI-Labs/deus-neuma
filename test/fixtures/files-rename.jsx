import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { filesApp } from '../../frontend/app/RelinkShell/files/FilesApp.jsx';

const folder = new URLSearchParams(window.location.search).get('folder');
const Files = filesApp.Body;
// The open-folder gesture's own announcement expands the folder, exactly as the
// desk's OPEN FOLDER does (use-open-folder.js). A parent's effect runs after the
// tree's, so its listener is already in place.
const Page = () => {
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('neuma:files-focus-root', { detail: { root: folder } }));
  }, []);
  return <Files focusRoots={[folder]} />;
};
createRoot(document.getElementById('root')).render(<Page />);
