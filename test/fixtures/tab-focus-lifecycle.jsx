import React, { useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { useDeskTabs } from '../../frontend/app/RelinkShell/use-desk-tabs.js';
import { TabsContext } from '../../frontend/app/RelinkShell/tabs-context.js';
import { StripRegistrar } from '../../frontend/app/RelinkShell/StripRegistrar.jsx';
import { stripFor, stripEntries, groundTargetId, markStripFocused, subscribeStrips, stripsVersion, transferTab } from '../../frontend/app/RelinkShell/stream-strips.js';
import { emptyTabs, openTab, setTabFocus } from '../../core/runtime/tabs-model.js';
import { saveTabs, loadTabs } from '../../frontend/app/windowing/window-storage.js';
import { sittingGround } from '../../frontend/app/RelinkShell/desk-focus.js';
import { ExplorerPanel } from '../../frontend/app/RelinkShell/ExplorerPanel.jsx';
import { FocusContext } from '../../frontend/app/RelinkShell/use-desk-focus.js';
import { ProjectContext } from '../../frontend/app/RelinkShell/projects/project-context.js';
import { useProjectsState } from '../../frontend/app/RelinkShell/projects/use-projects.js';
import { useFilesWatch } from '../../frontend/app/RelinkShell/use-files-watch.js';

const diskRoot = new URLSearchParams(window.location.search).get('root');

if (!sessionStorage.getItem('tab-focus-seeded')) {
for (const [scope, ids] of [['chat', ['a']], ['chat#2', ['b', 'c', 'empty']]]) {
  let state = emptyTabs();
  for (const id of ids) {
    state = openTab(state, { id, neumaId: id, name: id, kind: 'local', sessionId: `session-${id}`, createdAt: '2026-09-09T00:00:00Z' });
    if (id !== 'empty') state = setTabFocus(state, id, { kind: 'folder', path: `${diskRoot || '/tmp'}/${id}` });
  }
  saveTabs(state, scope);
}
  sessionStorage.setItem('tab-focus-seeded', 'yes');
}
window.transferTab = transferTab;
window.readSavedTabs = loadTabs;

function Stream({ id }) {
  const tabs = useDeskTabs(null, {}, { scope: id });
  return <TabsContext.Provider value={tabs}>
    <StripRegistrar windowId={id}>
      <output data-strip={id}>{JSON.stringify(tabs.tabs)}</output>
      {tabs.tabs.map((tab) => <button key={tab.id} onClick={() => {
        markStripFocused(id);
        tabs.focus(tab.id);
      }}>Select {tab.id}</button>)}
    </StripRegistrar>
  </TabsContext.Provider>;
}
function Explorer({ ground }) {
  useFilesWatch();
  const projects = useProjectsState();
  return <ProjectContext.Provider value={projects}>
    <FocusContext.Provider value={{ focus: sittingGround(ground) }}>
      <ExplorerPanel collapsed={false} />
    </FocusContext.Provider>
  </ProjectContext.Provider>;
}
function Fixture() {
  const [open, setOpen] = useState(true);
  useSyncExternalStore(subscribeStrips, stripsVersion);
  const selected = stripFor(groundTargetId(stripEntries()));
  return <>
    <Stream id="chat" />
    {open && <Stream id="chat#2" />}
    <button onClick={() => setOpen((value) => !value)}>Toggle second stream</button>
    <output id="folder">{sittingGround(selected?.ground)?.path ?? 'CHOOSE A FOLDER'}</output>
    {diskRoot && <Explorer ground={selected?.ground} />}
  </>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
