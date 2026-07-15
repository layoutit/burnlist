import { hookCapture, hookNoop, hookText } from "./streaming-diff-hook-contract.mjs";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

const MUTATING_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const EVENTS = { SessionStart: "ensure", PreToolUse: "pre", PostToolUse: "post", PostToolUseFailure: "failure" };
const CLAUDE_GIT_TIMEOUT_MS = 500;

function within(root, path) {
  const value = relative(root, path);
  return value === "" || (value !== ".." && !value.startsWith(`..${sep}`));
}

function realpathWithMissingTail(path) {
  const tail = [];
  let probe = path;
  while (true) {
    try { return resolve(realpathSync(probe), ...tail.reverse()); } catch (error) {
      if (error?.code !== "ENOENT" || dirname(probe) === probe) throw error;
      tail.push(basename(probe));
      probe = dirname(probe);
    }
  }
}

function worktreeRoot(cwd) {
  return realpathSync(execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
    encoding: "utf8", shell: false, timeout: CLAUDE_GIT_TIMEOUT_MS, maxBuffer: 64 * 1024,
  }).trim());
}

export function claudeRepoRelativePath(path, { cwd = process.cwd(), root = worktreeRoot(cwd) } = {}) {
  if (!isAbsolute(path)) return null;
  const candidate = realpathWithMissingTail(resolve(path));
  return within(root, candidate) ? relative(root, candidate).split(sep).join("/") : null;
}

export function mapClaudeHook(payload = {}, event, env = process.env, options) {
  try {
    event ??= EVENTS[payload.hook_event_name];
    if (event === "ensure") return hookCapture({ event, session: payload.session_id ?? env.CLAUDE_SESSION_ID });
    if (!MUTATING_TOOLS.has(payload.tool_name)) return hookNoop();
    const input = payload.tool_input && typeof payload.tool_input === "object" ? payload.tool_input : {};
    const absolutePath = hookText(input.file_path) ?? hookText(input.notebook_path);
    const path = absolutePath ? claudeRepoRelativePath(absolutePath, options) : null;
    return hookCapture({
      event,
      session: payload.session_id ?? env.CLAUDE_SESSION_ID,
      toolUseId: payload.tool_use_id,
      hintedPaths: path ? [path] : [],
    });
  } catch {
    return hookCapture({
      event,
      session: payload?.session_id ?? env.CLAUDE_SESSION_ID,
      toolUseId: payload?.tool_use_id,
    });
  }
}
