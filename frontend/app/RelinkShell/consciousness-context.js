// consciousness-context.js — share the live stream across the desk.
//
// The consciousness stream (messages, link state, sendThought) lives at the
// desk host, ABOVE the window manager, and is read here by the chat window.
// This is what lets the conversation survive minimizing or closing the chat
// window — the stream state outlives the window that views it.
//
// PICK WHAT YOU READ (2026-09-28 smoothness pass). The whole stream value is
// a new object on every streamed frame, so every window reading it
// re-rendered ~60 times a second while a being spoke — though most wanted
// only WHO is bound, or a stable action. `useConsciousnessPick(...keys)`
// re-renders only when one of the named values actually changes (identity).
// `useConsciousness()` still hands over everything, for the surfaces that
// genuinely follow the stream. Every provider site goes through
// `ConsciousnessProvider`, so the two readings can never disagree.

import { createContext, createElement, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';

export const ConsciousnessContext = createContext(null);
const StoreContext = createContext(null);

// impure — a one-value store the provider publishes into after each commit.
const createStore = (initial) => {
  let value = initial;
  const subs = new Set();
  return {
    get: () => value,
    set: (next) => {
      if (next === value) return;
      value = next;
      for (const fn of subs) fn();
    },
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
  };
};
const NO_STORE = Object.freeze({ get: () => null, subscribe: () => () => {} });

export const useConsciousness = () => useContext(ConsciousnessContext);

/**
 * The named values of the stream, re-rendering only when one of them changes.
 * @param {...string} keys e.g. 'activeCompanion', 'switchCompanion', 'wsService'
 * @returns {object} { [key]: value } — the same object while nothing picked moved
 */
export const useConsciousnessPick = (...keys) => {
  const store = useContext(StoreContext) ?? NO_STORE;
  const cache = useRef(null);
  const read = () => {
    const v = store.get() ?? {};
    const prev = cache.current;
    if (prev && keys.every((k) => prev[k] === v[k])) return prev;
    cache.current = Object.fromEntries(keys.map((k) => [k, v[k]]));
    return cache.current;
  };
  return useSyncExternalStore(store.subscribe, read, read);
};

/** The bound being — re-renders only when the binding changes. */
export const useActiveCompanion = () => useConsciousnessPick('activeCompanion').activeCompanion ?? null;

export const ConsciousnessProvider = ({ value, children }) => {
  const [store] = useState(() => createStore(value));
  useLayoutEffect(() => { store.set(value); }, [store, value]);
  return createElement(ConsciousnessContext.Provider, { value },
    createElement(StoreContext.Provider, { value: store }, children));
};
