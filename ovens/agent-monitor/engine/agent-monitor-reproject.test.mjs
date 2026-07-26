import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { reprojectRecentAgentMonitorEvents } from "./agent-monitor-reproject.mjs";

const NOW = "2026-07-26T12:00:00.000Z";

function record(payload) {
  return JSON.stringify({ timestamp: NOW, type: "response_item", payload });
}

test("projection upgrades expand past a large tail record to recover the retained closure", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-monitor-reproject-"));
  try {
    const path = join(root, "session.jsonl");
    const records = Array.from({ length: 300 }, (_, index) =>
      record({ type: "agent_message", message: `Visible update ${index + 1}` }));
    records.push(record({ type: "reasoning", summary: "x".repeat(8_000) }));
    writeFileSync(path, `${records.join("\n")}\n`);
    const stat = statSync(path);
    const result = reprojectRecentAgentMonitorEvents({
      cursor: { offset: stat.size, line: records.length },
      generatedAt: NOW,
      initialLimit: 1_024,
      maxEvents: 256,
      maxFileBytes: stat.size,
      path,
      session: "session-a",
    });

    assert.equal(result.events.length, 300);
    assert.equal(result.events[0].detail, "Visible update 300");
    assert.equal(result.events.at(-1).detail, "Visible update 1");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
