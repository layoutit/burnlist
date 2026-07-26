import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { checklistFixture } from "./ChecklistDashboard.fixture.mjs";

const adapterPath = new URL("../../lib/checklist-adapter.ts", import.meta.url).pathname;

test("adaptChecklist precomputes the checklist oven payload", async () => {
  const outputDir = await mkdtemp(join(process.cwd(), ".checklist-adapter-test-"));
  try {
    const outputPath = join(outputDir, "checklist-adapter.mjs");
    await build({ entryPoints: [adapterPath], bundle: true, format: "esm", outfile: outputPath, platform: "node", target: "node18" });
    const { adaptChecklist } = await import(`${new URL(`file://${outputPath}`).href}?test=${Date.now()}`);
    assert.deepEqual(adaptChecklist(checklistFixture), {
      raw: checklistFixture,
      items: [],
      current: { value: "Complete", title: "No active task" },
      progress: { done: 2, total: 2, percent: 100, title: "2 of 2 tasks complete" },
      durations: { elapsed: "10m", pace: "5m", timeLeft: "0m" },
      ledger: [
        { key: "B2/2026-07-15T11:50:00Z", age: "10m", event: "B2", result: "Done", delta: "+1", donePercent: 100 },
        { key: "B1/2026-07-15T11:40:00Z", age: "20m", event: "B1", result: "Done", delta: "+1", donePercent: 50 },
      ],
      history: checklistFixture.history,
      events: [
        { ...checklistFixture.completed[1], ordinal: 2, percent: 100, key: "B2/2026-07-15T11:50:00Z", age: "10m", fields: [
          { label: "Completed", values: ["2026-07-15T11:50:00Z"] }, { label: "Changed", values: ["src/second.mjs"] }, { label: "Proof", values: ["node --test second.test.mjs"] }, { label: "Outcome", values: ["Second proof."] }, { label: "Follow-up", values: ["None."] },
        ] },
        { ...checklistFixture.completed[0], ordinal: 1, percent: 50, key: "B1/2026-07-15T11:40:00Z", age: "20m", fields: [{ label: "Detail", values: ["First proof."] }] },
      ],
    });
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
});
