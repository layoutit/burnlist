import { createHash } from "node:crypto";
import {
  agentMonitorPatchFiles,
  extractAgentMonitorPatch,
} from "./agent-monitor-patch.mjs";

function bounded(value, limit = 360) {
  return String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, limit);
}

function redactSecrets(value) {
  return String(value ?? "")
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|(?:ghp|github_pat|xox[baprs]|AKIA)[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/-]{8,})\b/giu, "[REDACTED]")
    .replace(/\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD))\s*=\s*[^\s]+/gu, "$1=[REDACTED]")
    .replace(/(--(?:api-?key|password|secret|token)(?:=|\s+))\S+/giu, "$1[REDACTED]");
}

function redact(value, limit = 360) {
  const safe = redactSecrets(bounded(value, 4_000));
  return bounded(safe, limit);
}

function conversationText(value, { user = false } = {}, limit = 12_000) {
  let safe = redactSecrets(String(value ?? "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, " "))
    .replace(/<in-app-browser-context\b[\s\S]*?<\/in-app-browser-context>/gu, "")
    .replace(/<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>/gu, "")
    .replace(/^::[a-z][a-z-]*\{[^\n]*\}\s*$/gmu, "")
    .trim();
  if (user) {
    const marker = /(?:^|\n)#{1,6}\s+My request for Codex:\s*\n/gu;
    const matches = [...safe.matchAll(marker)];
    const last = matches.at(-1);
    if (last) safe = safe.slice((last.index ?? 0) + last[0].length);
  }
  return safe
    .trim()
    .slice(0, limit)
    .trim();
}

function commands(input) {
  if (typeof input !== "string") return [];
  return [...input.matchAll(/(?:\bcmd\b|["']cmd["'])\s*:\s*("(?:\\.|[^"\\])*")/gs)].flatMap((match) => {
    try { return [JSON.parse(match[1])]; } catch { return []; }
  });
}

function callInfo(payload) {
  if (payload?.type === "function_call") {
    try {
      const parsed = JSON.parse(payload.arguments ?? "{}");
      return {
        name: payload.name ?? "tool",
        commands: typeof parsed.cmd === "string" ? [parsed.cmd] : [],
        input: typeof parsed.input === "string" ? parsed.input
          : typeof parsed.patch === "string" ? parsed.patch
            : payload.arguments ?? "",
      };
    } catch {
      return { name: payload.name ?? "tool", commands: [], input: payload.arguments ?? "" };
    }
  }
  return { name: payload?.name ?? "tool", commands: commands(payload?.input), input: payload?.input ?? "" };
}

function resultOf(output) {
  if (output && typeof output === "object") {
    const code = output.exit_code ?? output.exitCode ?? output.statusCode;
    if (Number.isInteger(code)) return code === 0 ? "complete" : "failed";
    if (output.status === "failed" || output.error) return "failed";
    if (output.status === "completed" || output.status === "complete") return "complete";
  }
  const text = String(output ?? "");
  if (/(?:exit(?:ed)?(?:_code| code)|process\s+exited\s+(?:with\s+)?code)[^0-9]*[1-9]|script failed|tool error/iu.test(text)) {
    return "failed";
  }
  if (/(?:exit(?:ed)?(?:_code| code)|process\s+exited\s+(?:with\s+)?code)[^0-9]*0|script completed|completed successfully/iu.test(text)) {
    return "complete";
  }
  if (/script running|process running|running with (?:cell|session) id/iu.test(text)) return "started";
  return text.trim() ? "complete" : "observed";
}

function toolName(value) {
  return bounded(value || "tool", 80).split(".").at(-1);
}

function commandFamily(command) {
  const words = String(command ?? "").trim().split(/\s+/u).filter(Boolean);
  while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(words[0])) words.shift();
  const executable = (words.shift() ?? "command").replace(/^['"]|['"]$/gu, "").split("/").at(-1);
  const safe = executable?.replace(/[^A-Za-z0-9_.+-]/gu, "").slice(0, 48) || "command";
  if (safe === "git" && /^[A-Za-z-]+$/u.test(words[0] ?? "")) return `git ${words[0]}`;
  if (["npm", "pnpm", "yarn"].includes(safe) && words[0] === "run" && /^[A-Za-z0-9:._-]+$/u.test(words[1] ?? "")) {
    return `${safe} run ${words[1]}`;
  }
  return safe === "node" ? "node script" : safe;
}

function commandTokens(value) {
  return String(value ?? "").match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s|;&]+/gu)?.map((token) => {
    if ((token.startsWith("\"") && token.endsWith("\"")) || (token.startsWith("'") && token.endsWith("'"))) {
      return token.slice(1, -1);
    }
    return token;
  }) ?? [];
}

function safePath(value) {
  let path = String(value ?? "")
    .replace(/^\d*>/u, "")
    .replace(/^HEAD:/u, "")
    .replace(/[),]+$/u, "")
    .replace(/^\/Users\/[^/]+/u, "~")
    .replace(/^\.\//u, "")
    .replace(/\{[^}]{20,}\}/gu, "{…}");
  const parts = path.split("/").filter(Boolean);
  if (parts.length > 2) path = parts.slice(-2).join("/");
  return redact(path, 90);
}

function commandPaths(command) {
  const paths = [];
  const add = (value) => {
    const path = safePath(value);
    if (path && !paths.includes(path)) paths.push(path);
  };
  for (const token of commandTokens(command)) {
    const candidate = token.replace(/^\d*>/u, "").replace(/^HEAD:/u, "").replace(/[),]+$/u, "");
    if (!candidate || candidate.startsWith("-") || /^[a-z]+:\/\//iu.test(candidate)
        || candidate === "/dev/null" || candidate.length > 180 || /\s/u.test(candidate)
        || candidate.includes("$") || candidate.includes("\\") || candidate.includes("(")
        || (!candidate.includes("/") && !/\.[A-Za-z0-9_-]{1,8}$/u.test(candidate))) continue;
    add(candidate);
  }
  for (const match of String(command).matchAll(/(["'`])([A-Za-z0-9_@.+~/-]+\.(?:css|html|js|json|md|mjs|mts|ts|tsx|ya?ml))\1/gu)) {
    add(match[2]);
  }
  return paths;
}

function pathList(paths, limit = 3) {
  if (!paths.length) return "";
  const shown = paths.slice(0, limit).join(", ");
  return paths.length > limit ? `${shown} (+${paths.length - limit})` : shown;
}

function searchPattern(command) {
  const tokens = commandTokens(command);
  const index = tokens.findIndex((token) => token.split("/").at(-1) === "rg");
  if (index < 0) return "";
  let cursor = index + 1;
  while (tokens[cursor]?.startsWith("-")) cursor += 1;
  return redact(tokens[cursor] ?? "", 90)
    .replace(/\\+([.()[\]{}])/gu, "$1")
    .replace(/\\[bBdDsSwW]/gu, " ")
    .replace(/\s*\|\s*/gu, " · ")
    .replace(/\s+/gu, " ")
    .trim();
}

function commandIntent(command) {
  const text = String(command ?? "");
  const paths = commandPaths(text);
  const files = pathList(paths);
  const pattern = searchPattern(text);
  const packageRun = /\b(npm|pnpm|yarn)\s+run\s+([A-Za-z0-9:._-]+)/u.exec(text);
  if (packageRun) return `Run ${packageRun[1]} ${packageRun[2]}`;
  const packageExec = /\b(?:npm|pnpm|yarn)\s+exec\s+([A-Za-z0-9:._-]+)/u.exec(text)?.[1];
  if (packageExec) return packageExec === "tsc" ? "Run TypeScript typecheck" : `Run ${packageExec}`;
  const packageCommand = /\b(npm|pnpm|yarn)\s+(test|install|build)\b/u.exec(text);
  if (packageCommand) return `Run ${packageCommand[1]} ${packageCommand[2]}`;
  if (/\bnode\s+--test\b/u.test(text)) return `Run tests${files ? ` · ${files}` : ""}`;
  if (/\bgit\s+diff\s+--check\b/u.test(text)) return "Check patch whitespace";
  if (/\bgit\s+status\b/u.test(text)) return "Check Git status";
  if (/\bgit\s+diff\b/u.test(text)) return `Inspect Git diff${files ? ` · ${files}` : ""}`;
  if (/\brg(?:\s|$)/u.test(text) && /\bsed\s+-n\b/u.test(text)) {
    return `Inspect ${files || "source"}${pattern ? ` · search “${pattern}”` : ""}`;
  }
  if (/\brg(?:\s|$)/u.test(text)) return `Search “${pattern || "source pattern"}”${files ? ` · ${files}` : ""}`;
  if (/\bsed\s+-n\b|\b(?:cat|head|tail)\s/u.test(text)) return `Inspect ${files || "source"}`;
  if (/\bgit\s+show\b/u.test(text)) return `Inspect Git revision${files ? ` · ${files}` : ""}`;
  const findName = /\bfind\s+(\S+).*?-name\s+['"]?([^'"\s]+)/u.exec(text);
  if (findName) return `Find ${redact(findName[2], 60)} under ${safePath(findName[1])}`;
  const curlUrl = /\bcurl\b[\s\S]*?\b(https?:\/\/[^\s'"]+)/u.exec(text)?.[1];
  if (curlUrl) {
    try {
      const url = new URL(curlUrl);
      return `Check HTTP ${url.host}${url.pathname}`;
    } catch { /* fall through to the executable summary */ }
  }
  if (/\bnode\b[\s\S]*\s(?:-e|--eval)\s/u.test(text)) {
    return `Run inline Node check${files ? ` · ${files}` : ""}`;
  }
  const nodeScript = /\bnode\s+(?!-)([^\s]+)/u.exec(text)?.[1];
  if (nodeScript) return `Run ${safePath(nodeScript)}`;
  if (/\bmv\s/u.test(text)) return `Move ${files || "files"}`;
  if (/\brmdir\s/u.test(text)) return `Remove empty directory${files ? ` · ${files}` : ""}`;
  if (/\btest\s/u.test(text)) return `Check ${files || "condition"}`;
  if (/\bjq\s/u.test(text)) return `Inspect JSON${files ? ` · ${files}` : ""}`;
  return `${commandFamily(text)}${files ? ` · ${files}` : ""}`;
}

function actionKey(info) {
  const source = info.commands.length ? info.commands.join("\n") : "";
  return source ? createHash("sha256").update(source).digest("hex").slice(0, 24) : null;
}

function destructive(info) {
  return info.commands.some((command) => /\b(git\s+(?:reset|restore|clean)|rm\s+-(?=[^\s]*r)(?=[^\s]*f)[^\s]+|(?:del|rmdir)\s+\/s)\b/iu.test(command));
}

function commandDetail(info) {
  const name = toolName(info.name);
  if (info.commands.length) return commandIntent(info.commands.join("\n"));
  const labels = {
    update_plan: "Update execution plan",
    request_user_input: "Request user input",
    tool_search: "Find available capability",
    view_image: "Inspect image",
    write_stdin: "Wait for running task",
  };
  return labels[name] ?? `${name} tool call`;
}

function requestsGitDiff(info) {
  return info.commands.some((command) => String(command).split(/\n|&&|;|\|\|/u).some((segment) =>
    /\bgit\s+diff\b/u.test(segment) && !/\bgit\s+diff\b[^;&|\n]*--check\b/u.test(segment),
  ));
}

function recordCallKey(payload) {
  const value = payload?.call_id ?? payload?.id;
  return typeof value === "string" && value
    ? createHash("sha256").update(value).digest("hex").slice(0, 24)
    : null;
}

export function projectCodexRecord(record, line, session, raw, fallbackTime = new Date().toISOString()) {
  const top = typeof record?.type === "string" ? record.type : "unknown";
  const subtype = typeof record?.payload?.type === "string" ? record.payload.type : "";
  const eventType = subtype ? `${top}/${subtype}` : top;
  const time = Number.isFinite(Date.parse(record?.timestamp)) ? new Date(record.timestamp).toISOString() : fallbackTime;
  let category = "other";
  let detail = "Event recorded";
  let result = "observed";
  let eventActionKey = null;
  let eventCallKey = null;
  let message = null;
  let patch = null;
  let phase = null;
  let risk = null;
  const payload = record?.payload ?? {};

  if (subtype === "reasoning" || subtype === "agent_reasoning") {
    category = "reasoning";
    detail = "Reasoning event · private content withheld";
  } else if (subtype === "patch_apply_end") {
    category = "other";
    detail = "Patch application completed";
    result = "complete";
  } else if (["custom_tool_call", "function_call", "tool_search_call"].includes(subtype)) {
    const info = callInfo(payload);
    patch = extractAgentMonitorPatch(info.input);
    const patchFiles = agentMonitorPatchFiles(patch);
    const name = toolName(info.name);
    category = name.includes("apply_patch") || patchFiles.length || requestsGitDiff(info) ? "diff"
      : name === "exec" || name === "exec_command" ? "command" : "tool";
    detail = patchFiles.length ? `Patch ${pathList(patchFiles.map(safePath))}` : commandDetail(info);
    eventActionKey = actionKey(info);
    eventCallKey = recordCallKey(payload);
    risk = destructive(info) ? "destructive" : null;
    result = payload.status === "completed" ? "complete" : "started";
  } else if (["custom_tool_call_output", "function_call_output", "tool_search_output"].includes(subtype)) {
    category = "result";
    result = resultOf(payload.output);
    patch = extractAgentMonitorPatch(payload.output);
    detail = result === "failed" ? "Tool call failed" : `Tool call ${result}`;
    eventCallKey = recordCallKey(payload);
  } else if (subtype === "agent_message") {
    category = "message";
    detail = redact(payload.message || "Agent update");
    message = conversationText(payload.message || "Agent update");
    phase = ["commentary", "final_answer"].includes(payload.phase) ? payload.phase : null;
  } else if (subtype === "user_message") {
    category = "message";
    detail = "New user instruction";
    message = conversationText(payload.message || "New user instruction", { user: true });
  } else if (subtype === "message") {
    category = "message";
    detail = `${payload.role ?? "Conversation"} message envelope`;
  } else if (top === "session_meta" || top === "turn_context" || top === "compacted"
      || subtype === "context_compacted" || subtype === "thread_settings_applied") {
    category = "context";
    detail = subtype === "context_compacted" || top === "compacted" ? "Context compacted" : "Session context updated";
  } else if (subtype === "task_started" || subtype === "task_complete") {
    category = "lifecycle";
    detail = subtype === "task_started" ? "Agent task started" : "Agent task completed";
    result = subtype === "task_started" ? "started" : "complete";
  } else if (subtype === "token_count") {
    const usage = payload.info?.last_token_usage?.total_tokens;
    const window = payload.info?.model_context_window;
    category = "usage";
    detail = Number.isFinite(usage)
      ? `Last usage ${usage.toLocaleString()} tokens${Number.isFinite(window) ? ` · context ${window.toLocaleString()}` : ""}`
      : "Token usage updated";
  } else if (top === "world_state") {
    category = "state";
    detail = "World-state snapshot recorded";
  }

  const signature = createHash("sha256").update(raw).digest("hex");
  return {
    id: `${session}:${line}:${signature.slice(0, 12)}`,
    line,
    time,
    category,
    eventType,
    title: `${category.toUpperCase()} · line ${line}`,
    detail: bounded(detail),
    result,
    actionKey: eventActionKey,
    callKey: eventCallKey,
    message,
    patch,
    phase,
    risk,
    signature,
  };
}
