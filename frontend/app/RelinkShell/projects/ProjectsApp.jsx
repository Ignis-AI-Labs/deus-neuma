// ProjectsApp — the Projects browser as a desk window.
//
// A project is a named working context: a folder (the file-explorer focus +
// terminal cwd) plus the chats pinned to it. Two registers in one window
// (Design note, 2026-07-24: the SHELF — a lean list per channel (being's own / house)
// for picking and creating — and the FOCUS view (ProjectFocus) that holds ONE
// project with its grounds, conversations, knowledge files, and memory.
// Entering a project activates it — the backend re-points Files + Terminal —
// and the window opens into the active project's focus on mount, so the desk
// resumes where the work is. State comes from the desk-level ProjectContext,
// so the active project is consistent everywhere.

import { baseName } from '../../../utils/path.js';
import { useContext, useEffect, useState } from 'react';
import './ProjectsApp.css';
import './ProjectsApp-focus.css';
import { ensureBeingGround, getHouseWorkspace } from '../../../services/house-workspace.js';
import { useProjects } from './project-context.js';
import { useConsciousnessPick } from '../consciousness-context.js';
import { AppTitle } from '../app-title.jsx';
import { EmptyState } from '../empty-state.jsx';
import { useWindows } from '../../windowing/use-windows.js';
import { FocusContext } from '../use-desk-focus.js';
import { FolderPicker } from '../picker/FolderPicker.jsx';
import { CollisionPrompt } from './CollisionPrompt.jsx';
import { ProjectFocus } from './ProjectFocus.jsx';
import { createBrowseStart, folderAttachAction, projectSpaceFrame } from '../project-space.js';
import { ProjectsIcon, TrashGlyph } from './glyphs.jsx';

