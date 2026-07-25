import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import "../../components/DifferentialTesting/differential-testing.css";
import { DifferentialKpiStrip } from "../DifferentialKpiStrip";
import { DifferentialLogTable } from "../DifferentialLogTable";
import { FieldMiniChart } from "../FieldMiniChart";
import { RefreshStatusChip } from "../RefreshStatusChip";
import {
  DIFFERENTIAL_POSITION_FIELD,
  DIFFERENTIAL_STORY_LOG,
  DIFFERENTIAL_STORY_NOW,
  DIFFERENTIAL_STORY_PAYLOAD,
} from "../storybook-differential-fixture";
import { DifferentialTestingDetail } from "./differential-testing-detail";

const fixture = componentPairFixture.topCard;
const payload = {
  ...DIFFERENTIAL_STORY_PAYLOAD,
  primaryChartTitle: fixture.title,
  publishedAt: fixture.publishedAt,
};
const meta = {
  title: "Patterns/TopCard",
  component: DifferentialTestingDetail,
  parameters: { layout: "fullscreen", terminalParityOwner: "oven:differential-testing" },
} satisfies Meta<typeof DifferentialTestingDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

function TopCardPreview() {
  const [mode, setMode] = useState<"progress" | "failed" | "delta">("delta");
  const chartMode = mode === "delta" ? "delta" : "value";

  return <div className="shell driving-parity-view storybook-oven-pattern storybook-top-card-pattern">
    <DifferentialTestingDetail
      payload={payload}
      progressMode={mode}
      onProgressModeChange={setMode}
      refresh={<RefreshStatusChip refresh={{ status: "idle" }} />}
      kpis={<DifferentialKpiStrip payload={payload} />}
      chart={<div id="progress-chart" className="chart hybrid-chart" role="img" aria-label={fixture.title}>
        <FieldMiniChart field={DIFFERENTIAL_POSITION_FIELD} showFrameLabels chartMode={chartMode} />
      </div>}
      log={<DifferentialLogTable entries={DIFFERENTIAL_STORY_LOG} now={DIFFERENTIAL_STORY_NOW} />}
    />
  </div>;
}

export const DifferentialTesting: Story = {
  render: () => <PairPreview component="top-card"><TopCardPreview /></PairPreview>,
};
