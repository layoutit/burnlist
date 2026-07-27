import { describe, expect, test } from "bun:test";
import { isManagedChecklist } from "./app-screens";
import type { BurnlistSummary, OvenSummary } from "./types";

const burnlist = { planPath: "notes/burnlists/active/example/plan.md" } as BurnlistSummary;
const oven = (id: string, dataInput: OvenSummary["dataInput"]) => ({
  id,
  contract: "checklist-progress@1",
  dataInput,
} as OvenSummary);

describe("managed checklist selection", () => {
  test("uses canonical progress for JSON-payload checklist lenses", () => {
    expect(isManagedChecklist(oven("checklist", "json-payload"), burnlist)).toBe(true);
    expect(isManagedChecklist(oven("loop-progress", "json-payload"), burnlist)).toBe(true);
  });

  test("preserves producer-managed Oven payloads that share the checklist contract", () => {
    expect(isManagedChecklist(oven("agent-monitor", "producer-managed"), burnlist)).toBe(false);
  });
});
