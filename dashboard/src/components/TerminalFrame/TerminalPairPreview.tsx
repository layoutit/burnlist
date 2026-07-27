import type { CSSProperties, ReactNode } from "react";
import type { ComponentPairId } from "../../../../tui/src/catalog/component-pair-fixture";
import type { ComponentPairLiveArgs } from "../../../../tui/src/catalog/component-pair-live-model";
import { LiveTerminalFrame } from "./LiveTerminalFrame";
// @ts-expect-error Pure CSS-layout authority is JavaScript for Node verification.
import { pairMinimumPaneRem } from "./pair-layout.mjs";

function PairedPreview({ component, consolePreview, terminalPreview }: { component: ComponentPairId; consolePreview: ReactNode; terminalPreview: ReactNode }) {
  const style = { "--pair-min-pane": `${pairMinimumPaneRem(component)}rem` } as CSSProperties;
  return <div className="terminal-pair" data-pair-component={component} style={style}><section aria-label="Console preview">{consolePreview}</section><section aria-label="Terminal preview">{terminalPreview}</section></div>;
}

export function PairPreview({
  children,
  component,
  terminalArgs,
}: {
  children: ReactNode;
  component: ComponentPairId;
  terminalArgs: ComponentPairLiveArgs;
}) {
  return (
    <div className="terminal-frame-preview">
      <p className="storybook-label">Console component · live terminal counterpart</p>
      <PairedPreview
        component={component}
        consolePreview={children}
        terminalPreview={<LiveTerminalFrame args={terminalArgs} component={component} />}
      />
    </div>
  );
}
