import type { ReactNode } from "react";
import type { ComponentPairId } from "../../../../tui/src/catalog/component-pair-fixture";
import {
  PairedPreview,
  TerminalFrame,
  componentPairFrameEntries,
} from "./TerminalFrame";

export function PairPreview({
  children,
  component,
}: {
  children: ReactNode;
  component: ComponentPairId;
}) {
  const id = `component-${component}:72x10:default`;
  const entry = componentPairFrameEntries.find((candidate) => candidate.id === id);
  if (!entry) return <p role="status">No source-backed OpenTUI frame exists for {component}.</p>;
  return (
    <div className="terminal-frame-preview">
      <p className="storybook-label">Console component · exact terminal counterpart</p>
      <PairedPreview
        consolePreview={children}
        terminalPreview={<TerminalFrame entry={entry} />}
      />
    </div>
  );
}
