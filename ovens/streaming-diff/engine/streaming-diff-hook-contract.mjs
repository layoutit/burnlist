import { STREAMING_DIFF_CAPTURE_LIMITS } from "./streaming-diff-capture.mjs";

const FALLBACK_SESSION = "unknown-session";
const FALLBACK_TOOL_USE = "unknown-tool-use";

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function boundedPaths(hintedPaths) {
  const paths = [];
  const seen = new Set();
  let truncated = false;
  for (const value of Array.isArray(hintedPaths) ? hintedPaths : []) {
    const path = text(value);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    if (path.length > STREAMING_DIFF_CAPTURE_LIMITS.maxPathLength
      || Buffer.byteLength(path, "utf8") > STREAMING_DIFF_CAPTURE_LIMITS.maxPathLength
      || paths.length >= STREAMING_DIFF_CAPTURE_LIMITS.maxPaths) {
      truncated = true;
      continue;
    }
    paths.push(path);
  }
  return { paths, truncated };
}

export function hookCapture({ event, session, toolUseId, hintedPaths = [] } = {}) {
  const safeSession = text(session) ?? FALLBACK_SESSION;
  const safeToolUseId = text(toolUseId) ?? FALLBACK_TOOL_USE;
  const bounded = boundedPaths(hintedPaths);
  const reasons = [
    !text(session) && "missing session",
    !text(toolUseId) && "missing tool use id",
    bounded.paths.length === 0 && "missing path hints",
    bounded.truncated && "path hints truncated",
  ].filter(Boolean);
  const degraded = reasons.length > 0;
  if (event === "ensure") {
    return { action: "ensure-feed", args: ["ensure-feed", "--session", safeSession], degraded: !text(session), ...(!text(session) ? { degradedReason: "missing session" } : {}) };
  }
  if (!["pre", "post", "failure"].includes(event)) return { action: "noop", args: [], degraded: true };
  const terminalReason = event === "failure" ? "tool-failed" : bounded.truncated ? "path-hints-truncated" : null;
  return {
    action: "capture",
    args: ["capture", "--session", safeSession, "--tool-use-id", safeToolUseId, "--phase", event === "pre" ? "pre" : "post", ...(terminalReason ? ["--terminal-reason", terminalReason] : []), ...bounded.paths.flatMap((path) => ["--path", path])],
    degraded,
    ...(terminalReason ? { terminalReason } : {}),
    ...(degraded ? { degradedReason: reasons.join("; ") } : {}),
  };
}

export function hookNoop() {
  return { action: "noop", args: [], degraded: false };
}

export function hookText(value) {
  return text(value);
}
