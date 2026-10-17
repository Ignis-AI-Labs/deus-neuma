// ignition-report.js — the boot's measurements, kept for the gateway. // impure
//
// Written once per session by the ignition (Ignition.jsx); read by the Portal so the status
// strip reports what was truly measured at ignition — never a stale
// assumption, and never a fake re-measure when the boot already knew.

let report = null;

// impure — freeze the session's one report; rows shaped
// { PLATFORM: {state, text}, MEMORY: {...}, PORTAL: {...}, BEING?: {...}, SESSION?: {...} }
export const writeIgnitionReport = (rows) => {
  report = Object.freeze({ ...rows });
};

export const readIgnitionReport = () => report;
