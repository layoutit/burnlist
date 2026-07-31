import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@layout";
import { CodexThreadEvent, type CodexThreadEventValue } from "./CodexThreadEvent";

type AgentMonitorEvent = {
  [key: string]: unknown;
  category?: unknown;
  detail?: unknown;
  eventType?: unknown;
  line?: unknown;
  presentation?: unknown;
  patch?: unknown;
  result?: unknown;
  time?: unknown;
};

type AgentMonitorPatch = { lines: string[]; truncated: boolean };
type Category = "command" | "diff" | "lifecycle" | "message" | "result" | "tool";
type Result = "complete" | "failed" | "observed" | "started";

const categoryLabels: Record<Category, string> = {
  command: "Command",
  diff: "Diff",
  lifecycle: "Lifecycle",
  message: "Message",
  result: "Result",
  tool: "Tool",
};

const resultLabels: Record<Result, string> = {
  complete: "Done",
  failed: "Failed",
  observed: "Observed",
  started: "Running",
};

const terminalDetailLabels = new Set(["done", "failed", "finished", "running"]);

function categoryOf(value: unknown): Category {
  return typeof value === "string" && value in categoryLabels ? value as Category : "result";
}

function resultOf(value: unknown): Result {
  return typeof value === "string" && value in resultLabels ? value as Result : "observed";
}

function messageRoleOf(value: unknown): "agent" | "user" | undefined {
  if (typeof value !== "string") return undefined;
  const subtype = value.split("/").at(-1);
  return subtype === "agent_message" ? "agent" : subtype === "user_message" ? "user" : undefined;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function lineOf(value: unknown): string {
  const line = Number(value);
  return Number.isSafeInteger(line) && line >= 0 ? `line ${line}` : "line —";
}

function timeOf(value: unknown): { iso: string; label: string } | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  const date = new Date(value);
  return {
    iso: date.toISOString(),
    label: date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }),
  };
}

function patchOf(value: unknown): AgentMonitorPatch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as { lines?: unknown; truncated?: unknown };
  if (!Array.isArray(candidate.lines) || candidate.lines.length < 1
      || !candidate.lines.every((line) => typeof line === "string")
      || typeof candidate.truncated !== "boolean") return null;
  return { lines: candidate.lines, truncated: candidate.truncated };
}

function patchLineKind(line: string): "add" | "context" | "header" | "hunk" | "remove" {
  if (/^(?:\*\*\* |diff --git |--- |\+\+\+ )/u.test(line)) return "header";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "remove";
  return "context";
}

function detailParts(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "“") quoted = true;
    else if (value[index] === "”") quoted = false;
    else if (!quoted && value.startsWith(" · ", index)) {
      parts.push(value.slice(start, index).trim());
      index += 2;
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function detailOf(value: string, category: Category) {
  if (category === "message") return { verb: "", subject: value || "Agent update", context: [] };
  const parts = detailParts(value || "Event recorded");
  if (terminalDetailLabels.has(parts.at(-1)?.toLowerCase() ?? "")) parts.pop();
  const primary = parts.shift() ?? "Event recorded";
  const separator = primary.indexOf(" ");
  return {
    verb: separator < 0 ? primary : primary.slice(0, separator),
    subject: separator < 0 ? "" : primary.slice(separator + 1),
    context: parts,
  };
}

function inlineMarkdown(value: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/gu;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push(value.slice(cursor, index));
    const token = match[0];
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/u.exec(token);
    if (link) {
      nodes.push(<a href={link[2]} key={`${index}-link`} rel="noreferrer" target="_blank">{link[1]}</a>);
    } else if (token.startsWith("`")) {
      nodes.push(<code key={`${index}-code`}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={`${index}-strong`}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<em key={`${index}-em`}>{token.slice(1, -1)}</em>);
    }
    cursor = index + token.length;
  }
  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
}

function ContextLine({ value }: { value: string }) {
  const isSearch = value.toLowerCase().startsWith("search ");
  return <div><strong>{isSearch ? "Search:" : "Context:"}</strong>{" "}
    {isSearch ? value.slice(7) : value}
  </div>;
}

function ExactPatch({ patch }: { patch: AgentMonitorPatch }) {
  const label = patch.truncated
    ? `Patch excerpt · first ${patch.lines.length} lines`
    : `Exact patch · ${patch.lines.length} lines`;
  return <details className="agent-monitor-patch" open={patch.lines.length <= 24}>
    <summary>{label}</summary>
    <pre aria-label={label}><code>
      {patch.lines.map((line, index) =>
        <span data-kind={patchLineKind(line)} key={`${index}-${line}`}>{line || " "}</span>,
      )}
    </code></pre>
    {patch.truncated && <p>The captured patch exceeded the monitor limit.</p>}
  </details>;
}

export function AgentMonitorEventCard({ event }: { event?: AgentMonitorEvent }) {
  if (event?.presentation === "codex") {
    return <CodexThreadEvent event={event as unknown as CodexThreadEventValue} />;
  }
  const category = categoryOf(event?.category);
  const messageRole = category === "message" ? messageRoleOf(event?.eventType) : undefined;
  const result = resultOf(event?.result);
  const line = lineOf(event?.line);
  const patch = patchOf(event?.patch);
  const time = timeOf(event?.time);
  const detail = detailOf(text(event?.detail), category);
  const label = categoryLabels[category];
  const status = resultLabels[result];

  return <article
    aria-label={`${label} ${line}, ${status}`}
    className="agent-monitor-event"
    data-category={category}
    data-message-role={messageRole}
    data-result={result}
  >
    <Alert>
      <AlertTitle>
        <span className="agent-monitor-event-type">{label.toUpperCase()}</span> · {line} · {status.toUpperCase()}
        {time && <> · <time dateTime={time.iso}>{time.label}</time></>}
      </AlertTitle>
      <AlertDescription>
        {category === "message"
          ? <div>{inlineMarkdown(detail.subject)}</div>
          : <div><strong>{detail.verb}</strong>{detail.subject && ` ${detail.subject}`}</div>}
        {detail.context.map((part, index) => <ContextLine key={`${index}-${part}`} value={part} />)}
        {category === "diff" && patch && <ExactPatch patch={patch} />}
      </AlertDescription>
    </Alert>
  </article>;
}
