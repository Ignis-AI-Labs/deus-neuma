// ProjectFocus — one project, organized (ruling, 2026-07-24).
//
// The window's second register: the shelf picks a project, THIS view holds
// it. The heading names the project so the focus is never ambiguous; the main
// column is the working side (start a chat, the grounds you work in, the
// conversations held here) and the rail is the knowing side (files always in
// context, the project's crystallized memory). Two deliberate layers, never
// mixed: KNOWLEDGE feeds the neuma's context; GROUNDS are where work happens.
//
// All mutations stay with the host (ProjectsApp) — this component renders the
// project it is given and raises gestures. Its one impure edge is the MEMORY
// panel read: bounded previews from one being's sovereign lane, the lane
// chosen by projectMemoryLane (pure).

import { useEffect, useState } from 'react';
import { baseName } from '../../../utils/path.js';
import { listProjectMemory } from '../../../services/project-memory.js';
import { projectMemoryLane } from '../project-space.js';
import {
  TrashGlyph, ResumeGlyph, UnpinGlyph, FileGlyph, FolderTreeGlyph, RepoGlyph, MemoryGlyph,
} from './glyphs.jsx';

// A shared file's path relative to its project folder, for a compact label.
// Separator-terminated prefix match — a sibling like /a/project-x is never
// mistaken for being inside /a/proj (prefix-collision safety).
const relTo = (folder, filePath) =>
  (folder && filePath.startsWith(`${folder}/`) ? filePath.slice(folder.length + 1) : baseName(filePath));

// Compact day label for a memory row — never a crash on a malformed stamp.
const dayLabel = (iso) => {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  return t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
};

// Whose project the top bar announces. The being's own name when the active
// companion IS the project's being; the honest generic otherwise.
const channelLabel = (project, companion) => {
  if (project.channel === 'house') return 'HOUSE PROJECT';
  if (companion?.neumaId === project.neumaId && companion?.name) {
    return `${companion.name.toUpperCase()}'S PROJECT`;
  }
  return 'NEUMA PROJECT';
};

