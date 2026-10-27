// use-platform-standing.js — one platform's standing as the window lives it:
// the channel board, the house roster, the house's CMO seat and the platform's
// crew, folded by the pure rule (platform-standing.js), and the acts that
// change it.
//
// THE AUTO-BIND: when the rule says the seated CMO should hold this platform
// (keys set, no holder, not released here), the window binds it through the
// real binding route — the same PUT /:channelId/binding, the same ownership
// check, the same house — once per window, and says so plainly (notice).
//
// THE RELEASE MEMORY: a platform the operator released here stays released —
// the auto-bind never undoes their word. Kept per house wallet, per platform,
// in this desk's storage; any bind clears it.
//
// impure — reads and writes the platform.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getChannelBoard, bindChannel, releaseChannel, getRosterForBinding,
  getChannelCrew, addCrewMember, removeCrewMember,
} from '../../services/social-channels-client.js';
import { getCmo } from '../../services/campaigns-client.js';
import { holderStanding } from './platform-standing.js';

// impure — the release memory's key: the signed-in house, then the platform.
const releasedKey = (channelId) =>
  `${String(globalThis.localStorage?.getItem('walletAddress') || '').toLowerCase()}:standing-released:${channelId}`;
const readReleased = (channelId) => {
  try { return globalThis.localStorage.getItem(releasedKey(channelId)) === '1'; } catch { return false; }
};
const writeReleased = (channelId, on) => {
  try {
    if (on) globalThis.localStorage.setItem(releasedKey(channelId), '1');
    else globalThis.localStorage.removeItem(releasedKey(channelId));
  } catch { /* storage denied — the memory is a courtesy, the binding is the record */ }
};

/**
 * impure — { channel, roster, crew, holder, notice, error, loadError, busy,
 *   bind, release, addCrew, removeCrew, dismissNotice }
 * @param {string} channelId
 */
export const usePlatformStanding = (channelId) => {
  const [channel, setChannel] = useState(null);
  const [roster, setRoster] = useState([]);
  const [cmoLaneId, setCmoLaneId] = useState(null);
  const [crew, setCrew] = useState([]);
  const [read, setRead] = useState(false);
  const [released, setReleased] = useState(() => readReleased(channelId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [notice, setNotice] = useState(null);
  const autoTried = useRef(false);

  const refreshChannel = useCallback(async () => {
    const board = await getChannelBoard();
    setChannel(board.channels.find((c) => c.id === channelId) || null);
  }, [channelId]);

  useEffect(() => {
    Promise.all([
      refreshChannel(),
      getRosterForBinding().then(setRoster),
      getCmo().then((r) => setCmoLaneId(r?.cmo?.laneId ?? null)),
      getChannelCrew(channelId).then(setCrew),
    ]).then(() => setRead(true), (e) => setLoadError(e.message));
  }, [channelId, refreshChannel]);

  // The rule waits for every read: a half-read house must never auto-bind.
  const holder = channel && read
    ? holderStanding({ channel, roster, cmoLaneId, crew, released })
    : null;

  const act = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  const bind = (laneId) => act(async () => {
    await bindChannel(channelId, laneId);
    writeReleased(channelId, false);
    setReleased(false);
    setNotice(null);
    await refreshChannel();
  });

  const release = () => act(async () => {
    await releaseChannel(channelId);
    writeReleased(channelId, true);
    setReleased(true);
    setNotice(null);
    await refreshChannel();
  });

  const autoBind = holder?.autoBind ?? null;
  useEffect(() => {
    if (!autoBind || autoTried.current) return;
    autoTried.current = true;
    const cmo = holder.cmo;
    act(async () => {
      try {
        await bindChannel(channelId, autoBind);
      } catch (e) {
        throw new Error(`${cmo.name} could not be bound automatically — ${e.message}`, { cause: e });
      }
      await refreshChannel();
      setNotice({ name: cmo.name, seat: cmo.seat });
    });
  }, [autoBind]);

  return {
    channel, roster, crew, holder, notice, error, loadError, busy, bind, release,
    addCrew: (member) => act(async () => setCrew(await addCrewMember(channelId, member))),
    removeCrew: (neumaId) => act(async () => setCrew(await removeCrewMember(channelId, neumaId))),
    dismissNotice: () => setNotice(null),
  };
};
