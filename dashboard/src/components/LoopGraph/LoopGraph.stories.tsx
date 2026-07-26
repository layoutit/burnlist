import type { Meta, StoryObj } from "@storybook/react-vite";
import { LoopGraph, type LoopGraphProjection } from "./LoopGraph";
import { LoopCompact } from "./LoopCompact";
import { LoopLegend } from "./LoopLegend";
import { OvenRuntime } from "../../oven/runtime/OvenRuntime";

const base: LoopGraphProjection = {
  itemRef: "item:260724-001#D1",
  loopId: "loop:builtin:review",
  state: "running",
  currentNode: "verify",
  attempt: 1,
  cycle: 0,
  graph: {
    nodes: [
      { id: "implement", kind: "agent", role: "implementer", authority: "write", execution: { profileId: "maker", model: "gpt-5.3-codex-spark", effort: "low", authority: "write" } },
      { id: "verify", kind: "check", measure: "test", capability: "repo-verify" },
      { id: "review", kind: "agent", role: "reviewer", authority: "read", execution: { profileId: "reviewer", model: "gpt-5.6-sol", effort: "xhigh", authority: "read" } },
      { id: "converged", kind: "gate", measure: "eval", target: "approved" },
      { id: "completed", kind: "terminal" },
      { id: "needs-human", kind: "terminal" },
    ],
    edges: [
      { from: "implement", on: "complete", to: "verify" },
      { from: "verify", on: "pass", to: "review" },
      { from: "verify", on: "fail", to: "implement" },
      { from: "review", on: "approve", to: "converged" },
      { from: "review", on: "reject", to: "implement" },
      { from: "review", on: "escalate", to: "needs-human" },
      { from: "converged", on: "pass", to: "completed" },
    ],
  },
  transitions: [{ sequence: 1, from: "implement", outcome: "complete", to: "verify" }],
  budget: {
    limits: { maxRounds: 3, maxMinutes: 60, maxAgentRuns: 6, maxCheckRuns: 3, maxTransitions: 16, maxOutputBytes: 262144 },
    counters: { rounds: 1, agentRuns: 1, checkRuns: 0, transitions: 1, outputBytes: 2400 },
    elapsedMilliseconds: 42000,
    journal: { maximum: 262144, used: 8192, remaining: 253952 },
  },
  latestMaker: { summary: "Candidate prepared.", at: Date.parse("2026-07-24T10:00:00Z"), candidateId: "candidate-1" },
};

const branch: LoopGraphProjection = {
  ...base,
  loopId: "loop:example:branch",
  currentNode: "validate-a",
  graph: {
    entry: "plan",
    nodes: [
      { id: "plan", kind: "agent", role: "orchestrator", authority: "write" },
      { id: "implement-a", kind: "agent", role: "implementer", authority: "write" }, { id: "implement-b", kind: "agent", role: "implementer", authority: "write" },
      { id: "validate-a", kind: "check", measure: "test", capability: "tests-a" }, { id: "validate-b", kind: "check", measure: "eval", capability: "eval-b" },
      { id: "combine", kind: "agent", role: "integrator", authority: "write" },
      { id: "review", kind: "agent", role: "reviewer", authority: "read" }, { id: "completed", kind: "terminal" },
    ],
    edges: [
      { from: "plan", on: "branch-a", to: "implement-a" }, { from: "plan", on: "branch-b", to: "implement-b" },
      { from: "implement-a", on: "complete", to: "validate-a" }, { from: "implement-b", on: "complete", to: "validate-b" },
      { from: "validate-a", on: "pass", to: "combine" }, { from: "validate-b", on: "pass", to: "combine" },
      { from: "combine", on: "complete", to: "review" }, { from: "review", on: "approve", to: "completed" },
      { from: "review", on: "revise", to: "plan" },
    ],
  },
};

const metric: LoopGraphProjection = {
  ...base,
  loopId: "loop:example:metric-gate",
  currentNode: "measure-fps",
  graph: {
    entry: "optimize",
    nodes: [
      { id: "optimize", kind: "agent", role: "implementer", authority: "write" },
      { id: "measure-fps", kind: "check", measure: "metric", capability: "measure-fps" },
      { id: "fps-gate", kind: "gate", measure: "metric", target: "fps >= 60" }, { id: "completed", kind: "terminal" },
      { id: "needs-human", kind: "terminal" },
    ],
    edges: [
      { from: "optimize", on: "complete", to: "measure-fps" }, { from: "measure-fps", on: "measured", to: "fps-gate" },
      { from: "fps-gate", on: "target-met", to: "completed" }, { from: "fps-gate", on: "below-target", to: "optimize" },
      { from: "measure-fps", on: "invalid", to: "needs-human" },
    ],
  },
};

