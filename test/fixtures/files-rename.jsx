import React from 'react';
import { createRoot } from 'react-dom/client';
import { filesApp } from '../../frontend/app/RelinkShell/files/FilesApp.jsx';
import { ProjectContext } from '../../frontend/app/RelinkShell/projects/project-context.js';

const folder = new URLSearchParams(window.location.search).get('folder');
const Files = filesApp.Body;
createRoot(document.getElementById('root')).render(
  <ProjectContext.Provider value={{ activeProject: { folder } }}>
    <Files focusRoots={[folder]} />
  </ProjectContext.Provider>,
);
