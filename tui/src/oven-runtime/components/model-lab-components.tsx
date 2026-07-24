import { fitText } from "../../theme";
import { useTerminalPalette } from "../../terminal-accessibility";
import type { JsonValue, TerminalNode } from "../terminal-contract";
import { resolveOvenPointer } from "../value-runtime";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const text = (value: unknown) => typeof value === "string" ? value : "—";
const number = (value: unknown) => Number.isFinite(value) ? Number(value) : 0;
const data = (node: TerminalNode, payload?: JsonValue) => record(resolveOvenPointer(payload, typeof node.attributes.source === "string" ? node.attributes.source : "/"));
const hash = (value: unknown) => { const source = text(value); return source.length > 18 ? `${source.slice(0, 10)}…${source.slice(-6)}` : source; };

/** Compact, terminal-native projection of the declarative Model Lab view. */
export function TerminalModelLabView({ node, payload, width, height = 14, selectedId }: { node: TerminalNode; payload?: JsonValue; width: number; height?: number; selectedId?: string }) {
  const palette = useTerminalPalette();
  const value = data(node, payload), model = record(value.model), actor = record(model.actor), protocol = record(value.terminal), frame = record(protocol.frame), metrics = record(protocol.metrics), comparison = record(value.comparison), animations = Array.isArray(model.animations) ? model.animations.map(record) : [];
  const count = Math.max(1, number(frame.count) || number(model.frameCount)), index = number(frame.index) || number(model.frameIndex);
  const current = animations.find((animation) => index >= number(animation.firstFrameIndex) && index < number(animation.firstFrameIndex) + number(animation.frameCount)) ?? animations[0] ?? {};
  const status = text(protocol.status), ready = status === "ready" && protocol.ready === true, error = text(protocol.error), rows = [
    `MODEL LAB  ${ready ? "● READY" : status === "error" ? "× FAILURE" : "○ UNAVAILABLE"}`,
    `${fitText(text(record(value.project).label), Math.max(10, width - 17))} · ${fitText(text(model.id), 16)}`,
    `Frame ${index}/${count - 1}  ${fitText(text(frame.id) === "—" ? text(model.frameId) : text(frame.id), Math.max(8, width - 19))}`,
    `Session ${fitText(text(protocol.sessionId), Math.max(8, width - 9))}`,
    `Scenario ${fitText(text(protocol.scenario), Math.max(8, width - 10))}`,
    `Animation ${fitText(text(current.symbol), Math.max(8, width - 15))} · ${number(current.frameCount)}f`,
    `DOM ${number(metrics.domNodeCount)}  visible ${number(metrics.visibleLeafCount)}/${number(model.leafCount)}  rendered ${number(metrics.renderedLeafCount)}`,
    `Stable ${number(metrics.stableLeafIdentityCount)}/${number(model.leafCount)}  mutations ${number(metrics.childListMutationCount)}`,
    `Player ${fitText(`${text(actor.country)} #${number(actor.shirtNumber)} · ${text(actor.name)}`, Math.max(8, width - 7))}`,
    `Topology ${text(model.topologyMode)} · LOD ${number(model.lodCount)} · <${text(model.leafTag)}> × ${number(model.leafCount)}`,
    `${ready ? "Evidence" : "Retained snapshot"} ${hash(record(value.evidence).renderPublicationSha256)} · ${hash(model.frameSetHash)}`,
    ready ? `Comparison ${comparison.pass === true ? "MATCH" : comparison.pass === false ? "DIFF OPEN" : "unavailable"} · 0° 45° 180°` : "Live comparison unavailable",
    ready ? "Images Native / Model Lab / Diff" : "Retained images unavailable for live state",
    ready ? "←/→ request frame · await correlated result" : `Live reason ${fitText(error, Math.max(8, width - 12))}`,
  ];
  return <box width={width} height={height} flexDirection="column" overflow="hidden">{rows.slice(0, Math.max(1, height)).map((line, index) => <box key={index} height={1}><text fg={index === 0 ? ready ? palette.green : palette.amber : index === 2 ? palette.blue : "#d4d4d8"}>{fitText(line, width)}</text></box>)}</box>;
}
