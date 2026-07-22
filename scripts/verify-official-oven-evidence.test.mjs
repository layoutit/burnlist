import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  loadCurrentOfficialOvenCatalog,
  OVEN_EVIDENCE_SCHEMA,
  OFFICIAL_OVEN_EVIDENCE_SCHEMA,
  validateOfficialOvenEvidenceBundle,
  validateOvenEvidence,
} from "./verify-official-oven-evidence.mjs";

const catalog = loadCurrentOfficialOvenCatalog();
const script = resolve("scripts/verify-official-oven-evidence.mjs");
const digest = "a".repeat(64);

function artifact(kind, path) {
  return { kind, path, sha256: digest, bytes: 123 };
}

function productionAssets() {
  return [
    { kind: "script", path: "/assets/index-real.js", sha256: digest, bytes: 1000 },
    { kind: "stylesheet", path: "/assets/index-real.css", sha256: digest, bytes: 500 },
  ];
}

function canonicalEvidence(id = "checklist") {
  const entry = catalog.entries.find((candidate) => candidate.id === id);
  return {
    schema: OVEN_EVIDENCE_SCHEMA,
    evidenceClass: "canonical-oven",
    capturedAt: "2026-07-22T18:00:00.000Z",
    sourceKind: "canonical-producer",
    fixture: false,
    ovenId: id,
    catalogRevision: catalog.catalogRevision,
    details: {
      version: entry.version,
      ovenRevision: `o1-sha256:${digest}`,
      producer: entry.producer,
      repoKey: "aaaaaaaaaaaa",
      route: `/r/aaaaaaaaaaaa/260722-002/o/${id}`,
      dataSha256: digest,
      productionAssets: productionAssets(),
    },
    artifacts: [artifact("screenshot", "evidence/checklist.png"), artifact("network", "evidence/checklist.network.json")],
  };
}

function catalogRouteEvidence() {
  return {
    schema: OVEN_EVIDENCE_SCHEMA,
    evidenceClass: "catalog-route",
    capturedAt: "2026-07-22T18:00:00.000Z",
    sourceKind: "burnlist-catalog",
    fixture: false,
    ovenId: null,
    catalogRevision: catalog.catalogRevision,
    details: {
      route: "/ovens",
      officialIds: catalog.entries.map(({ id }) => id),
      productionAssets: productionAssets(),
    },
    artifacts: [artifact("screenshot", "evidence/catalog.png"), artifact("network", "evidence/catalog.network.json")],
  };
}

function fixtureEvidence(evidenceClass = "transport-fixture") {
  return {
    schema: OVEN_EVIDENCE_SCHEMA,
    evidenceClass,
    capturedAt: "2026-07-22T18:00:00.000Z",
    sourceKind: "fixture",
    fixture: true,
    ovenId: null,
    catalogRevision: null,
    details: evidenceClass === "transport-fixture"
      ? { mechanics: ["conditional snapshot"], fixtureIds: ["model-fixture"] }
      : { mechanics: ["parser rejection"] },
    artifacts: [artifact("report", "evidence/fixture.json")],
  };
}

test("accepts producer-bound canonical Oven evidence", () => {
  const result = validateOvenEvidence(canonicalEvidence(), { catalog });
  assert.equal(result.ovenId, "checklist");
  assert.equal(result.details.producer, "burnlist-checklist-progress");
});

