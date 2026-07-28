import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_MONITOR_PATCH_LIMITS,
  agentMonitorPatchFiles,
  extractAgentMonitorPatch,
} from "./agent-monitor-patch.mjs";

const PATCH = `*** Begin Patch
*** Update File: src/example.ts
@@
-const state = "old";
+const state = "new";
 const stable = true;
*** End Patch`;

test("extracts exact custom patch lines and file identity", () => {
  const patch = extractAgentMonitorPatch(PATCH);
  assert.deepEqual(patch, {
    lines: [
      "*** Update File: src/example.ts",
      "@@",
      "-const state = \"old\";",
      "+const state = \"new\";",
      " const stable = true;",
    ],
    truncated: false,
  });
  assert.deepEqual(agentMonitorPatchFiles(patch), ["src/example.ts"]);
});

test("extracts a patch from an encoded tool wrapper", () => {
  const wrapped = `const patch = ${JSON.stringify(PATCH)}; await tools.apply_patch(patch);`;
  assert.deepEqual(extractAgentMonitorPatch(wrapped)?.lines, [
    "*** Update File: src/example.ts",
    "@@",
    "-const state = \"old\";",
    "+const state = \"new\";",
    " const stable = true;",
  ]);
});

test("extracts unified git output and redacts secrets without flattening lines", () => {
  const patch = extractAgentMonitorPatch({
    output: `Process exited with code 0
Output:
diff --git a/src/auth.ts b/src/auth.ts
index 111..222 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1 +1 @@
-const token = "old";
+const token = "sk-secretvalue123";`,
  });
  assert.deepEqual(agentMonitorPatchFiles(patch), ["src/auth.ts"]);
  assert.equal(patch.lines[0], "diff --git a/src/auth.ts b/src/auth.ts");
  assert.equal(patch.lines.at(-1), "+const token = [REDACTED]");
});

test("withholds sensitive paths and private-key patches before persistence", () => {
  const secret = "not-for-storage";
  const keyKind = ["PRIVATE", "KEY"].join(" ");
  const begin = ["-----BEGIN", keyKind, "-----"].join(" ");
  const end = ["-----END", keyKind, "-----"].join(" ");
  const patch = `*** Begin Patch
*** Add File: .env.production
+password = ${secret}
+${begin}
+${secret}
+${end}
*** End Patch`;
  assert.equal(extractAgentMonitorPatch(patch), null);
  assert.equal(JSON.stringify(extractAgentMonitorPatch(patch)).includes(secret), false);
});

test("scans sensitive paths and move destinations beyond the display-file cap", () => {
  const safe = Array.from(
    { length: 8 },
    (_, index) => `*** Update File: src/safe-${index}.txt\n@@\n-old\n+new`,
  ).join("\n");
  const patch = `*** Begin Patch
${safe}
*** Update File: src/config.txt
*** Move to: .env
@@
-database = old
+database = protocol://user:password@host/db
*** End Patch`;
  assert.equal(extractAgentMonitorPatch(patch), null);
});

test("redacts lowercase secret assignments in otherwise safe patches", () => {
  const patch = extractAgentMonitorPatch(`*** Begin Patch
*** Update File: src/config.txt
@@
-password = old
+password = hunter2
*** End Patch`);
  assert.deepEqual(patch?.lines.slice(-2), [
    "-password = [REDACTED]",
    "+password = [REDACTED]",
  ]);
});

test("retains an explicit excerpt when a shell tail cuts off the diff header", () => {
  const patch = extractAgentMonitorPatch({
    output: `Script completed
Output:
-const before = true;
+const after = true;
@@ -8 +8 @@
-old();
+next();`,
  });
  assert.deepEqual(patch, {
    lines: [
      "-const before = true;",
      "+const after = true;",
      "@@ -8 +8 @@",
      "-old();",
      "+next();",
    ],
    truncated: true,
  });
});

test("marks oversized patches as explicit excerpts", () => {
  const lines = Array.from(
    { length: AGENT_MONITOR_PATCH_LIMITS.maxLines + 5 },
    (_, index) => `+line ${index}`,
  );
  const patch = extractAgentMonitorPatch(`*** Begin Patch\n*** Add File: many.txt\n${lines.join("\n")}\n*** End Patch`);
  assert.equal(patch.lines.length, AGENT_MONITOR_PATCH_LIMITS.maxLines);
  assert.equal(patch.truncated, true);
});
