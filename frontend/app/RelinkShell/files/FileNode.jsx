// FileNode — one row of the FILES tree, recursive over expanded dirs.
// Extracted whole from FilesApp (size law). Pure presentation: every
// behavior arrives through `actions`, every truth through props.

import { baseName } from '../../../utils/path.js';
import { dropDirForRow } from './files-drop.js';
import { badgeFor, badgeWord, isIgnored, repoRel } from './git-status-view.js';
import { FolderGlyph, FileGlyph, Caret, NewFileGlyph, NewFolderGlyph, RenameGlyph, TrashGlyph } from './files-glyphs.jsx';

export const FileNode = ({ entry, depth, isRoot, expanded, childrenMap, showHidden, rootPath, gitFiles, gitIgnored, selected, actions }) => {
  const isDir = entry.type === 'dir';
  const isOpen = expanded.has(entry.path);
  const kids = childrenMap[entry.path];
  // The git badge: a file wears its own letter, a dir (and the root) rolls up
  // the strongest letter anywhere beneath it. An ignored row is only GRAYED —
  // ignored is not a change, so it never earns a badge.
  const rel = repoRel(rootPath, entry.path);
  const badge = gitFiles ? badgeFor(gitFiles, rel, isDir) : null;
  const ignored = isIgnored(gitIgnored, rel);
  // THE BRIDGE: this row is a drop target (files from the OS land in its
  // folder) and a drag source (drag it to the OS to copy the file out).
  const isDrop = actions.dropPath === dropDirForRow(entry);
  return (
    <>
      <div
        className={`files-rowwrap${ignored ? ' is-ignored' : ''}${isDrop ? ' is-drop' : ''}${selected.has(entry.path) ? ' is-selected' : ''}`}
        onContextMenu={(e) => actions.onMenu(e, entry, isRoot)}
        draggable
        onDragStart={(e) => actions.onDragOut(e, entry)}
        onDragOver={(e) => actions.onDragOverRow(e, entry)}
        onDragLeave={(e) => actions.onDragLeaveRow(e, entry)}
        onDrop={(e) => actions.onDropFiles(e, entry)}
      >
        <button
          type="button"
          className="files-row"
          style={{ paddingLeft: `${6 + depth * 14}px` }}
          onClick={(e) => actions.onRowClick(e, entry, isDir)}
          title={entry.path}
        >
          <span className="files-caret-slot">{isDir ? <Caret open={isOpen} /> : null}</span>
          <span className="files-glyph" aria-hidden="true">{isDir ? <FolderGlyph /> : <FileGlyph />}</span>
          <span className="files-name label-data">{isRoot ? baseName(entry.path) : entry.name}</span>
          {badge ? <span className={`files-git g-${badge}`} title={badgeWord(badge)}>{badge}</span> : null}
        </button>
        <span className="files-actions">
          {isDir ? (
            <>
              <button type="button" className="files-act" onClick={() => actions.onNew('new-file', entry)} title="New file" aria-label="New file"><NewFileGlyph /></button>
              <button type="button" className="files-act" onClick={() => actions.onNew('new-folder', entry)} title="New folder" aria-label="New folder"><NewFolderGlyph /></button>
            </>
          ) : null}
          {!isRoot ? (
            <>
              <button type="button" className="files-act" onClick={() => actions.onRename(entry)} title="Rename" aria-label="Rename"><RenameGlyph /></button>
              <button type="button" className="files-act" onClick={() => actions.onDelete(entry)} title="Delete" aria-label="Delete"><TrashGlyph /></button>
            </>
          ) : null}
          {isRoot ? (
            <button type="button" className="files-rootx" onClick={() => actions.onRemoveRoot(entry.path)} title="Close folder" aria-label="Close folder">×</button>
          ) : null}
        </span>
      </div>
      {isDir && isOpen && kids
        ? kids.filter((e) => showHidden || !e.hidden).map((e) => (
          <FileNode
            key={e.path} entry={e} depth={depth + 1} isRoot={false}
            expanded={expanded} childrenMap={childrenMap} showHidden={showHidden}
            rootPath={rootPath} gitFiles={gitFiles} gitIgnored={gitIgnored}
            selected={selected} actions={actions}
          />
        ))
        : null}
    </>
  );
};