// The MEMORY panel — its own impure read, scoped to this project's space.
const MemoryPanel = ({ project, companion }) => {
  const lane = projectMemoryLane(project, companion?.neumaId ?? null);
  const [mem, setMem] = useState({ status: 'loading', rows: [], total: 0, error: null });
  useEffect(() => {
    if (!lane.neumaId) {
      setMem({ status: 'none', rows: [], total: 0, error: null });
      return undefined;
    }
    let stale = false;
    setMem({ status: 'loading', rows: [], total: 0, error: null });
    listProjectMemory(lane.neumaId, project.id)
      .then(({ observations, total }) => {
        if (!stale) setMem({ status: 'ready', rows: observations || [], total: total ?? 0, error: null });
      })
      .catch((e) => {
        if (!stale) setMem({ status: 'error', rows: [], total: 0, error: e.message });
      });
    return () => { stale = true; };
  }, [lane.neumaId, project.id]);

  const laneName = companion?.neumaId === lane.neumaId ? companion?.name : null;
  return (
    <section className="proj-card proj-memory">
      <div className="proj-files-head">
        <span className="label-data proj-files-title">PROJECT MEMORY</span>
        {laneName ? <span className="proj-card-chip label-data">{laneName.toUpperCase()}'S LANE</span> : null}
      </div>
      {mem.status === 'loading' ? (
        <p className="proj-files-empty label-data">READING…</p>
      ) : mem.status === 'none' ? (
        <p className="proj-files-empty label-data">SELECT A BEING TO READ THIS PROJECT'S MEMORY.</p>
      ) : mem.status === 'error' ? (
        <p className="proj-files-empty proj-memory-err label-data">{mem.error}</p>
      ) : mem.rows.length === 0 ? (
        <p className="proj-files-empty label-data">NOTHING CRYSTALLIZED HERE YET — SIGNIFICANT MOMENTS IN THIS PROJECT'S CHATS LAND HERE.</p>
      ) : (
        <>
          <ul className="proj-memlist">
            {mem.rows.map((m) => (
              <li key={m.id} className="proj-mem">
                <span className="proj-mem-glyph" aria-hidden="true"><MemoryGlyph /></span>
                <span className="proj-mem-label">{m.label}</span>
                <span className="proj-mem-day label-data">{dayLabel(m.at)}</span>
              </li>
            ))}
          </ul>
          {mem.total > mem.rows.length ? (
            <p className="proj-files-empty label-data">{mem.rows.length} OF {mem.total} — THE REST LIVES IN THE BEING'S RECORD.</p>
          ) : null}
        </>
      )}
    </section>
  );
};

export const ProjectFocus = ({
  project, isActive, companion,
  onBack, onDelete, onStartChat,
  onAttachFolder, onPickGround, onDetachFolder,
  onAddFile, onRemoveFile,
  onResumeChat, onUnpin,
}) => {
  const [confirmDel, setConfirmDel] = useState(false);
  const cwdEntry = (project.folders || []).find((f) => f.path === project.folder);
  const canChat = Boolean(companion?.neumaId);

  return (
    <div className="proj-focus">
      <div className="proj-focus-bar">
        <button type="button" className="proj-back label-data" onClick={onBack}>‹ ALL PROJECTS</button>
        <span className="proj-focus-channel label-data">{channelLabel(project, companion)}</span>
        {confirmDel ? (
          <span className="proj-confirm">
            <button type="button" className="proj-act is-danger" onClick={onDelete}>DELETE</button>
            <button type="button" className="proj-act" onClick={() => setConfirmDel(false)}>KEEP</button>
          </span>
        ) : (
          <button type="button" className="proj-act" onClick={() => setConfirmDel(true)} title="Delete project" aria-label="Delete project"><TrashGlyph /></button>
        )}
      </div>

      <div className="proj-focus-head">
        <h2 className="proj-focus-title">{project.name}</h2>
        <p className="proj-focus-meta label-data">
          WORKING IN {baseName(project.folder).toUpperCase()}
          {cwdEntry?.isRepo && cwdEntry.branch ? ` · ${cwdEntry.branch}` : ''}
          {isActive ? ' — NEW CHATS JOIN THIS PROJECT' : ''}
        </p>
      </div>

      <div className="proj-focus-grid">
        <div className="proj-focus-main">
          <button
            type="button" className="proj-newchat" onClick={onStartChat}
            disabled={!canChat} title={canChat ? 'Open a fresh stream in this project' : 'Select a being first'}
          >
            + START NEW CHAT
          </button>

          <section className="proj-card">
            <div className="proj-files-head">
              <span className="label-data proj-files-title">FOLDERS &amp; REPOSITORIES</span>
              <button type="button" className="proj-files-add" onClick={onAttachFolder} title="Attach another folder or repository to this project">+ ATTACH FOLDER</button>
            </div>
            <ul className="proj-folderlist">
              {(project.folders || []).map((f) => {
                const isCwd = f.path === project.folder;
                return (
                  <li key={f.path} className={`proj-folder-item${isCwd ? ' is-cwd' : ''}`}>
                    <button type="button" className="proj-folder-pick" onClick={() => onPickGround(f.path)} title={isCwd ? `Working folder — ${f.path}` : `Work here — ${f.path}`}>
                      <span className="proj-folder-glyph" aria-hidden="true">{f.isRepo ? <RepoGlyph /> : <FolderTreeGlyph />}</span>
                      <span className="proj-folder-name label-data">{baseName(f.path)}</span>
                      {f.isRepo && f.branch ? <span className="proj-folder-branch label-data">{f.branch}</span> : null}
                      {isCwd ? <span className="proj-folder-cwd label-data">WORKING</span> : null}
                    </button>
                    {(project.folders || []).length > 1 ? (
                      <button type="button" className="proj-act" onClick={() => onDetachFolder(f.path)} title="Detach folder" aria-label="Detach folder"><UnpinGlyph /></button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="proj-card">
            <div className="proj-files-head">
              <span className="label-data proj-files-title">CONVERSATIONS</span>
              {project.pinnedChats?.length > 0 ? (
                <span className="proj-card-chip label-data">{project.pinnedChats.length}</span>
              ) : null}
            </div>
            {project.pinnedChats?.length > 0 ? (
              <ul className="proj-chats">
                {project.pinnedChats.map((c) => (
                  <li key={`${c.neumaId}:${c.sessionId}`} className="proj-chat">
                    <button type="button" className="proj-chat-resume" onClick={() => onResumeChat(c)} title="Resume chat">
                      <ResumeGlyph />
                      <span className="proj-chat-label label-data">{c.label}</span>
                      {c.companionName ? <span className="proj-chat-who">{c.companionName}</span> : null}
                    </button>
                    <button type="button" className="proj-act" onClick={() => onUnpin(c)} title="Unpin chat" aria-label="Unpin chat"><UnpinGlyph /></button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="proj-files-empty label-data">NONE YET — START ONE ABOVE, OR PIN ONE FROM THE CHATS WINDOW.</p>
            )}
          </section>
        </div>

        <div className="proj-focus-rail">
          <section className="proj-card">
            <div className="proj-files-head">
              <span className="label-data proj-files-title">KNOWLEDGE — ALWAYS IN CONTEXT</span>
              <button type="button" className="proj-files-add" onClick={onAddFile} title="Add a file to the neuma's always-on context for this project">+ ADD FILE</button>
            </div>
            {project.sharedFiles?.length > 0 ? (
              <ul className="proj-filelist">
                {project.sharedFiles.map((f) => (
                  <li key={f.path} className="proj-file">
                    <span className="proj-file-glyph" aria-hidden="true"><FileGlyph /></span>
                    <span className="proj-file-name label-data" title={f.path}>{relTo(project.folder, f.path)}</span>
                    <button type="button" className="proj-act" onClick={() => onRemoveFile(f.path)} title="Remove from shared context" aria-label="Remove from shared context"><UnpinGlyph /></button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="proj-files-empty label-data">NONE YET — ADD FILES THE NEUMA SHOULD ALWAYS SEE IN THIS PROJECT.</p>
            )}
          </section>

          <MemoryPanel project={project} companion={companion} />
        </div>
      </div>
    </div>
  );
};
