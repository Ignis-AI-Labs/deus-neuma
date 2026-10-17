// use-projects.js — impure hook owning the desk's project state.
//
// Single source of truth: fetches the wallet's projects + active id, and
// exposes actions that mutate on the backend then refetch. Lives at the desk
// host and is shared via ProjectContext so every window sees one state.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listProjects, createProject, deleteProject, activateProject, pinChat, unpinChat,
  addSharedFile, removeSharedFile,
  resolveFolder, attachFolder, detachFolder, setWorkingFolder, reconnectFolder,
} from '../../../services/user-projects.js';

export const useProjectsState = () => {
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { projects: list, activeProjectId: active } = await listProjects();
      setProjects(list || []);
      setActiveProjectId(active ?? null);
    } catch {
      // Unauthenticated or offline — leave state empty; surfaces show no projects.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Mutations throw on failure so the caller can surface the reason; on success
  // they refetch so every window updates from one fetched truth.
  // create returns the created project — callers that activate it next (the
  // open-folder flow) need its id, and a refetch alone can't say which is new.
  const create = useCallback(async (name, folder, opts) => {
    const { project } = await createProject(name, folder, opts);
    await refresh();
    return project;
  }, [refresh]);
  const remove = useCallback(async (id) => { await deleteProject(id); await refresh(); }, [refresh]);
  const activate = useCallback(async (id) => { await activateProject(id); await refresh(); }, [refresh]);
  const pin = useCallback(async (id, chat) => { await pinChat(id, chat); await refresh(); }, [refresh]);
  const unpin = useCallback(async (id, sessionId, neumaId) => { await unpinChat(id, sessionId, neumaId); await refresh(); }, [refresh]);
  const addFile = useCallback(async (id, filePath) => { await addSharedFile(id, filePath); await refresh(); }, [refresh]);
  const removeFile = useCallback(async (id, filePath) => { await removeSharedFile(id, filePath); await refresh(); }, [refresh]);

  // Folder attachment + the working folder (cwd). resolve is a read (no refetch);
  // the mutators refetch so folders/cwd stay one fetched truth across windows.
  const resolve = useCallback(async (folderPath) => (await resolveFolder(folderPath)).binding, []);
  const attachFolder_ = useCallback(async (id, folderPath) => { await attachFolder(id, folderPath); await refresh(); }, [refresh]);
  const detachFolder_ = useCallback(async (id, folderPath) => { await detachFolder(id, folderPath); await refresh(); }, [refresh]);
  const setCwd = useCallback(async (id, folderPath) => { await setWorkingFolder(id, folderPath); await refresh(); }, [refresh]);
  const reconnect = useCallback(async (id, folderPath) => { await reconnectFolder(id, folderPath); await refresh(); }, [refresh]);

  // One value per real change — the desk re-renders every streamed frame.
  return useMemo(() => ({
    projects, activeProjectId, activeProject: projects.find((p) => p.id === activeProjectId) ?? null, loading, refresh,
    create, remove, activate, pin, unpin, addFile, removeFile,
    resolve, attachFolder: attachFolder_, detachFolder: detachFolder_, setCwd, reconnect,
  }), [projects, activeProjectId, loading, refresh, create, remove, activate, pin, unpin, addFile, removeFile,
    resolve, attachFolder_, detachFolder_, setCwd, reconnect]);
};
