/**
 * Tool policy defaults for programs on the operator's own computer that a neuma senses and drives
 * (DATA, cut from tool-policy-defaults.js under the size law; spread back into GLOBAL_DEFAULTS
 * there). Every entry is a doctrine decision: the comment above each block is the law's reasoning.
 */
export const LOCAL_APP_DEFAULTS = Object.freeze({
  // KSP sensing is observation; every physical act is the ksp/command INTENT
  // (Stage 3) — it asks until the operator selects AUTO or grants this neuma
  // a standing allowance, exactly as the tool did.
  ksp: {
    allowed: ['get_telemetry', 'get_view'],
    denied: [],
    requireApproval: [],
  },
  // The Unreal editor on the operator's own computer (Design note, 2026-11-22. Looking is observation:
  // the state, a picture of the viewport, Epic's tool list, the Fab library, reading on in a long
  // answer. Python in the editor is code on the operator's machine with no sandbox, an Epic tool
  // not marked read changes the project, and a Fab install downloads into it: each raises the
  // card, and AUTO alone does not pass them (protocol-guard.js). unreal_tool_read is the policy
  // name of an Epic tool that Epic itself marks read-only; every other Epic tool is unreal_tool.
  unreal: {
    allowed: ['unreal_status', 'unreal_look', 'unreal_toolsets', 'unreal_fab_library', 'unreal_more', 'unreal_tool_read'],
    denied: [],
    requireApproval: ['unreal_python', 'unreal_tool', 'unreal_fab_install'],
  },
});
