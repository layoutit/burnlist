import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { discoverBurnlistSummaries } from "./burnlist-discovery.mjs";

function validPlan(title) {
  return `# ${title}\n\n## Active Checklist\n\n- [ ] ISO-01 | Keep discovery isolated\n\n## Completed\n`;
}

test("Burnlist discovery keeps later healthy plans when one summary throws", () => {
  const root = mkdtempSync(join(tmpdir(), "burnlist-discovery-"));
  try {
    const lifecycle = join(root, "notes", "burnlists", "inprogress");
    mkdirSync(join(lifecycle, "a-broken"), { recursive: true });
    mkdirSync(join(lifecycle, "z-healthy"), { recursive: true });
    writeFileSync(join(lifecycle, "a-broken", "burnlist.md"), validPlan("Broken"));
    writeFileSync(join(lifecycle, "z-healthy", "burnlist.md"), validPlan("Healthy"));
    let forcedFailure = false;
    const summaries = discoverBurnlistSummaries({
      repoRoots: [root],
      maxPlanBytes: 1024,
      summaryForPlan: (planPath) => {
        if (planPath.includes("a-broken")) {
          forcedFailure = true;
          throw new Error("forced summary failure");
        }
        return { id: "z-healthy", planPath };
      },
    });
    assert.equal(forcedFailure, true);
    assert.deepEqual(summaries.map((entry) => entry.id), ["z-healthy"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
