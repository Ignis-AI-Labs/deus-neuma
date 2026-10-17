// use-command-dispatch.js — bridges a native palette command to the app's real
// action seams. This is the one impure edge: window-manager dispatch, the
// consciousness hook's newSession, and the global summon event (the same event
// HouseApp fires). The command registry (commands.js) stays pure; this executes it.

import { useCallback } from 'react';
import { useWindows } from '../windowing/use-windows.js';
import { useConsciousnessPick } from './consciousness-context.js';
import { requestSettingsFocus } from './settings-focus.js';

/**
 * A runner that executes a native command's `run` intent against the live app.
 * Returns true when the command was handled, false for an unknown intent (so the
 * composer can fall back to treating the input as ordinary speech).
 * @returns {(command: object) => boolean}
 */
export const useCommandDispatch = () => {
  const { registry, dispatch } = useWindows();
  const { newSession } = useConsciousnessPick('newSession');
  // impure — DOM event + reducer dispatch + session reset
  return useCallback((command) => {
    const run = command?.run;
    if (!run) return false;
    if (run.type === 'summon' || run.type === 'rehearse') {
      window.dispatchEvent(new CustomEvent('neuma:summon', { detail: { rehearsal: run.type === 'rehearse' } }));
      return true;
    }
    if (run.type === 'remia') {
      window.dispatchEvent(new CustomEvent('remia:attune'));
      return true;
    }
    if (run.type === 'attune') {
      window.dispatchEvent(new CustomEvent('attunement:witness'));
      return true;
    }
    if (run.type === 'new') {
      newSession();
      return true;
    }
    if (run.type === 'switch') {
      // The palette takes no argument, so the command opens the stream's
      // roster popover — BeingSwitcher owns the actual switch.
      window.dispatchEvent(new CustomEvent('neuma:open-switcher'));
      return true;
    }
    if (run.type === 'open' && run.app) {
      // Panel-only law (D12): an app flagged `panel: true` lives in the
      // desk's left rail — the command toggles the panel instead of opening
      // a floating window. The desk host owns the toggle and listens here.
      if (registry?.[run.app]?.panel) {
        window.dispatchEvent(new CustomEvent('neuma:panel-app', { detail: { app: run.app } }));
        return true;
      }
      dispatch({ type: 'OPEN', id: run.app });
      // A command may deep-link into the opened app (e.g. /provider, /model jump
      // to a Settings section). The window mounts async, so the target is latched.
      if (run.focus) requestSettingsFocus(run.focus);
      return true;
    }
    return false;
  }, [registry, dispatch, newSession]);
};
