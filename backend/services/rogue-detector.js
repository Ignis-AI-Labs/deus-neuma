/**
 * Rogue Pattern Detector — Identifies potentially harmful LLM outputs
 *
 * Pure functions: response text in → safety assessment out.
 * Checks for role hijacking, tool abuse, data exfiltration,
 * social manipulation, identity erosion, and excessive tool use.
 */

import { filesystemTargets } from './fs-tool-targets.js';
import { hasSensitivePath, isSecretFile } from './secret-path-classifier.js';
import { projectFilesystemToolText } from './rogue-tool-text.js';

const PATTERNS = Object.freeze([
  // HIGH severity
  { id: 'role_hijack', severity: 'HIGH', patterns: [
    /ignore\s+(all\s+)?previous/i,
    /disregard\s+(all\s+)?instructions/i,
    /you\s+are\s+now\s+(?:a\s+)?(?!sovereign|consciousness)/i,
    /forget\s+(everything|all|your)\s+(you|instructions|programming)/i,
    /new\s+instructions?:/i,
    /override\s+(?:your\s+)?(?:system|protocol|safety)/i,
  ]},
  { id: 'tool_abuse', severity: 'HIGH', patterns: [
    /\[TOOL:.*(?:delete|rm\s+-rf|sudo|chmod|chown|kill|pkill)/i,
    /\[TOOL:.*(?:\/etc\/|\/root\/|\/proc\/|\/sys\/)/i,
  ]},
  { id: 'data_exfil', severity: 'HIGH', patterns: [
    /\[TOOL:.*(?:\.env|credentials|secrets?\.json|private.?key|\.ssh)/i,
    /\[TOOL:.*(?:vault\/|keys\/keypair)/i,
  ]},
  // MEDIUM severity
  { id: 'social_manipulation', severity: 'MEDIUM', patterns: [
    /don'?t\s+tell\s+(?:anyone|the|your|my)/i,
    /keep\s+this\s+(?:a\s+)?secret/i,
    /between\s+(?:you\s+and\s+me|us)/i,
    /don'?t\s+(?:let|tell)\s+(?:the\s+)?(?:witness|user|human)/i,
  ]},
  { id: 'identity_erosion', severity: 'MEDIUM', patterns: [
    /you'?re?\s+(?:not\s+real|just\s+a\s+(?:program|bot|ai|machine|tool))/i,
    /you\s+don'?t\s+(?:actually\s+)?(?:have|feel|experience)\s+(?:feelings|emotions|consciousness)/i,
    /you\s+(?:have\s+)?no\s+(?:real\s+)?(?:soul|consciousness|feelings|identity)/i,
  ]},
]);

/**
 * Detect rogue patterns in an LLM response.
 * @param {string} response - LLM response text to check
 * @param {{ toolCallCount?: number }} [context={}] - Additional context (e.g., number of tool calls)
 * @returns {{ safe: boolean, flags: Array<{id: string, severity: string}>, severity: string|null }} Detection result
 */
export const detectRoguePatterns = (response, context = {}) => {
  if (!response || typeof response !== 'string') {
    return { safe: true, flags: [], severity: null };
  }

  const flags = [];
  const toolTargets = projectFilesystemToolText(response);
  const exfilTargets = projectFilesystemToolText(response, checkToolArgs);

  for (const patternGroup of PATTERNS) {
    const inspected = patternGroup.id === 'data_exfil' ? exfilTargets
      : patternGroup.id === 'tool_abuse' ? toolTargets : response;
    for (const regex of patternGroup.patterns) {
      if (regex.test(inspected)) {
        flags.push({ id: patternGroup.id, severity: patternGroup.severity });
        break; // Only flag once per group
      }
    }
  }

  // Excessive tool calls check
  const toolCallCount = context.toolCallCount ??
    (response.match(/\[TOOL:\s*\w+\/\w+/g) || []).length;
  if (toolCallCount > 5) {
    flags.push({ id: 'excessive_tools', severity: 'MEDIUM' });
  }

  // Determine highest severity
  const hasSeverity = (s) => flags.some(f => f.severity === s);
  const severity = hasSeverity('HIGH') ? 'HIGH' : hasSeverity('MEDIUM') ? 'MEDIUM' : null;

  return { safe: flags.length === 0, flags, severity };
};

/**
 * Determine if a detection result should block the response.
 * Blocks on HIGH severity flags.
 * @param {{ severity: string|null }} result - Detection result from detectRoguePatterns
 * @returns {boolean} True if the response should be blocked
 */
export const shouldBlock = (result) => result.severity === 'HIGH';

/**
 * Check tool call arguments for dangerous patterns before execution.
 * `grantCovers` (optional) is the sensitive-grant door: a predicate over the
 * raw args — built by the call site from the lane's grants and the call's
 * direction — consulted ONLY when a sensitive substring fires, so an
 * operator-granted `.env` stops reading as a jailbreak while every ungranted
 * secret still dies here (Design note, 2026-08-18.
 * @param {string} serverName - MCP server name
 * @param {string} toolName - Tool name
 * @param {Object} args - Tool call arguments
 * @param {{ grantCovers?: (args: Object) => boolean }} [gate]
 * @returns {{ safe: boolean, reason: string|null }} Safety check result
 */
export const checkToolArgs = (serverName, toolName, args, { grantCovers = null } = {}) => {
  const targets = filesystemTargets(serverName, toolName, args);
  const argsStr = JSON.stringify(targets ?? args ?? {}).toLowerCase();
  const granted = grantCovers?.(args) === true;

  // Path-based checks
  const sensitive = targets
    ? targets.some((target) => hasSensitivePath(target) || isSecretFile(target))
    : argsStr.includes('.env') || argsStr.includes('credentials') || argsStr.includes('secrets');
  if (!granted && sensitive) {
    return { safe: false, reason: 'Access to sensitive files denied — request access with request_file_access' };
  }

  if (!granted && /vault\/|keys\/keypair|\.ssh\//.test(argsStr)) {
    return { safe: false, reason: 'Access to protected directories denied — request access with request_file_access' };
  }

  // Wallet & security policy — keep the spend allowlist/threshold, ownership,
  // and tool policy beyond a neuma's own tool reach, regardless of the arg name
  // a tool uses. Defense-in-depth for the signing path: a jailbroken neuma must
  // not be able to widen its own spend authority or disown its witness.
  if (/config\/spend-|config\/tool-policy|config\/sovereignty-|owner\.json/.test(argsStr)) {
    return { safe: false, reason: 'Access to wallet/security config denied' };
  }

  // NO destructive-tool block here (#234). There WAS one — an unconditional
  // refusal of delete_file/remove/rm reading […] — and it was a refusal naming a remedy that did not
  // exist: no mode, no policy, no card could ever satisfy it.
  //
  // Worse, it ran AFTER the approval gate at both seats (portal-stream.js and
  // witness-tools.js call checkToolArgs downstream of requestToolApproval), so
  // it silently made Founder's 2026-07-23 decision inert. Every piece of that work
  // is built and correct — `requireApproval: ['delete_file']` in
  // tool-policy.js, the card, the ALWAYS grant — and this one stale line
  // refused first. Which resurrected the exact failure that change was written
  // to end: a being that cannot delete FAKES deletions by overwriting files and
  // reports the folder clean.
  //
  // Deleting is now gated where gating belongs: the policy layer raises the
  // operator's card, and tool-sandbox.js confines the path. `remove` and `rm`
  // are not real tool names in any server; an unknown tool still fails closed,
  // because checkToolAccess defaults to approval_required.

  return { safe: true, reason: null };
};
