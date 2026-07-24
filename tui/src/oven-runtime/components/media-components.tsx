import { GlyphImage } from "../../glyph-image";
import { decodePngDataUri } from "../../png-glyph";
import { fitText } from "../../theme";
import { useTerminalPalette } from "../../terminal-accessibility";
import type { JsonValue, TerminalNode } from "../terminal-contract";
import { evaluateOvenBinding, resolveOvenPointer } from "../value-runtime";

type RecordValue = Readonly<Record<string, JsonValue>>;
type Image = Readonly<{ label: string; src: string | null }>;
export type MediaModel = Readonly<{ domains: readonly string[]; selected: string; metrics: readonly [string, string][]; note: string; frames: readonly Readonly<{ frame: string; status: string; summary: string; label: string; images: readonly Image[] }>[] }>;

const record = (value: unknown): RecordValue | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : undefined;
const string = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "";
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const value = (node: TerminalNode, key: string, payload: JsonValue | undefined, scope?: JsonValue) => {
  const binding = node.bindings[key];
  if (binding) return evaluateOvenBinding(binding, scope ?? payload);
  const attribute = node.attributes[key];
  return typeof attribute === "string" && attribute.startsWith("/") ? resolveOvenPointer(scope ?? payload, attribute) : attribute;
};
const binding = (node: TerminalNode, key: string, payload: JsonValue | undefined, scope?: JsonValue) => value(node, key, payload, scope);
const percent = (raw: unknown) => `${(number(raw) * 100).toFixed(2)}%`;
const delta = (raw: unknown) => number(raw).toFixed(3);

function selectedScope(node: TerminalNode, payload: JsonValue | undefined, selected: string) {
  const source = typeof node.attributes.source === "string" ? resolveOvenPointer(payload, node.attributes.source) : undefined;
  const scopes = record(source);
  return scopes?.[selected];
}

function images(raw: unknown): readonly Image[] {
  return Array.isArray(raw) ? raw.slice(0, 3).map((entry, index) => {
    const image = record(entry); return { label: string(image?.label) || ["Current", "Reference", "Difference"][index]!, src: typeof image?.src === "string" ? image.src : null };
  }) : [];
}

/** Generic IR projection for the Visual Parity family; it never identifies an Oven. */
export function mediaModel(nodes: readonly TerminalNode[], payload: JsonValue | undefined, controls: Readonly<Record<string, string | boolean>>): MediaModel {
  const find = (kind: string) => nodes.find((node) => node.kind === kind);
  const tabs = find("domain-tabs"), metric = find("metric-tiles"), note = find("domain-note"), card = find("frame-card");
  const domains = Array.isArray(tabs && value(tabs, "source", payload)) ? (value(tabs!, "source", payload) as readonly JsonValue[]).map((item) => typeof item === "string" ? item : string(record(item)?.id)).filter(Boolean) : [];
  const selected = tabs && typeof tabs.attributes.id === "string" && typeof controls[tabs.attributes.id] === "string" ? String(controls[tabs.attributes.id]) : domains[0] ?? "";
  const summary = metric ? selectedScope(metric, payload, selected) : undefined;
  const metrics: [string, string][] = metric ? [["Frames", `${number(binding(metric, "passed", payload, summary))}/${number(binding(metric, "total", payload, summary))}`], ["Changed", percent(binding(metric, "ratio", payload, summary))], ["Mean RGB", delta(binding(metric, "meanAbsoluteDelta", payload, summary))], ["Max delta", string(binding(metric, "maximumAbsoluteDelta", payload, summary))]] : [];
  const noteScope = note ? selectedScope(note, payload, selected) : undefined;
  const noteText = note ? string(binding(note, "rationale", payload, noteScope)) : "";
  const cardScope = card ? selectedScope(card, payload, selected) : undefined;
  const frames = Array.isArray(record(cardScope)?.frames) ? (record(cardScope)?.frames as readonly JsonValue[]).slice(0, 2).map((entry) => {
    const frame = record(entry), difference = record(frame?.difference);
    return { frame: string(frame?.frame), status: string(frame?.status) || "unknown", summary: `${percent(difference?.ratio)} · mean ${delta(difference?.meanAbsoluteDelta)} · max ${string(difference?.maximumAbsoluteDelta)}`, label: string(frame?.label) || "Visual comparison", images: images(frame?.images) };
  }) : [];
  return { domains, selected, metrics, note: noteText, frames };
}