test("rejects fixture, placeholder, catalog, route, asset, and artifact substitutions", () => {
  const cases = [
    ["fixture source", (value) => { value.sourceKind = "fixture"; }, /non-fixture canonical producer/u],
    ["fixture flag", (value) => { value.fixture = true; }, /non-fixture canonical producer/u],
    ["fixture producer", (value) => { value.details.producer = "fixture-producer"; }, /producer must be/u],
    ["wrong revision", (value) => { value.catalogRevision = digest; }, /current catalog/u],
    ["generic route", (value) => { value.details.route = "/ovens/checklist"; }, /repo-scoped/u],
    ["placeholder artifact", (value) => { value.artifacts[0].path = "evidence/placeholder.png"; }, /placeholder/u],
    ["data URL", (value) => { value.artifacts[0].path = "data:image/png;base64,AA=="; }, /retained local artifact/u],
    ["missing network", (value) => { value.artifacts = value.artifacts.filter(({ kind }) => kind !== "network"); }, /network artifact/u],
    ["missing stylesheet", (value) => { value.details.productionAssets = value.details.productionAssets.filter(({ kind }) => kind !== "stylesheet"); }, /script and stylesheet/u],
  ];
  for (const [label, mutate, pattern] of cases) {
    const value = canonicalEvidence();
    mutate(value);
    assert.throws(() => validateOvenEvidence(value, { catalog }), pattern, label);
  }
});

test("accepts catalog-route and fixture classes without promoting them", () => {
  assert.equal(validateOvenEvidence(catalogRouteEvidence(), { catalog }).evidenceClass, "catalog-route");
  assert.equal(validateOvenEvidence(fixtureEvidence(), { catalog }).fixture, true);
  assert.equal(validateOvenEvidence(fixtureEvidence("unit-fixture"), { catalog }).fixture, true);

  const disguised = fixtureEvidence();
  disguised.evidenceClass = "canonical-oven";
  assert.throws(() => validateOvenEvidence(disguised, { catalog }), /canonical-oven/u);
});

test("transport fixture evidence cannot be relabeled as canonical acceptance", () => {
  const fixtureSource = canonicalEvidence("model-lab");
  fixtureSource.sourceKind = "fixture";
  assert.throws(() => validateOvenEvidence(fixtureSource, { catalog }), /non-fixture canonical producer/u);

  const fixtureId = canonicalEvidence("model-lab");
  fixtureId.artifacts[0].path = "evidence/fixture-model.png";
  assert.throws(() => validateOvenEvidence(fixtureId, { catalog }), /fixture/u);

  const placeholderImage = canonicalEvidence("visual-parity");
  placeholderImage.artifacts[0].path = "data:image/png;base64,AA==";
  assert.throws(() => validateOvenEvidence(placeholderImage, { catalog }), /retained local artifact/u);
});

function evidenceBundle() {
  return {
    schema: OFFICIAL_OVEN_EVIDENCE_SCHEMA,
    generatedAt: "2026-07-22T18:00:00.000Z",
    catalogRevision: catalog.catalogRevision,
    entries: catalog.entries.map((entry) => ({
      ovenId: entry.id,
      status: entry.acceptance.state,
      evidence: null,
      blocker: `No fresh canonical producer capture is retained for ${entry.id}.`,
    })),
  };
}

test("requires an exact honest status bundle for every official entry", () => {
  const bundle = evidenceBundle();
  assert.equal(validateOfficialOvenEvidenceBundle(bundle, { catalog }), bundle);

  const promoted = evidenceBundle();
  promoted.entries[0] = { ovenId: "checklist", status: "accepted", evidence: canonicalEvidence(), blocker: null };
  assert.throws(() => validateOfficialOvenEvidenceBundle(promoted, { catalog }), /status does not match/u);

  const partial = evidenceBundle();
  partial.entries.pop();
  assert.throws(() => validateOfficialOvenEvidenceBundle(partial, { catalog }), /ordered official catalog/u);
});

test("the CLI verifies an evidence bundle against the installed catalog", () => {
  const root = mkdtempSync(join(tmpdir(), "burnlist-oven-evidence-"));
  try {
    const path = join(root, "evidence.json");
    writeFileSync(path, `${JSON.stringify(evidenceBundle(), null, 2)}\n`);
    const output = execFileSync(process.execPath, [script, path], { encoding: "utf8" });
    assert.deepEqual(JSON.parse(output), { valid: true, schema: OFFICIAL_OVEN_EVIDENCE_SCHEMA });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
