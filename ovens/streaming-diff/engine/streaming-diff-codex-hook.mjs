import { hookCapture, hookNoop, hookText } from "./streaming-diff-hook-contract.mjs";

const MUTATING_TOOLS = new Set(["apply_patch", "write_file", "edit_file", "create_file", "delete_file", "rename_file", "move_file"]);
const PATH_KEYS = ["file_path", "filepath", "path", "target_path", "source_path", "destination_path"];
const EVENTS = { SessionStart: "ensure", PreToolUse: "pre", PostToolUse: "post", PostToolUseFailure: "failure" };

function object(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    try { return object(JSON.parse(value)); } catch { return {}; }
  }
  return {};
}

function patchPaths(value) {
  if (typeof value !== "string") return [];
  const result = [];
  for (const match of value.matchAll(/^\*\*\* (?:Add|Update|Delete) File:\s*(.+?)\s*$/gmu)) result.push(match[1]);
  for (const match of value.matchAll(/^\*\*\* Move to:\s*(.+?)\s*$/gmu)) result.push(match[1]);
  return [...new Set(result.map(hookText).filter(Boolean))];
}

function paths(input) {
  const result = PATH_KEYS.map((key) => hookText(input[key])).filter(Boolean);
  if (Array.isArray(input.files)) result.push(...input.files.flatMap((entry) => paths(object(entry))));
  // Codex supplies apply_patch's complete envelope in tool_input.command.
  // `input.patch` was an invented shape and silently yielded no hints.
  result.push(...patchPaths(input.command));
  return [...new Set(result)];
}

export function mapCodexHook(payload = {}, event, env = process.env) {
  try {
    event ??= EVENTS[payload.hook_event_name ?? payload.hookEventName ?? payload.event];
    if (event === "ensure") return hookCapture({ event, session: payload.session_id ?? payload.sessionId ?? env.CODEX_SESSION_ID });
    const tool = hookText(payload.tool_name) ?? hookText(payload.toolName) ?? hookText(payload.name);
    if (!tool) return hookCapture({ event, session: payload.session_id ?? payload.sessionId ?? env.CODEX_SESSION_ID });
    if (!tool || !MUTATING_TOOLS.has(tool.replace(/^functions\./u, ""))) return hookNoop();
    const input = object(payload.tool_input ?? payload.toolInput ?? payload.input ?? payload.arguments);
    return hookCapture({
      event,
      session: payload.session_id ?? payload.sessionId ?? env.CODEX_SESSION_ID,
      toolUseId: payload.tool_use_id ?? payload.toolUseId ?? payload.call_id ?? payload.id,
      hintedPaths: paths(input),
    });
  } catch {
    return hookCapture({ event });
  }
}
