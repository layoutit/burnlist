import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
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
      payload={DIFFERENTIAL_STORY_PAYLOAD}
      progressMode={mode}
      onProgressModeChange={setMode}
      refresh={<RefreshStatusChip refresh={{ status: "idle" }} />}
      kpis={<DifferentialKpiStrip payload={DIFFERENTIAL_STORY_PAYLOAD} />}
      chart={<div id="progress-chart" className="chart hybrid-chart" role="img" aria-label="Differential delta over time">
        <FieldMiniChart field={DIFFERENTIAL_POSITION_FIELD} showFrameLabels chartMode={chartMode} />
      </div>}
      log={<DifferentialLogTable entries={DIFFERENTIAL_STORY_LOG} now={DIFFERENTIAL_STORY_NOW} />}
    />
  </div>;
}

export const DifferentialTesting: Story = {
  render: () => <TopCardPreview />,
};
