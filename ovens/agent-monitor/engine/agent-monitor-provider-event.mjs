import { createHash } from "node:crypto";

function bounded(value, limit = 360) {
  return String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, limit);
}

function redact(value) {
  return bounded(value, 1_000)
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|(?:ghp|github_pat|xox[baprs]|AKIA)[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/-]{8,})\b/giu, "[REDACTED]")
    .slice(0, 360);
}

function event(provider, record, line, session, raw, fallbackTime, values = {}) {
  const signature = createHash("sha256").update(raw).digest("hex");
  const category = values.category ?? "context";
  return {
    id: `${session}:${line}:${signature.slice(0, 12)}`,
    line,
    time: values.time ?? record?.timestamp ?? record?.ts ?? record?.created_at ?? fallbackTime,
    category,
    eventType: `${provider}/${values.eventType ?? record?.type ?? "unknown"}`,
    title: `${category.toUpperCase()} · line ${line}`,
    detail: bounded(values.detail ?? `${provider} session event`),
    result: values.result ?? "observed",
    actionKey: values.actionKey ?? null,
    callKey: values.callKey ?? null,
    patch: values.patch ?? null,
    risk: values.risk ?? null,
    signature,
  };
}

function contentItems(record) {
  const content = record?.message?.content ?? record?.content;
  return Array.isArray(content) ? content : content ? [{ type: "text", text: content }] : [];
}

export function projectClaudeRecord(record, line, session, raw, fallbackTime) {
  const type = record?.type ?? "unknown";
  const items = contentItems(record);
  const tool = items.find((item) => item?.type === "tool_use");
  const result = items.find((item) => item?.type === "tool_result");
  const text = items.find((item) => item?.type === "text")?.text;
  if (tool) return event("claude", record, line, session, raw, fallbackTime, {
    category: "tool",
    detail: `${bounded(tool.name || "Tool", 80)} tool call`,
    result: "started",
    callKey: bounded(tool.id, 64) || null,
  });
  if (result) return event("claude", record, line, session, raw, fallbackTime, {
    category: "result",
    detail: result.is_error ? "Tool call failed" : "Tool call complete",
    result: result.is_error ? "failed" : "complete",
    callKey: bounded(result.tool_use_id, 64) || null,
  });
  if (type === "user") return event("claude", record, line, session, raw, fallbackTime, {
    category: "message", detail: "New user instruction",
  });
  if (type === "assistant") return event("claude", record, line, session, raw, fallbackTime, {
    category: "message", detail: redact(text || "Agent update"),
  });
  return event("claude", record, line, session, raw, fallbackTime, {
    category: type === "system" ? "lifecycle" : "context",
    detail: type === "system" ? `Claude ${bounded(record?.subtype || "session")} event` : "Claude context updated",
  });
}

export function projectGrokRecord(record, line, session, raw, fallbackTime) {
  const type = bounded(record?.type || "unknown", 80);
  const toolName = record?.tool_name ?? record?.toolName ?? record?.name ?? record?.tool?.name;
  if (type === "tool_started") return event("grok", record, line, session, raw, fallbackTime, {
    category: "tool", detail: `${bounded(toolName || "Tool", 80)} tool call`, result: "started",
  });
  if (type === "tool_completed") {
    const failed = record?.error || record?.status === "failed" || record?.success === false;
    return event("grok", record, line, session, raw, fallbackTime, {
      category: "result", detail: failed ? "Tool call failed" : "Tool call complete",
      result: failed ? "failed" : "complete",
    });
  }
  if (type.includes("permission")) return event("grok", record, line, session, raw, fallbackTime, {
    category: "tool", detail: "Permission decision", result: type.endsWith("resolved") ? "complete" : "started",
  });
  if (type === "turn_started" || type === "loop_started" || type === "turn_ended") {
    return event("grok", record, line, session, raw, fallbackTime, {
      category: "lifecycle", detail: `Grok ${type.replaceAll("_", " ")}`,
      result: type.endsWith("ended") ? "complete" : "started",
    });
  }
  return event("grok", record, line, session, raw, fallbackTime, {
    category: "context", detail: `Grok ${type.replaceAll("_", " ")}`,
  });
}

export function projectAgyRecord(record, line, session, raw, fallbackTime) {
  const type = bounded(record?.type || "unknown", 80);
  if (type === "USER_INPUT") return event("agy", record, line, session, raw, fallbackTime, {
    category: "message", detail: "New user instruction",
  });
  if (type === "PLANNER_RESPONSE") return event("agy", record, line, session, raw, fallbackTime, {
    category: "message", detail: redact(record?.content || "Agent update"),
  });
  if (type === "CHECKPOINT") return event("agy", record, line, session, raw, fallbackTime, {
    category: "lifecycle", detail: "Antigravity checkpoint", result: record?.status === "failed" ? "failed" : "complete",
  });
  const toolLike = /TOOL|COMMAND|EXEC/iu.test(type);
  return event("agy", record, line, session, raw, fallbackTime, {
    category: toolLike ? "tool" : "context",
    detail: `Antigravity ${type.toLowerCase().replaceAll("_", " ")}`,
    result: record?.status === "failed" ? "failed" : toolLike ? "complete" : "observed",
  });
}
