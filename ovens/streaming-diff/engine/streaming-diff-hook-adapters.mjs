import { mapClaudeHook } from "./streaming-diff-claude-hook.mjs";
import { mapCodexHook } from "./streaming-diff-codex-hook.mjs";

export function mapStreamingDiffHook({ agent, event, payload, env, cwd } = {}) {
  if (agent === "claude") return mapClaudeHook(payload, event, env, { cwd });
  if (agent === "codex") return mapCodexHook(payload, event, env);
  return { action: "noop", args: [], degraded: true };
}
