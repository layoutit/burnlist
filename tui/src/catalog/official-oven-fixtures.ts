import { checklistFixture } from "./checklist-fixture";
import { differentialFixture } from "./differential-fixture";
import { modelLabFixture } from "./model-lab-fixture";
import { performanceTracingFixture } from "./performance-tracing-fixture";
import { streamingDiffFixture } from "./streaming-diff-fixture";
import { visualParityFixture } from "./visual-parity-fixture";
import type { JsonValue } from "../oven-runtime/terminal-contract";

export type OfficialOvenFixture = Readonly<{
  id: string;
  payload: JsonValue;
  footer: string;
}>;

const fixtures: readonly OfficialOvenFixture[] = [
  {
    id: "checklist",
    payload: checklistFixture.active as JsonValue,
    footer: "enter:latest detail · q:back",
  },
  {
    id: "differential-testing",
    payload: differentialFixture.payload as JsonValue,
    footer: "↑/↓:field · enter:detail · m:chart · x/f/s:controls · q:back",
  },
  {
    id: "model-lab",
    payload: modelLabFixture.ready as JsonValue,
    footer: "←/→:frame · q:back",
  },
  {
    id: "performance-tracing",
    payload: performanceTracingFixture.payload as JsonValue,
    footer: "↑/↓:field · enter:detail · m:chart · x/f/s:controls · q:back",
  },
  {
    id: "streaming-diff",
    payload: streamingDiffFixture.payload as JsonValue,
    footer: "←/→:card · ↑/↓:file · enter:expand · l:live feeds · q:back",
  },
  {
    id: "visual-parity",
    payload: visualParityFixture.payload as JsonValue,
    footer: "←/→:domain · q:back",
  },
];

const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));

export function officialOvenFixture(id: string | null | undefined): OfficialOvenFixture | null {
  return typeof id === "string" ? byId.get(id) ?? null : null;
}