const implementVerify: LoopGraphProjection = {
  ...base,
  loopId: "loop:example:implement-verify",
  currentNode: "implement",
  graph: {
    entry: "implement",
    nodes: [
      { id: "implement", kind: "agent", role: "implementer", authority: "write", execution: { profileId: "fast-maker", model: "gpt-5.3-codex-spark", effort: "low", authority: "write" } },
      { id: "verify", kind: "check", measure: "test", capability: "repo-verify" },
      { id: "completed", kind: "terminal" },
    ],
    edges: [
      { from: "implement", on: "complete", to: "verify" },
      { from: "verify", on: "pass", to: "completed" },
      { from: "verify", on: "fail", to: "implement" },
    ],
  },
};

const meta = {
  title: "Components/LoopGraph",
  component: LoopGraph,
  decorators: [(Story) => <div style={{ margin: "32px auto", maxWidth: 760 }}><Story /></div>],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof LoopGraph>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Prepared: Story = { args: { run: { ...base, state: "prepared", currentNode: "implement", attempt: 0 } } };
export const ImplementAndVerify: Story = { args: { run: implementVerify } };
export const Running: Story = { args: { run: base } };
export const Compact: Story = {
  args: { run: base },
  render: () => <LoopCompact run={base} />,
};
export const CompactWithOutcomeLabels: Story = {
  args: { run: base },
  render: () => <LoopCompact labels="outcomes" run={base} />,
};
export const Legend: Story = {
  args: { run: base },
  render: () => <LoopLegend run={base} />,
};
export const WithLegend: Story = {
  args: { run: base },
  render: () => <div style={{ display: "grid", gap: 24 }}>
    <LoopGraph run={base} />
    <LoopLegend run={base} />
  </div>,
};
export const CompactWithLegend: Story = {
  args: { run: base },
  render: () => <div style={{ display: "grid", gap: 16 }}>
    <LoopCompact run={base} />
    <LoopLegend run={base} />
  </div>,
};
export const CompactBranchWithLegend: Story = {
  args: { run: branch },
  render: () => <div style={{ display: "grid", gap: 16 }}>
    <LoopCompact run={branch} />
    <LoopLegend run={branch} />
  </div>,
};
export const CompactLabeledBranchWithLegend: Story = {
  args: { run: branch },
  render: () => <div style={{ display: "grid", gap: 16 }}>
    <LoopCompact labels="outcomes" run={branch} />
    <LoopLegend run={branch} />
  </div>,
};
export const RepairCycle: Story = {
  args: {
    run: {
      ...base, currentNode: "implement", attempt: 2, cycle: 1,
      transitions: [
        ...base.transitions!,
        { sequence: 2, from: "verify", outcome: "fail", to: "implement" },
      ],
      latestResult: { kind: "check-failed", summary: "Repository verification requested a repair." },
    },
  },
};
export const Converged: Story = {
  args: { run: { ...base, state: "converged", currentNode: "converged", transitions: [...base.transitions!, { sequence: 2, from: "verify", outcome: "pass", to: "review" }, { sequence: 3, from: "review", outcome: "approve", to: "converged" }] } },
};
export const NeedsHuman: Story = {
  args: { run: { ...base, state: "needs-human", currentNode: "review", latestResult: { kind: "escalated", summary: "Reviewer evidence could not establish convergence." } } },
};
export const CorruptProjection: Story = {
  args: { run: null, diagnostic: "corrupt", message: "The journal could not be verified. The last trusted projection is retained." },
};

export const OvenComposition: Story = {
  args: { run: base },
  render: () => <OvenRuntime
    ir={{
      id: "custom-loop-dashboard",
      contract: "custom-loop-dashboard@1",
      controls: [],
      collections: [],
      root: [{ kind: "loop-graph", attributes: { source: "/loopRun", title: "Composed by a custom Oven" } }],
    } as never}
    payload={{ loopRun: base }}
  />,
};

export const NarrowResponsive: Story = {
  args: { run: base },
  decorators: [(Story) => <div style={{ margin: "24px", width: 420 }}><Story /></div>],
};
export const BranchAndCombine: Story = { args: { run: branch } };
export const BranchAndCombineNarrow: Story = {
  args: { run: branch },
  decorators: [(Story) => <div style={{ margin: "24px", width: 420 }}><Story /></div>],
};
export const MetricGate: Story = { args: { run: metric } };