const ProjectsBody = () => {
  const {
    projects, activeProjectId, activeProject, loading, create, remove, activate, unpin, addFile, removeFile,
    resolve, attachFolder, detachFolder, setCwd, reconnect,
  } = useProjects();
  const { resumeSession, newSession, activeCompanion } = useConsciousnessPick('resumeSession', 'newSession', 'activeCompanion');
  const { dispatch } = useWindows();
  const focusLens = useContext(FocusContext);
  // Which register of the projects shelf is showing: the active being's own
  // ('neuma') or the house's collective repository ('house'). Default to the
  // register that has something to show — no dead first paint.
  const [tab, setTab] = useState(() => (activeCompanion?.neumaId ? 'neuma' : 'house'));
  // The register this window shows: the FOCUS view of one project, or the
  // shelf. `viewNav` is null until the witness navigates — while unnavigated,
  // the view FOLLOWS the store synchronously (never an effect: no shelf frame
  // flashes between load and focus): the active project's focus view once
  // loaded (opening the window resumes where the work is), the shelf
  // otherwise. An explicit choice (enter / ‹ ALL PROJECTS) then owns the
  // window. The create form pins the shelf so a background activation can
  // never yank the half-filled form out from under the witness.
  const [viewNav, setViewNav] = useState(null); // { id } | { shelf: true }
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [folder, setFolder] = useState('');
  const [picking, setPicking] = useState(false);
  const [pickingFileFor, setPickingFileFor] = useState(null); // project id whose shared file we're choosing
  const [attachingFor, setAttachingFor] = useState(null);     // project id we're attaching a folder to
  const [collision, setCollision] = useState(null);           // { folder, binding } — switch-vs-reconnect prompt
  const [note, setNote] = useState('');
  const [confirmDel, setConfirmDel] = useState(null);
  // The organization's grounds, set up ahead of time (Design note, 2026-07-24: the
  // HOUSE register browses from the collective <root>/repos; a being's
  // register browses from THEIR working ground on their channel,
  // <root>/workspaces/<neumaId>, raised idempotently the moment the window
  // knows the being. Unset ground falls through to the picker's home.
  const [houseReposDir, setHouseReposDir] = useState(null);
  const [beingGroundDir, setBeingGroundDir] = useState(null);
  useEffect(() => {
    let stale = false;
    getHouseWorkspace().then(({ root }) => { if (!stale && root) setHouseReposDir(`${root}/repos`); });
    return () => { stale = true; };
  }, []);
  const activeNeumaId = activeCompanion?.neumaId ?? null;
  useEffect(() => {
    setBeingGroundDir(null);
    if (!activeNeumaId) return undefined;
    let stale = false;
    ensureBeingGround(activeNeumaId).then(({ path }) => { if (!stale && path) setBeingGroundDir(path); });
    return () => { stale = true; };
  }, [activeNeumaId]);

  // A stale focus id (project deleted, other-register removal) degrades to the
  // shelf — a view that cannot resolve is never rendered as a blank room.
  const viewId = viewNav
    ? (viewNav.shelf ? null : viewNav.id)
    : (loading || creating ? null : activeProjectId);
  const viewProject = viewId ? projects.find((p) => p.id === viewId) ?? null : null;

  const onAddFile = async (projectId, absPath) => {
    setPickingFileFor(null);
    setNote('');
    try { await addFile(projectId, absPath); } catch (e) { setNote(e.message); }
  };

  // Attach a folder to a project. Ask the backend who owns it first, then act on
  // the pure decision: attach + cd when free, cd when already ours, or raise the
  // switch-vs-reconnect prompt when another project holds it.
  const onAttachFolder = async (projectId, absPath) => {
    setAttachingFor(null);
    setNote('');
    try {
      const binding = await resolve(absPath);
      const { action } = folderAttachAction(binding, projectId);
      if (action === 'attach') { await attachFolder(projectId, absPath); await setCwd(projectId, absPath); }
      else if (action === 'cd') { await setCwd(projectId, absPath); }
      else setCollision({ folder: absPath, binding });
    } catch (e) { setNote(e.message); }
  };

  // The witness resolved the collision: switch to the owning project (adopting
  // the folder as its cwd) or reconnect the folder into the active project.
  // Switching moves this window's focus view along — the project you chose is
  // the one you are now looking at.
  const onSwitchTo = async () => {
    const { folder: f, binding } = collision;
    setCollision(null); setNote('');
    try { await activate(binding.id); await setCwd(binding.id, f); setViewNav({ id: binding.id }); }
    catch (e) { setNote(e.message); }
  };
  const onReconnectHere = async () => {
    const { folder: f } = collision;
    setCollision(null); setNote('');
    try { await reconnect(activeProjectId, f); } catch (e) { setNote(e.message); }
  };

  // Work here: make the ground the working folder and put the Files window on
  // it — the focus view's "go" gesture.
  const onPickGround = async (projectId, absPath) => {
    setNote('');
    try { await setCwd(projectId, absPath); dispatch({ type: 'OPEN', id: 'files' }); } catch (e) { setNote(e.message); }
  };

  const onDetachFolder = async (projectId, absPath) => {
    setNote('');
    try { await detachFolder(projectId, absPath); } catch (e) { setNote(e.message); }
  };

  const submitCreate = async () => {
    if (!name.trim() || !folder.trim()) return;
    if (tab === 'neuma' && !activeCompanion?.neumaId) return;
    setNote('');
    try {
      const project = await create(
        name.trim(),
        folder.trim(),
        tab === 'neuma' ? { channel: 'neuma', neumaId: activeCompanion.neumaId } : { channel: 'house' },
      );
      setName(''); setFolder(''); setCreating(false);
      // A newly made room is the one you meant to stand in — enter it.
      if (project?.id) await enter(project.id);
    } catch (e) { setNote(e.message); }
  };

  // The two channels, never confused: the active being's own projects (the
  // focus channel) and the house's collective repository. The ACTIVE project
  // always renders, whichever register it belongs to — a project you cannot
  // see cannot be operated, and its hint still announces it below.
  const neumaProjects = activeCompanion?.neumaId
    ? projects.filter((p) => p.channel === 'neuma' && p.neumaId === activeCompanion.neumaId)
    : [];
  const houseProjects = projects.filter((p) => p.channel === 'house');
  const shown = tab === 'neuma' ? neumaProjects : houseProjects;
  if (activeProject && !shown.some((p) => p.id === activeProject.id)) shown.push(activeProject);

  // Enter a project: hold it in this window's focus view and activate it —
  // the backend re-points Files + Terminal. The Files window stays where it
  // is; the focus view's grounds are the "go work here" gesture now.
  const enter = async (id) => {
    setNote('');
    setViewNav({ id });
    try { await activate(id); } catch (e) { setNote(e.message); }
  };

  const onResumeChat = async (chat) => {
    await resumeSession({ neumaId: chat.neumaId, companionName: chat.companionName, sessionId: chat.sessionId });
    dispatch({ type: 'OPEN', id: 'chat' });
  };

  // A fresh stream in the viewed project: point this window's lens at it (the
  // per-turn frames that follow), hand newSession the project's frame directly
  // (the lens hasn't flushed into the stream's ref yet), and raise the chat.
  const onStartChat = async (p) => {
    setNote('');
    try {
      if (p.id !== activeProjectId) await activate(p.id);
      focusLens?.setFocus({ kind: 'project', id: p.id });
      newSession(projectSpaceFrame(p));
      dispatch({ type: 'OPEN', id: 'chat' });
    } catch (e) { setNote(e.message); }
  };

  const onDelete = async (id) => {
    try {
      await remove(id);
      setConfirmDel(null);
      if (viewId === id) setViewNav({ shelf: true });
    } catch (e) { setNote(e.message); }
  };

  return (
    <div className="proj">
      {picking ? (
        <FolderPicker
          initialPath={createBrowseStart({ draft: folder, tab, beingGround: beingGroundDir, houseRepos: houseReposDir })}
          onPick={(abs) => { setFolder(abs); setPicking(false); }}
          onCancel={() => setPicking(false)}
        />
      ) : null}

      {pickingFileFor ? (
        <FolderPicker
          pickFile
          initialPath={projects.find((p) => p.id === pickingFileFor)?.folder}
          onPick={(abs) => onAddFile(pickingFileFor, abs)}
          onCancel={() => setPickingFileFor(null)}
        />
      ) : null}

      {attachingFor ? (
        <FolderPicker
          initialPath={projects.find((p) => p.id === attachingFor)?.folder}
          onPick={(abs) => onAttachFolder(attachingFor, abs)}
          onCancel={() => setAttachingFor(null)}
        />
      ) : null}

      {collision ? (
        <CollisionPrompt
          folder={collision.folder}
          ownerName={collision.binding.name}
          hereName={activeProject?.name ?? null}
          canReconnect={Boolean(activeProjectId)}
          onSwitch={onSwitchTo}
          onReconnect={onReconnectHere}
          onCancel={() => setCollision(null)}
        />
      ) : null}

      {viewProject ? (
        <ProjectFocus
          project={viewProject}
          isActive={viewProject.id === activeProjectId}
          companion={activeCompanion}
          onBack={() => setViewNav({ shelf: true })}
          onDelete={() => onDelete(viewProject.id)}
          onStartChat={() => onStartChat(viewProject)}
          onAttachFolder={() => setAttachingFor(viewProject.id)}
          onPickGround={(path) => onPickGround(viewProject.id, path)}
          onDetachFolder={(path) => onDetachFolder(viewProject.id, path)}
          onAddFile={() => setPickingFileFor(viewProject.id)}
          onRemoveFile={(path) => removeFile(viewProject.id, path)}
          onResumeChat={onResumeChat}
          onUnpin={(c) => unpin(viewProject.id, c.sessionId, c.neumaId)}
        />
      ) : (
        <>
          {/* Two channels of the one shelf — a being's own projects and the
              house's collective repository, never mixed (the CHATS idiom). */}
          <div className="proj-tabs" role="tablist">
            <button
              type="button" role="tab" aria-selected={tab === 'neuma'} aria-controls="proj-panel"
              className={`proj-tab label-data${tab === 'neuma' ? ' is-on' : ''}`}
              onClick={() => setTab('neuma')}
            >
              {activeCompanion?.name ? `${activeCompanion.name.toUpperCase()}'S` : 'NEUMA'}
            </button>
            <button
              type="button" role="tab" aria-selected={tab === 'house'} aria-controls="proj-panel"
              className={`proj-tab label-data${tab === 'house' ? ' is-on' : ''}`}
              onClick={() => setTab('house')}
            >
              HOUSE
            </button>
          </div>

          <div className="proj-head">
            <button
              type="button" className="proj-new"
              onClick={() => setCreating((c) => !c)}
              disabled={tab === 'neuma' && !activeCompanion?.neumaId}
              title={tab === 'neuma' && !activeCompanion?.neumaId ? 'Select a being first' : ''}
            >
              {creating ? '× CANCEL' : '+ NEW PROJECT'}
            </button>
          </div>

          {creating ? (
            <div className="proj-form cham">
              <div className="proj-form-in cham-in">
                <input
                  className="proj-input" value={name} autoFocus
                  onChange={(e) => setName(e.target.value)} placeholder="project name" spellCheck={false}
                />
                <div className="proj-folderrow">
                  <input
                    className="proj-input" value={folder}
                    onChange={(e) => setFolder(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') submitCreate(); }}
                    placeholder="/absolute/path/to/folder" spellCheck={false}
                  />
                  <button type="button" className="proj-browse" onClick={() => setPicking(true)}>BROWSE…</button>
                </div>
                <button type="button" className="proj-create" onClick={submitCreate}>CREATE</button>
              </div>
            </div>
          ) : null}

          <div role="tabpanel" id="proj-panel" className="proj-panel" tabIndex={0}>
          {loading ? (
            <EmptyState title="LOADING…" />
          ) : shown.length === 0 ? (
            <EmptyState
              title={tab === 'neuma'
                ? (activeCompanion?.neumaId
                  ? `NO PROJECTS FOR ${(activeCompanion.name || 'THIS BEING').toUpperCase()} — CREATE ONE TO BIND A FOLDER, A TERMINAL, AND ITS CHATS.`
                  : 'SELECT A BEING TO SEE THEIR PROJECTS')
                : 'NO HOUSE PROJECTS — THE COLLECTIVE REPOSITORY EVERY MEMBER WORKS IN.'}
            />
          ) : (
            <ul className="proj-list">
              {shown.map((p) => {
                const isActive = p.id === activeProjectId;
                return (
                  <li key={p.id} className={`proj-item${isActive ? ' is-active' : ''}`}>
                    <div className="proj-row">
                      <button type="button" className="proj-pick" onClick={() => enter(p.id)} title={p.folder}>
                        <span className="proj-mark" aria-hidden="true" />
                        <span className="proj-name">{p.name}</span>
                        {p.pinnedChats?.length > 0 ? (
                          <span className="proj-count label-data">{p.pinnedChats.length} {p.pinnedChats.length === 1 ? 'CHAT' : 'CHATS'}</span>
                        ) : null}
                        <span className="proj-folder label-data">{baseName(p.folder)}</span>
                      </button>
                      {confirmDel === p.id ? (
                        <span className="proj-confirm">
                          <button type="button" className="proj-act is-danger" onClick={() => onDelete(p.id)}>DELETE</button>
                          <button type="button" className="proj-act" onClick={() => setConfirmDel(null)}>KEEP</button>
                        </span>
                      ) : (
                        <button type="button" className="proj-act proj-del" onClick={() => setConfirmDel(p.id)} title="Delete project" aria-label="Delete project"><TrashGlyph /></button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          </div>

          {activeProject ? (
            <p className="proj-hint label-data">NEW CHATS JOIN «{activeProject.name.toUpperCase()}» AUTOMATICALLY — OR PIN ONE FROM THE CHATS WINDOW.</p>
          ) : null}
        </>
      )}
      {note ? <div className="proj-note label-data">{note}</div> : null}
    </div>
  );
};

export const projectsApp = {
  label: 'PROJECTS',
  labelKey: 'apps.projects',
  icon: <ProjectsIcon />,
  title: <AppTitle label="PROJECTS" labelKey="apps.projects" />,
  Body: ProjectsBody,
  storageKey: 'projects',
};
