// project-context.js — share the active project across the desk.
//
// A project (folder + terminal cwd + pinned chats) is desk-wide state, like
// the consciousness stream: it lives ABOVE the window manager so every window
// (Files, Chats, Projects, the status strip) reads the same active project and
// reacts when it switches.

import { createContext, useContext } from 'react';

export const ProjectContext = createContext(null);

export const useProjects = () => useContext(ProjectContext);
