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
  historyTitle: fixture.historyTitle,
  publishedAt: fixture.publishedAt,
};
const pairChartField = {
  ...DIFFERENTIAL_POSITION_FIELD,
  samples: fixture.chart.map((point, index) => [index, 0, point.value, point.state === "fail" ? 1 : 0] as [number, number, number, number]),
};
const meta = {
  title: "Patterns/TopCard",
  component: DifferentialTestingDetail,
  args: {
    title: fixture.title,
    historyTitle: fixture.historyTitle,
    publishedAt: fixture.publishedAt,
    chart: fixture.chart,
  },
  parameters: { layout: "fullscreen", terminalParityOwner: "oven:differential-testing" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function TopCardPreview({ args }: { args: Record<string, unknown> }) {
  const [mode, setMode] = useState<"progress" | "failed" | "delta">("delta");
  const chartMode = mode === "delta" ? "delta" : "value";
  const storyPayload = { ...payload, primaryChartTitle: String(args.title), historyTitle: String(args.historyTitle), publishedAt: String(args.publishedAt) };
  const points = Array.isArray(args.chart) ? args.chart as typeof fixture.chart : fixture.chart;
  const storyField = { ...pairChartField, samples: points.map((point, index) => [index, 0, point.value, point.state === "fail" ? 1 : 0] as [number, number, number, number]) };

  return <div className="shell driving-parity-view storybook-oven-pattern storybook-top-card-pattern">
    <DifferentialTestingDetail
      payload={storyPayload}
      progressMode={mode}
      onProgressModeChange={setMode}
      refresh={<RefreshStatusChip refresh={{ status: "idle" }} />}
      kpis={<DifferentialKpiStrip payload={storyPayload} />}
      chart={<div id="progress-chart" className="chart hybrid-chart" role="img" aria-label={String(args.title)}>
        <FieldMiniChart field={storyField} showFrameLabels chartMode={chartMode} />
      </div>}
      log={<DifferentialLogTable entries={DIFFERENTIAL_STORY_LOG} now={DIFFERENTIAL_STORY_NOW} />}
    />
  </div>;
}

export const Playground: Story = {
  render: (args) => <PairPreview component="top-card" terminalArgs={args}><TopCardPreview args={args} /></PairPreview>,
};
