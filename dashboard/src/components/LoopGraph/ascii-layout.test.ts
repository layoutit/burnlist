import assert from "node:assert/strict";
import test from "node:test";
import { layoutAsciiGraph } from "./ascii-layout";

const graph = {
  entry: "implement",
  nodes: [
    { id: "implement", kind: "agent", role: "implementer", authority: "write" as const,
      execution: { model: "gpt-5.3-codex-spark", effort: "low", authority: "write" as const } },
    { id: "verify", kind: "check", measure: "test" as const, capability: "repo-verify" },
    { id: "review", kind: "agent", role: "reviewer", authority: "read" as const },
    { id: "converged", kind: "gate", measure: "eval" as const, target: "approved" },
    { id: "completed", kind: "terminal" }, { id: "needs-human", kind: "terminal" },
  ],
  edges: [
    { from: "implement", on: "complete", to: "verify" },
    { from: "verify", on: "pass", to: "review" },
    { from: "verify", on: "fail", to: "implement" },
    { from: "review", on: "approve", to: "converged" },
    { from: "review", on: "reject", to: "implement" },
    { from: "review", on: "escalate", to: "needs-human" },
    { from: "converged", on: "pass", to: "completed" },
    { from: "converged", on: "fail", to: "needs-human" },
  ],
};

test("lays out a responsive text-only graph with entry, outputs, decisions, and returns", () => {
  const wide = layoutAsciiGraph(graph, "review", 110);
  const narrow = layoutAsciiGraph(graph, "review", 52);
  const wideText = wide.lines.join("\n"), narrowText = narrow.lines.join("\n");
  for (const token of ["INPUT", "+", "/", "\\", "▶", "▼", "reject", "escalate",
    "IMPLEMENT", "VERIFY", "CONVERGED?", "COMPLETED"])
    assert.ok(wideText.includes(token), `missing ${token}`);
  assert.ok(narrow.lines.length > wide.lines.length);
  assert.ok(Math.max(...narrow.lines.map((line) => line.length)) <= 52);
  assert.equal(narrow.current !== null, true);
});
