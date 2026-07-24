import { fitText, palette, visibleWindow } from "../../theme";
import type { JsonValue, TerminalNode } from "../terminal-contract";
import { evaluateOvenBinding, resolveOvenPointer } from "../value-runtime";

type Row = Readonly<Record<string, JsonValue>>;
export type StreamingDiffFile = Readonly<{ path: string; kind: string; diff?: string; reason?: string; bytes?: number }>;
export type StreamingDiffCard = Readonly<{ toolUseId: string; revId: string; ts: string; status: string; partialReason?: string; files: readonly StreamingDiffFile[] }>;
export type StreamingDiffModel = Readonly<{ session: string; cards: readonly StreamingDiffCard[]; expanded: boolean }>;
const asRow = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const string = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "";
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const textKind = (kind: string) => ["added", "deleted", "modified"].includes(kind);
const source = (node: TerminalNode, payload?: JsonValue) => node.bindings.source ? evaluateOvenBinding(node.bindings.source, payload) : resolveOvenPointer(payload, node.attributes.source);

/** Safe projection: array-valued `diff-card` sources are cards, never a singular fallback. */
export function streamingDiffModel(node: TerminalNode, payload: JsonValue | undefined, expanded = false): StreamingDiffModel {
  const session = string(resolveOvenPointer(payload, "/identity/session"));
  const rawCards = source(node, payload), cards = (Array.isArray(rawCards) ? rawCards : []).slice(0, 12).map((raw: JsonValue) => {
    const card = asRow(raw), files = (Array.isArray(card.files) ? card.files : []).slice(0, 8).map((item) => {
      const file = asRow(item), meta = asRow(file.meta), kind = string(file.kind) || "unknown";
      const withheld = meta.redacted === true || ["binary", "denied", "redacted", "truncated", "unavailable"].includes(kind);
      return { path: string(file.path) || "(unnamed)", kind, ...(!withheld && textKind(kind) && string(file.diff) ? { diff: string(file.diff) } : {}), ...(string(meta.reason) ? { reason: string(meta.reason) } : {}), ...(number(meta.bytes) !== undefined ? { bytes: number(meta.bytes) } : {}) };
    });
    return { toolUseId: string(card.toolUseId) || "tool", revId: string(card.revId) || "revision", ts: string(card.ts), status: string(card.status) || "complete", ...(string(card.partialReason) ? { partialReason: string(card.partialReason) } : {}), files };
  });
  return { session, cards, expanded };
}

function FileLine({ file, width, expanded }: { file: StreamingDiffFile; width: number; expanded: boolean }) {
  const meta = file.reason ? file.reason + (file.bytes !== undefined ? ` · ${file.bytes} bytes` : "") : file.bytes !== undefined ? `${file.bytes} bytes` : "Diff content is unavailable.";
  const content = file.diff ? expanded ? file.diff.split("\n").slice(0, 3) : ["Press Enter to expand diff."] : [meta];
  return <box width={width} height={1 + Math.min(3, content.length)} flexDirection="column" overflow="hidden"><text fg={file.diff ? palette.green : palette.amber}>{fitText(`${expanded && file.diff ? "▾" : "▸"} ${file.path} · ${file.kind}`, width)}</text>{content.slice(0, 3).map((line, index) => <text key={index} fg={file.diff ? palette.muted : palette.dim}>{fitText(`  ${line}`, width)}</text>)}</box>;
}

/** Generic IR-kind terminal renderer with bounded cards/hunks and redaction-safe metadata. */
export function TerminalStreamingDiff({ node, payload, width, height = 10, expanded = false }: { node: TerminalNode; payload?: JsonValue; width: number; height?: number; expanded?: boolean }) {
  const model = streamingDiffModel(node, payload, expanded), rows = Math.max(1, Math.floor(height));
  const cards = visibleWindow([...model.cards], 0, 1).items;
  return <box width={width} height={rows} flexDirection="column" overflow="hidden">
    {!cards.length ? <text fg={palette.dim}>{fitText("Waiting for diff cards.", width)}</text> : cards.map((card, cardIndex) => <box key={`${card.revId}:${cardIndex}`} flexDirection="column" overflow="hidden">
      <text fg={card.status === "partial" ? palette.amber : palette.blue}>{fitText(`${card.toolUseId} · ${card.revId} · ${card.status}`, width)}</text>
      {card.partialReason ? <text fg={palette.amber}>{fitText(`! ${card.partialReason}`, width)}</text> : null}
      {card.files.slice(0, model.expanded ? 2 : 1).map((file, fileIndex) => <FileLine key={`${file.path}:${fileIndex}`} file={file} width={width} expanded={model.expanded && cardIndex === 0 && fileIndex === 0} />)}
    </box>)}
  </box>;
}

export function TerminalStreamingDiffHeading({ node, payload, width }: { node: TerminalNode; payload?: JsonValue; width: number }) {
  const session = string(resolveOvenPointer(payload, node.attributes.session));
  return <box width={width} height={2} flexDirection="column" overflow="hidden"><text fg={palette.blue}>{fitText("← Recent feeds", width)}</text><text fg={palette.foreground}>{fitText(`Streaming Diff · Session ${session}`, width)}</text></box>;
}

/** Landing feed family is deliberately separate from the selected-session Oven. */
export function TerminalStreamingFeedList({ payload, width, height = 6 }: { payload?: JsonValue; width: number; height?: number }) {
  const root = asRow(payload), feeds = Array.isArray(root.feeds) ? root.feeds.slice(0, Math.max(1, height - 2)) : [];
  if (string(root.error)) return <box width={width} height={height}><text fg={palette.red}>{fitText(string(root.error), width)}</text></box>;
  if (root.loading === true) return <box width={width} height={height}><text fg={palette.dim}>{fitText("Loading recent feeds.", width)}</text></box>;
  if (!feeds.length) return <box width={width} height={height}><text fg={palette.dim}>{fitText("No recent feeds.", width)}</text></box>;
  return <box width={width} height={height} flexDirection="column" overflow="hidden"><text fg={palette.foreground}>{fitText("Streaming Diff feeds", width)}</text>{feeds.map((item, index) => { const feed = asRow(item), identity = asRow(feed.identity); return <box key={index} height={3} flexDirection="column" overflow="hidden"><text fg={palette.muted}>{fitText(`${string(identity.session)} · worktree ${string(identity.worktreeKey)}`, width)}</text>{root.showRepository === true ? <text fg={palette.muted}>{fitText(`repository ${string(feed.repoLabel)}`, width)}</text> : null}<text fg={palette.dim}>{fitText(string(feed.updatedAt), width)}</text></box>; })}</box>;
}
