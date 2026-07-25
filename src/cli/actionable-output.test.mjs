import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { dashboardCatalogUrl, dashboardHandoff, dashboardRuntime, dashboardUrl } from "./actionable-output.mjs";
import { repoKey } from "../server/registry.mjs";

test("dashboard links use the live loopback runtime and canonical repo key", (t) => {
  const root = mkdtempSync(join(tmpdir(), "burnlist-actionable-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo"), runtimePath = join(root, "server.json");
  mkdirSync(repo);
  writeFileSync(runtimePath, '{"pid":42,"url":"http://127.0.0.1:4599/"}\n');
  const runtime = dashboardRuntime({ runtimePath, pidAlive: (pid) => pid === 42 });
  assert.deepEqual(runtime, { baseUrl: "http://127.0.0.1:4599/", live: true });
  assert.equal(
    dashboardUrl(repo, { burnlistId: "260725-001", runtime }),
    `http://127.0.0.1:4599/r/${repoKey(realpathSync(repo))}/260725-001`,
  );
  assert.equal(dashboardUrl(repo, { ovenId: "loop-progress", runtime }),
    `http://127.0.0.1:4599/r/${repoKey(realpathSync(repo))}/o/loop-progress`);
  assert.equal(dashboardCatalogUrl("checklist", { runtime }), "http://127.0.0.1:4599/ovens/checklist");
});

test("missing or unsafe runtime falls back to the canonical default and a start action", (t) => {
  const root = mkdtempSync(join(tmpdir(), "burnlist-actionable-fallback-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  mkdirSync(repo);
  const runtime = dashboardRuntime({ runtimePath: join(root, "missing.json") });
  assert.deepEqual(runtime, { baseUrl: "http://127.0.0.1:4510/", live: false });
  const url = dashboardUrl(repo, { burnlistId: "260725-001", runtime });
  const output = dashboardHandoff(repo, url, "burnlist show 260725-001", { runtime });
  assert.match(output, /^Dashboard: http:\/\/127\.0\.0\.1:4510\/r\//u);
  assert.match(output, new RegExp(`Dashboard start: burnlist --scan-root ${JSON.stringify(realpathSync(repo))}`, "u"));
  assert.match(output, /Next: burnlist show 260725-001/u);
});
