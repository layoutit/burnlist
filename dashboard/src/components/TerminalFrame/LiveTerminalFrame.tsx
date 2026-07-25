import { useEffect, useMemo, useState } from "react";
import type { CellGrid } from "glyphcss";
import { cellGridText } from "../../../../tui/src/catalog/component-cell-canvas";
import {
  componentPairLiveFrame,
  componentPairViewport,
  defaultPairPalette,
  type ComponentPairLiveArgs,
} from "../../../../tui/src/catalog/component-pair-live-model";
import type { ComponentPairId } from "../../../../tui/src/catalog/component-pair-fixture";
import { componentPairRegions } from "../../../../tui/src/catalog/component-pair-layout";
import { subscribeLiveTerminalCadence } from "../../../../tui/src/catalog/live-terminal-cadence";
import "./terminal-frame.css";

function useReducedMotion(explicit: unknown): boolean {
  const [system, setSystem] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setSystem(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return explicit === true || system;
}

function cells(frame: CellGrid, component: ComponentPairId) {
  const regions = componentPairRegions(component, frame.cols, frame.rows);
  return Array.from({ length: frame.rows * frame.cols }, (_, index) => ({
    char: frame.char[index] ?? " ",
    color: frame.color[index] ?? defaultPairPalette.foreground,
    x: index % frame.cols,
    y: Math.floor(index / frame.cols),
    surface: regions.some((region) => (
      index % frame.cols >= region.x
      && index % frame.cols < region.x + region.width
      && Math.floor(index / frame.cols) >= region.y
      && Math.floor(index / frame.cols) < region.y + region.height
    )),
  }));
}

export function LiveTerminalFrame({
  args,
  component,
}: {
  args: ComponentPairLiveArgs;
  component: ComponentPairId;
}) {
  const reducedMotion = useReducedMotion(args.reducedMotion), [phase, setPhase] = useState(0);
  useEffect(() => component === "spinner"
    ? subscribeLiveTerminalCadence(setPhase, reducedMotion)
    : undefined, [component, reducedMotion]);
  const viewport = componentPairViewport(component);
  const frame = useMemo(
    () => componentPairLiveFrame(component, { ...args, reducedMotion }, { ...viewport, phase }),
    [args, component, phase, reducedMotion, viewport.height, viewport.width],
  );
  return <div className="terminal-frame-scroll">
    <div
      aria-label={`Live terminal ${component} preview`}
      className="terminal-frame terminal-frame-live"
      data-component={component}
      data-live-terminal="true"
      data-phase={phase}
      data-semantic-text={cellGridText(frame)}
      style={{ gridTemplateColumns: `repeat(${frame.cols}, 1ch)` }}
    >
      {cells(frame, component).map((cell) => <span
        className="terminal-cell"
        data-char={cell.char}
        data-x={cell.x}
        data-y={cell.y}
        key={`${cell.x}:${cell.y}`}
        style={{ color: cell.color, backgroundColor: cell.surface ? "var(--terminal-pair-surface, #202024)" : undefined }}
      >{cell.char}</span>)}
    </div>
  </div>;
}
