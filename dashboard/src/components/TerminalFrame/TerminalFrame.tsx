import type { ReactNode } from "react";
import index from "../../generated/terminal-frames/index.json";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@layout";
import { glyphFixture } from "../../../../tui/src/catalog/glyph-fixture";
import { cellModels, frameState, packedRgba, selectFrameEntry, textStyle, type FrameControls, type FrameEntry, type StaticFrame } from "./terminal-frame-model";
import "./terminal-frame.css";

const modules = import.meta.glob("../../generated/terminal-frames/*.json", { eager: true, import: "default" }) as Record<string, StaticFrame>;
export const terminalFrameEntries = (index.entries as FrameEntry[]).filter((entry) => entry.id.startsWith(`${glyphFixture.id}:`));
export const sharedListFrameEntries = (index.entries as FrameEntry[]).filter((entry) => entry.id.startsWith("shared-lists:"));
export const statusFrameEntries = (index.entries as FrameEntry[]).filter((entry) => entry.id.startsWith("heading-status:"));
export const frameForEntry = (entry: FrameEntry) => {
  const frame = modules[`../../generated/terminal-frames/${entry.path}`];
  if (!frame) throw new Error(`Missing indexed terminal frame ${entry.path}`);
  return frame;
};

export function PairedPreview({ consolePreview, terminalPreview }: { consolePreview: ReactNode; terminalPreview: ReactNode }) {
  return <div className="terminal-pair"><section aria-label="Console preview">{consolePreview}</section><section aria-label="Terminal preview">{terminalPreview}</section></div>;
}

export function TerminalFrame({ entry }: { entry: FrameEntry }) {
  const frame = frameForEntry(entry);
  return <div className="terminal-frame-scroll"><div aria-label={`Terminal frame ${entry.checkpoint}`} className="terminal-frame" style={{ gridTemplateColumns: `repeat(${frame.viewport.width}, 1ch)` }}>
    {cellModels(frame).map((cell) => <span key={`${cell.x}:${cell.y}`} className="terminal-cell" data-x={cell.x} data-y={cell.y} data-char={cell.char} data-fg={cell.fg} data-bg={cell.bg} data-attributes={cell.attributes} data-continuation={cell.continuation} style={{ color: packedRgba(cell.fg), backgroundColor: packedRgba(cell.bg), ...textStyle(cell.attributes) }}>{cell.continuation ? null : cell.char}</span>)}
  </div></div>;
}

function ConsoleFixture({ entry }: { entry: FrameEntry }) {
  const state = frameState(entry.checkpoint);
  return <Card><CardHeader><CardTitle>{glyphFixture.title}</CardTitle><CardDescription>Shared deterministic fixture</CardDescription></CardHeader><CardContent><Badge variant={state?.selected === "ember" ? "default" : "outline"}>Selected · {state?.selected}</Badge><p>{state?.motion === "reduced" ? "motion: reduced" : `motion: frame ${state?.animation.slice(1)}`}</p><p>{glyphFixture.hint}</p></CardContent></Card>;
}

export function TerminalFramePreview(controls: FrameControls) {
  const entry = selectFrameEntry(terminalFrameEntries, controls);
  if (!entry) return <p role="status">No precomputed frame exists for this control combination.</p>;
  const frame = frameForEntry(entry);
  return <div className="terminal-frame-preview"><PairedPreview consolePreview={<ConsoleFixture entry={entry} />} terminalPreview={<TerminalFrame entry={entry} />} /><details><summary>Semantic text</summary><pre>{frame.semanticText.join("\n")}</pre></details></div>;
}
