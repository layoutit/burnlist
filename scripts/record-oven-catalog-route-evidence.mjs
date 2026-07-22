#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import { loadCurrentOfficialOvenCatalog, validateOvenEvidence } from "./verify-official-oven-evidence.mjs";

function argumentsMap(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error("Arguments must be --name value pairs.");
    values.set(key.slice(2), value);
  }
  return values;
}

function required(values, key) {
  const value = values.get(key);
  if (!value) throw new Error(`Missing --${key}.`);
  return value;
}

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function retainedArtifact(kind, path) {
  const localPath = resolve(path);
  const stat = statSync(localPath);
  assert.ok(stat.isFile() && stat.size > 0, `${kind} artifact must be a non-empty file`);
  return {
    kind,
    path: relative(process.cwd(), localPath),
    sha256: digest(localPath),
    bytes: stat.size,
  };
}

function productionAssets() {
  const indexPath = resolve("dashboard/dist/index.html");
  const index = readFileSync(indexPath, "utf8");
  const paths = [
    ["script", index.match(/src="(\/assets\/[^"]+\.js)"/u)?.[1]],
    ["stylesheet", index.match(/href="(\/assets\/[^"]+\.css)"/u)?.[1]],
  ];
  return paths.map(([kind, path]) => {
    assert.ok(path, `production index must identify its ${kind} asset`);
    const localPath = resolve("dashboard/dist", path.slice(1));
    const stat = statSync(localPath);
    assert.ok(stat.isFile() && stat.size > 0, `${kind} asset must be a non-empty file`);
    return { kind, path, sha256: digest(localPath), bytes: stat.size };
  });
}

function atomicJson(path, value) {
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, target);
}

const args = argumentsMap(process.argv.slice(2));
const baseUrl = new URL(required(args, "base-url"));
if (baseUrl.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(baseUrl.hostname)) {
  throw new Error("--base-url must be a loopback HTTP origin.");
}
const screenshot = required(args, "screenshot");
const network = required(args, "network");
const output = required(args, "output");
const catalog = loadCurrentOfficialOvenCatalog();

const routeResponse = await fetch(new URL("/ovens", baseUrl));
assert.equal(routeResponse.status, 200, "production /ovens route must return 200");
assert.match(routeResponse.headers.get("content-type") ?? "", /^text\/html/iu);

const apiResponse = await fetch(new URL("/api/oven-catalog", baseUrl));
assert.equal(apiResponse.status, 200, "official catalog API must return 200");
const apiCatalog = await apiResponse.json();
assert.equal(apiCatalog.catalogRevision, catalog.catalogRevision, "API and installed catalog revisions must match");
assert.deepEqual(
  apiCatalog.entries.map(({ id }) => id),
  catalog.entries.map(({ id }) => id),
  "API and installed official ids must match in order",
);

const evidence = {
  schema: "burnlist-oven-evidence@1",
  evidenceClass: "catalog-route",
  capturedAt: new Date().toISOString(),
  sourceKind: "burnlist-catalog",
  fixture: false,
  ovenId: null,
  catalogRevision: catalog.catalogRevision,
  details: {
    route: "/ovens",
    officialIds: catalog.entries.map(({ id }) => id),
    productionAssets: productionAssets(),
  },
  artifacts: [
    retainedArtifact("screenshot", screenshot),
    retainedArtifact("network", network),
  ],
};
validateOvenEvidence(evidence, { catalog });
atomicJson(output, evidence);
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
