// PocketRails — the desk's two stream rails, each a pane of its own.
//
// On the desk, CHATS and TASKS fold beside the stream and only one is open
// at a time (stream-rail-state.js). In a pocket the pane IS the open rail:
// mounting it opens that rail, leaving closes it, so the components render
// exactly as they do on the desk with none of their fold logic touched.
import { useEffect } from 'react';
import { StreamChats } from '../RelinkShell/StreamChats.jsx';
import { StreamTasks } from '../RelinkShell/StreamTasks.jsx';
import { setOpenRail } from '../RelinkShell/stream-rail-state.js';

/**
 * @param {{ which: 'chats' | 'tasks' }} props
 */
export const PocketRail = ({ which }) => {
  useEffect(() => {
    setOpenRail(which);
    return () => setOpenRail(null);
  }, [which]);
  return (
    <div className="pocket-rail" data-rail={which}>
      {which === 'chats' ? <StreamChats /> : <StreamTasks />}
    </div>
  );
};
