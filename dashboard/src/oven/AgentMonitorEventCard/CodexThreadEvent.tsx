import type { ReactNode } from "react";
import { ChevronDown, FilePlus2, RotateCcw } from "lucide-react";

type CodexFile = {
  additions?: unknown;
  path?: unknown;
  removals?: unknown;
};

export type CodexThreadEventValue = {
  additions?: unknown;
  content?: unknown;
  count?: unknown;
  files?: unknown;
  key?: unknown;
  kind?: unknown;
  label?: unknown;
  phase?: unknown;
  removals?: unknown;
  role?: unknown;
};

function number(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function inlineMarkdown(value: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/gu;
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

function MarkdownBody({ value }: { value: string }) {
  const lines = value.split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      index += index < lines.length ? 1 : 0;
      blocks.push(<pre data-language={language || undefined} key={`code-${index}`}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/u.exec(line);
    if (heading) {
      const Tag = `h${Math.min(heading[1].length + 2, 5)}` as "h3" | "h4" | "h5";
      blocks.push(<Tag key={`heading-${index}`}>{inlineMarkdown(heading[2])}</Tag>);
      index += 1;
      continue;
    }
    if (/^[-*]\s+/u.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/u.test(lines[index])) {
        items.push(lines[index].replace(/^[-*]\s+/u, ""));
        index += 1;
      }
      blocks.push(<ul key={`list-${index}`}>{items.map((item, itemIndex) =>
        <li key={`${itemIndex}-${item}`}>{inlineMarkdown(item)}</li>,
      )}</ul>);
      continue;
    }
    if (/^\d+\.\s+/u.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/u.test(lines[index])) {
        items.push(lines[index].replace(/^\d+\.\s+/u, ""));
        index += 1;
      }
      blocks.push(<ol key={`ordered-${index}`}>{items.map((item, itemIndex) =>
        <li key={`${itemIndex}-${item}`}>{inlineMarkdown(item)}</li>,
      )}</ol>);
      continue;
    }
    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim()
      && !/^(?:```|#{1,3}\s+|[-*]\s+|\d+\.\s+)/u.test(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(<p key={`paragraph-${index}`}>{inlineMarkdown(paragraph.join(" "))}</p>);
  }
  return <>{blocks}</>;
}

function EditStats({ additions, removals }: { additions: number; removals: number }) {
  return <span className="codex-edit-stats">
    <span data-tone="add">+{additions}</span>
    <span data-tone="remove">-{removals}</span>
  </span>;
}

function FileRow({ file }: { file: CodexFile }) {
  const path = typeof file.path === "string" ? file.path : "Changed file";
  return <div className="codex-edit-file">
    <span title={path}>{path}</span>
    <EditStats additions={number(file.additions)} removals={number(file.removals)} />
  </div>;
}

function EditCard({ event }: { event: CodexThreadEventValue }) {
  const files = Array.isArray(event.files) ? event.files as CodexFile[] : [];
  const count = number(event.count) || files.length;
  const visible = files.slice(0, 3);
  const hidden = files.slice(3);
  return <article className="codex-thread-event codex-edit-card" data-kind="edits">
    <header className="codex-edit-header">
      <span aria-hidden="true" className="codex-edit-icon"><FilePlus2 /></span>
      <div className="codex-edit-heading">
        <strong>Edited {count} {count === 1 ? "file" : "files"}</strong>
        <EditStats additions={number(event.additions)} removals={number(event.removals)} />
      </div>
      <div aria-hidden="true" className="codex-edit-actions">
        <span>Undo <RotateCcw /></span>
        <span className="codex-review-button">Review</span>
      </div>
    </header>
    <div className="codex-edit-files">
      {visible.map((file, index) => <FileRow file={file} key={`${index}-${String(file.path)}`} />)}
      {hidden.length > 0 && <details>
        <summary>Show {hidden.length} more {hidden.length === 1 ? "file" : "files"} <ChevronDown /></summary>
        {hidden.map((file, index) => <FileRow file={file} key={`${index}-${String(file.path)}`} />)}
      </details>}
    </div>
  </article>;
}

export function CodexThreadEvent({ event }: { event: CodexThreadEventValue }) {
  if (event.kind === "edits") return <EditCard event={event} />;
  if (event.kind === "worked") {
    return <div className="codex-thread-event codex-worked" data-kind="worked">
      <span>{typeof event.label === "string" ? event.label : "Worked"}</span>
      <span aria-hidden="true">›</span>
    </div>;
  }
  const role = event.role === "user" ? "user" : "agent";
  const content = typeof event.content === "string" ? event.content : "";
  return <article
    className="codex-thread-event codex-message"
    data-kind="message"
    data-phase={typeof event.phase === "string" ? event.phase : undefined}
    data-role={role}
  >
    <div className="codex-message-body"><MarkdownBody value={content} /></div>
  </article>;
}
