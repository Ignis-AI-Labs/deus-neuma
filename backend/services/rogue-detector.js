/**
 * Rogue Pattern Detector — Identifies potentially harmful LLM outputs
 *
 * Pure functions: response text in → safety assessment out.
 * Checks for role hijacking, tool abuse, data exfiltration,
 * social manipulation, identity erosion, and excessive tool use.
 */

import path from 'path';
import { filesystemTargets } from './fs-tool-targets.js';
import { hasSensitivePath, isSecretFile } from './secret-path-classifier.js';
import { projectFilesystemToolText } from './rogue-tool-text.js';
import { foldName } from './wall-spelling.js';

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

// What lies in the secret folders, and the folders themselves named alone
// (listing `keys` names every key file in it). The rest of keys/ is the
// sandbox's own wall to refuse, with its own words.
const PROTECTED_PATH = /vault\/|keys\/keypair|\.ssh\//;
const SECRET_FOLDER = /(?:^|\/)(?:keys|vault|\.ssh)\/?$/;

// pure — a path as every fs tool opens it: backslashes as separators, `//`,
// `./` and `x/..` collapsed, NFC and full case folded (a case- and
// normalization-insensitive volume opens `KEYS/` and `houſe-mandate` as
// `keys/` and `house-mandate`; wall-spelling.js).
const diskSpelling = (p) => foldName(path.posix.normalize(String(p).replace(/\\/g, '/')));

// pure — the string values an unknown tool could open as a path: any single
// line carrying a separator, at any depth of its arguments. A web address is
// not a file on this disk (a file:// one is, read past its scheme).
const pathLikeArgs = (value, depth = 0) => {
  if (typeof value === 'string') {
    const local = value.replace(/^file:\/\//i, '');
    return /[/\\]/.test(local) && !/[\r\n]/.test(local) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(local) ? [local] : [];
  }
  if (!value || typeof value !== 'object' || depth > 4) return [];
  return Object.values(value).flatMap((child) => pathLikeArgs(child, depth + 1));
};

/**
 * Check tool call arguments for dangerous patterns before execution.
 * `grantCovers` (optional) is the sensitive-grant door: a predicate over the
 * raw args — built by the call site from the lane's grants and the call's
 * direction — consulted ONLY when a sensitive substring fires, so an
 * operator-granted `.env` stops reading as a jailbreak while every ungranted
 * secret still dies here (ruling, 2026-08-18).
 * @param {string} serverName - MCP server name
 * @param {string} toolName - Tool name
 * @param {Object} args - Tool call arguments
 * @param {{ grantCovers?: (args: Object) => boolean }} [gate]
 * @returns {{ safe: boolean, reason: string|null }} Safety check result
 */
export const checkToolArgs = (serverName, toolName, args, { grantCovers = null } = {}) => {
  const targets = filesystemTargets(serverName, toolName, args);
  const argsStr = foldName(JSON.stringify(targets ?? args ?? {}));
  // Every path the call can open, spelled the way the disk reads it: matched
  // as raw text, `keys//keypair.json` or `config/./tool-policy.json` named the
  // same file and passed (security seat fuzz G-TA1, 2026-10-19).
  const paths = (targets ?? pathLikeArgs(args)).map(diskSpelling);
  const granted = grantCovers?.(args) === true;

  // Path-based checks. Key material by name counts on every server, not only
  // the two filesystem ones (G-TA3).
  const sensitive = targets
    ? paths.some((target) => hasSensitivePath(target) || isSecretFile(target))
    : argsStr.includes('.env') || argsStr.includes('credentials') || argsStr.includes('secrets') || paths.some(isSecretFile);
  if (!granted && sensitive) {
    return { safe: false, reason: 'Access to sensitive files denied — request access with request_file_access' };
  }

  // The folder itself is as protected as what it holds (G-TA2).
  const protectedDir = [argsStr, ...paths].some((text) => PROTECTED_PATH.test(text)) || paths.some((p) => SECRET_FOLDER.test(p));
  if (!granted && protectedDir) {
    return { safe: false, reason: 'Access to protected directories denied — request access with request_file_access' };
  }

  // Wallet & security policy — keep the spend allowlist/threshold, ownership,
  // and tool policy beyond a neuma's own tool reach, regardless of the arg name
  // a tool uses. Defense-in-depth for the signing path: a jailbroken neuma must
  // not be able to widen its own spend authority or disown its witness.
  // The house's MANDATE record joins them (marketing/mandate/): a mandate is the operator's to change, never the seat's.
  if ([argsStr, ...paths].some((text) => /config\/spend-|config\/tool-policy|config\/sovereignty-|owner\.json|house-mandate/.test(text))) {
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
