import { useState } from 'react';
import { getBeingModels, getBeingEffort } from '../../services/inference.js';
import { loadSubstrateModels } from './substrate-client.js';
import { asIgniteModels, mergeIgniteView } from './model-bar-view.js';
import { useSettled } from './use-settled.js';

const EMPTY = Object.freeze({ data: null, pending: true, error: null });
const UNUSED = Object.freeze({ data: null, pending: false, error: null });

// impure — an unavailable live catalog must not masquerade as an empty list.
const readModels = async (beingId, catalog) => {
  if (catalog === 'substrate') {
    const live = await loadSubstrateModels();
    if (!live) throw new Error('Could not load the model catalog.');
    return asIgniteModels(live);
  }
  const models = await getBeingModels(beingId);
  if (!models?.route?.model) throw new Error('The model route is unavailable.');
  if (models.switchBy !== 'ignite') return models;
  const live = await loadSubstrateModels();
  if (!live) throw new Error('Could not refresh the substrate model catalog.');
  return mergeIgniteView(models, live);
};

// impure — distinguish an unreadable capability from a confirmed empty ladder.
const readEffort = async (beingId) => {
  const effort = await getBeingEffort(beingId);
  if (!effort?.route?.model || !Array.isArray(effort?.capability?.tiers)) {
    throw new Error('The effort settings are unavailable.');
  }
  return effort;
};

/** Independent reads; late responses can never replace another chat's state. Impure. */
export const useModelBarData = ({ beingId, catalog, epoch, serving }) => {
  const key = JSON.stringify([beingId ?? null, catalog]);
  const [modelRead, setModelRead] = useState(EMPTY);
  const [effortRead, setEffortRead] = useState(EMPTY);
  useSettled((settled) => {
    const load = async (setter, read) => {
      setter((previous) => ({ key, data: previous.key === key ? previous.data : null, pending: true, error: null }));
      try {
        const data = await read();
        if (!settled()) setter({ key, data, pending: false, error: null });
      } catch (error) {
        if (!settled()) setter((previous) => ({ ...previous, pending: false, error: error.message || 'Could not load settings.' }));
      }
    };
    if (beingId || catalog === 'substrate') load(setModelRead, () => readModels(beingId, catalog));
    else setModelRead({ key, ...UNUSED });
    if (beingId) load(setEffortRead, () => readEffort(beingId));
    else setEffortRead({ key, ...UNUSED });
  }, [beingId, catalog, epoch, serving]);
  return {
    modelRead: modelRead.key === key ? modelRead : EMPTY,
    effortRead: effortRead.key === key ? effortRead : EMPTY,
    setEffort: (data) => setEffortRead({ key, data, pending: false, error: null }),
  };
};
