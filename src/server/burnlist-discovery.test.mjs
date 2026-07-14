import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { discoverBurnlistSummaries } from "./burnlist-discovery.mjs";

function validPlan(title) {
  return `# ${title}\n\n## Active Checklist\n\n- [ ] ISO-01 | Keep discovery isolated\n\n## Completed\n`;
}

test("Burnlist discovery keeps healthy plans when another plan is malformed", () => {
  const root = mkdtempSync(join(tmpdir(), "burnlist-discovery-"));
  try {
    const lifecycle = join(root, "notes", "burnlists", "inprogress");
    mkdirSync(join(lifecycle, "healthy"), { recursive: true });
    mkdirSync(join(lifecycle, "broken"), { recursive: true });
    writeFileSync(join(lifecycle, "healthy", "burnlist.md"), validPlan("Healthy"));
    writeFileSync(join(lifecycle, "broken", "burnlist.md"), "\0");
    const summaries = discoverBurnlistSummaries({ repoRoots: [root], maxPlanBytes: 1024 });
    assert.equal(summaries.some((entry) => entry.id === "healthy"), true);
    assert.ok((summaries.find((entry) => entry.id === "broken")?.errors ?? 0) > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
