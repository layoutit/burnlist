import type { ReactNode } from "react";
import componentIndex from "../../generated/terminal-component-frames/index.json";
import { cellModels, packedRgba, textStyle, type FrameEntry, type StaticFrame } from "./terminal-frame-model";
import "./terminal-frame.css";

const componentModules = import.meta.glob("../../generated/terminal-component-frames/*.json", { eager: true, import: "default" }) as Record<string, StaticFrame>;
export const componentPairFrameEntries = componentIndex.entries as FrameEntry[];
export const frameForEntry = (entry: FrameEntry) => {
  const frame = componentModules[`../../generated/terminal-component-frames/${entry.path}`];
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
