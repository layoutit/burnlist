import assert from "node:assert/strict";
import test from "node:test";
import { BURNLIST_DATA_CONTRACT, fittingOvens } from "./oven-fit.mjs";

test("fittingOvens selects contract-compatible Ovens in the burnlist repository scope", () => {
  const ovens = [
    { id: "checklist", contract: "checklist-progress@1", repoKey: null, builtIn: true },
    { id: "differential-testing", contract: "burnlist-differential-testing-data@1", repoKey: null, builtIn: true },
    { id: "visual-parity", contract: "burnlist-visual-parity-data@1", repoKey: null, builtIn: true },
    { id: "streaming-diff", contract: "burnlist-streaming-diff-data@2", repoKey: null, builtIn: true },
    { id: "performance-tracing", contract: "burnlist-differential-testing-data@1", repoKey: null, builtIn: true },
    { id: "model-lab", contract: "burnlist-model-lab-data@1", repoKey: null, builtIn: true },
    { id: "release-readiness", contract: "checklist-progress@1", repoKey: "abc123", builtIn: false },
    { id: "other-repo-checklist", contract: "checklist-progress@1", repoKey: "zzz999", builtIn: false },
  ];

  const selectedIds = new Set(fittingOvens(ovens, BURNLIST_DATA_CONTRACT, { repoKey: "abc123" }).map(({ id }) => id));

  assert.equal(BURNLIST_DATA_CONTRACT, "checklist-progress@1");
  assert.deepEqual(selectedIds, new Set(["checklist", "release-readiness"]));
  for (const id of ["differential-testing", "performance-tracing", "visual-parity", "streaming-diff", "model-lab", "other-repo-checklist"]) {
    assert.equal(selectedIds.has(id), false);
  }
});
