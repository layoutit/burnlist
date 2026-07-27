import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { installMarker, ownedGlobalInstall, readJson, removeInstallMarker, servicePaths } from "./runtime.mjs";

test("global install markers are package and version specific", (t) => {
  const root = mkdtempSync(join(tmpdir(), "burnlist-service-runtime-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { BURNLIST_HOME: join(root, "home") };
  installMarker(root, "1.2.3", { env });
  assert.equal(ownedGlobalInstall(root, "1.2.3", { env }), true);
  assert.equal(ownedGlobalInstall(root, "2.0.0", { env }), false);
  assert.equal(readJson(servicePaths(env).marker).schema, "burnlist-service@1");
  assert.equal(removeInstallMarker(root, { env }), true);
  assert.equal(ownedGlobalInstall(root, "1.2.3", { env }), false);
});