/** Pre-paint fail-closed validation for all media roots; shared with paint. */
export function validateMediaRoots(nodes: readonly TerminalNode[], payload: JsonValue | undefined, controls: Readonly<Record<string, string | boolean>>) {
  const model = mediaModel(nodes, payload, controls);
  if (nodes.some((node) => node.kind === "frame-card") && !model.frames.length) throw new Error("Visual Parity frame-card requires a selected frame collection.");
  for (const frame of model.frames) {
    if (frame.images.length !== 3 || frame.images.some((image) => !image.src)) throw new Error("Visual Parity frame-card requires current, reference, and difference PNG images.");
    for (const image of frame.images) decodePngDataUri(image.src!);
  }
  return model;
}

export function validateVerdictRoot(node: TerminalNode, payload: JsonValue | undefined) {
  value(node, "targetPass", payload); value(node, "framesCount", payload); value(node, "error", payload);
}

export function TerminalDomainTabs({ model, width }: { model: MediaModel; width: number }) {
  const palette = useTerminalPalette();
  const text = model.domains.map((domain) => domain === model.selected ? `[${domain}]` : domain).join("  ");
  return <text fg={palette.blue}>{fitText(`←/→ domains: ${text}`, width)}</text>;
}

export function TerminalVerdictHeader({ node, payload, width }: { node: TerminalNode; payload?: JsonValue; width: number }) {
  const palette = useTerminalPalette();
  const pass = Boolean(value(node, "targetPass", payload)), frames = string(value(node, "framesCount", payload)), error = string(value(node, "error", payload));
  return <text fg={pass ? palette.green : palette.red}>{fitText(error ? `Verdict: ${error}` : `Verdict: ${pass ? "PASS" : "FAIL"}${frames ? ` · ${frames} frames` : ""}`, width)}</text>;
}

export function TerminalMetricTiles({ model, width }: { model: MediaModel; width: number }) {
  const palette = useTerminalPalette();
  const compact = model.metrics.map(([label, metric]) => `${label} ${metric}`).join(" · ");
  return <box width={width} height={width < 48 ? 4 : 2} flexDirection="column" overflow="hidden">{width < 48 ? model.metrics.map(([label, metric]) => <text key={label}>{fitText(`${label}: ${metric}`, width)}</text>) : <text>{fitText(compact, width)}</text>}</box>;
}

function Frame({ frame, width, height }: { frame: MediaModel["frames"][number]; width: number; height: number }) {
  const palette = useTerminalPalette();
  const imageWidth = Math.max(4, Math.floor((width - 4) / 3));
  const imageHeight = Math.max(1, Math.min(7, height - 3));
  return <box width={width} height={height} flexDirection="column" overflow="hidden" border={height > 3 ? ["top"] : undefined} borderColor={palette.dim}>
    <text fg={frame.status === "pass" ? palette.green : palette.amber}>{fitText(`Frame ${frame.frame} · ${frame.status} · ${frame.summary}`, width)}</text>
    <box height={1} flexDirection="row">{frame.images.map((image) => <text key={image.label} width={imageWidth}>{fitText(image.label, imageWidth)}</text>)}</box>
    <box height={imageHeight} flexDirection="row">{frame.images.map((image) => <GlyphImage key={image.label} source={image.src} width={imageWidth} height={imageHeight} />)}</box>
  </box>;
}

export function TerminalFrameCards({ model, width, height }: { model: MediaModel; width: number; height: number }) {
  const frameHeight = Math.max(3, Math.floor(height / Math.max(1, model.frames.length)));
  return <box width={width} height={height} flexDirection="column" overflow="hidden">{model.frames.map((item) => <Frame key={`${item.frame}-${item.label}`} frame={item} width={width} height={frameHeight} />)}</box>;
}

export function TerminalMediaSurface({ nodes, payload, controls, width, height }: { nodes: readonly TerminalNode[]; payload?: JsonValue; controls: Readonly<Record<string, string | boolean>>; width: number; height: number }) {
  const palette = useTerminalPalette();
  const model = mediaModel(nodes, payload, controls);
  return <box width={width} height={height} flexDirection="column" overflow="hidden"><TerminalDomainTabs model={model} width={width} /><TerminalMetricTiles model={model} width={width} />{model.note ? <text fg={palette.muted}>{fitText(model.note, width)}</text> : null}<TerminalFrameCards model={model} width={width} height={Math.max(3, height - 4)} /></box>;
}
