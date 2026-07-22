#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import "../src/ovens/built-in-handlers.mjs";
import { loadOfficialOvenCatalog, officialOvenEntry } from "../src/ovens/official-oven-catalog.mjs";
import { listOvenHandlers } from "../src/ovens/oven-registry.mjs";

export const OVEN_EVIDENCE_SCHEMA = "burnlist-oven-evidence@1";
export const OFFICIAL_OVEN_EVIDENCE_SCHEMA = "burnlist-official-oven-evidence@1";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const evidenceClasses = new Set(["unit-fixture", "transport-fixture", "catalog-route", "canonical-oven"]);
const evidenceKeys = [
  "schema", "evidenceClass", "capturedAt", "sourceKind", "fixture", "ovenId", "catalogRevision", "details", "artifacts",
];
const artifactKeys = ["kind", "path", "sha256", "bytes"];
const assetKeys = ["kind", "path", "sha256", "bytes"];
const hashPattern = /^[a-f0-9]{64}$/u;
const repoKeyPattern = /^[a-f0-9]{12}$/u;
const ovenRevisionPattern = /^o1-sha256:[a-f0-9]{64}$/u;
const fakePattern = /\b(?:fixture|placeholder|synthetic|mock)\b/iu;

function fail(message) {
  throw new Error(`Official Oven evidence ${message}`);
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
}

function assertExactKeys(value, expected, label) {
  assertObject(value, label);
  const actual = Object.keys(value);
  const missing = expected.filter((key) => !actual.includes(key));
  const unknown = actual.filter((key) => !expected.includes(key));
  if (missing.length || unknown.length) {
    fail(`${label} keys are invalid (missing: ${missing.join(", ") || "none"}; unknown: ${unknown.join(", ") || "none"}).`);
  }
}

function text(value, label, max = 4096) {
  if (typeof value !== "string" || !value || value.length > max) fail(`${label} must be bounded non-empty text.`);
  return value;
}

function timestamp(value, label) {
  text(value, label, 64);
  if (Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) fail(`${label} must be an ISO timestamp.`);
  return value;
}

function sha256(value, label) {
  if (typeof value !== "string" || !hashPattern.test(value)) fail(`${label} must be a lowercase SHA-256 digest.`);
  return value;
}

function positiveBytes(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${label} must be a positive safe integer.`);
  return value;
}

function validateArtifacts(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) fail(`${label} must contain 1 through 64 artifacts.`);
  return value.map((artifact, index) => {
    const itemLabel = `${label}[${index}]`;
    assertExactKeys(artifact, artifactKeys, itemLabel);
    if (!["screenshot", "network", "trace", "report"].includes(artifact.kind)) fail(`${itemLabel}.kind is invalid.`);
    const path = text(artifact.path, `${itemLabel}.path`);
    if (/^(?:data:|https?:)/u.test(path)) fail(`${itemLabel}.path must identify a retained local artifact.`);
    return { kind: artifact.kind, path, sha256: sha256(artifact.sha256, `${itemLabel}.sha256`), bytes: positiveBytes(artifact.bytes, `${itemLabel}.bytes`) };
  });
}

function validateProductionAssets(value, label) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 16) fail(`${label} must contain exact script and stylesheet assets.`);
  const assets = value.map((asset, index) => {
    const itemLabel = `${label}[${index}]`;
    assertExactKeys(asset, assetKeys, itemLabel);
    if (!["script", "stylesheet"].includes(asset.kind)) fail(`${itemLabel}.kind is invalid.`);
    const path = text(asset.path, `${itemLabel}.path`);
    if (!/^\/assets\/[A-Za-z0-9._-]+$/u.test(path)) fail(`${itemLabel}.path must be a production /assets/ path.`);
    return { kind: asset.kind, path, sha256: sha256(asset.sha256, `${itemLabel}.sha256`), bytes: positiveBytes(asset.bytes, `${itemLabel}.bytes`) };
  });
  for (const kind of ["script", "stylesheet"]) {
    if (assets.filter((asset) => asset.kind === kind).length !== 1) fail(`${label} must contain exactly one ${kind}.`);
  }
  return assets;
}

function assertArtifactKinds(artifacts, evidenceClass) {
  for (const kind of ["screenshot", "network"]) {
    if (!artifacts.some((artifact) => artifact.kind === kind)) fail(`${evidenceClass} requires a ${kind} artifact.`);
  }
}

function stringsIn(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) for (const child of value) stringsIn(child, output);
  else if (value && typeof value === "object") for (const child of Object.values(value)) stringsIn(child, output);
  return output;
}

function validateFixtureDetails(value, evidenceClass) {
  const expected = evidenceClass === "transport-fixture" ? ["mechanics", "fixtureIds"] : ["mechanics"];
  assertExactKeys(value, expected, "details");
  if (!Array.isArray(value.mechanics) || value.mechanics.length === 0 || value.mechanics.length > 32) {
    fail("details.mechanics must contain bounded mechanic names.");
  }
  const mechanics = value.mechanics.map((item, index) => text(item, `details.mechanics[${index}]`, 120));
  if (evidenceClass === "unit-fixture") return { mechanics };
  if (!Array.isArray(value.fixtureIds) || value.fixtureIds.length === 0 || value.fixtureIds.length > 64) {
    fail("details.fixtureIds must contain bounded fixture ids.");
  }
  return { mechanics, fixtureIds: value.fixtureIds.map((item, index) => text(item, `details.fixtureIds[${index}]`, 120)) };
}

function validateCatalogRouteDetails(value, catalog) {
  assertExactKeys(value, ["route", "officialIds", "productionAssets"], "details");
  if (value.route !== "/ovens") fail("catalog-route details.route must be /ovens.");
  const expectedIds = catalog.entries.map(({ id }) => id);
  if (!Array.isArray(value.officialIds) || value.officialIds.length !== expectedIds.length
    || value.officialIds.some((id, index) => id !== expectedIds[index])) {
    fail("catalog-route details.officialIds must equal the ordered official catalog.");
  }
  return { route: value.route, officialIds: [...value.officialIds], productionAssets: validateProductionAssets(value.productionAssets, "details.productionAssets") };
}

function validateCanonicalDetails(value, entry, artifacts) {
  assertExactKeys(value, [
    "version", "ovenRevision", "producer", "repoKey", "route", "dataSha256", "productionAssets",
  ], "details");
  if (value.version !== entry.version) fail(`canonical-oven version must match catalog entry ${entry.id}.`);
  if (typeof value.ovenRevision !== "string" || !ovenRevisionPattern.test(value.ovenRevision)) fail("details.ovenRevision is invalid.");
  if (value.producer !== entry.producer) fail(`canonical-oven producer must be ${entry.producer}.`);
  if (typeof value.repoKey !== "string" || !repoKeyPattern.test(value.repoKey)) fail("details.repoKey is invalid.");
  const route = text(value.route, "details.route");
  if (!route.startsWith(`/r/${value.repoKey}/`) || !route.includes(`/o/${entry.id}`)) {
    fail(`canonical-oven route must be repo-scoped and target ${entry.id}.`);
  }
  const normalized = {
    version: value.version,
    ovenRevision: value.ovenRevision,
    producer: value.producer,
    repoKey: value.repoKey,
    route,
    dataSha256: sha256(value.dataSha256, "details.dataSha256"),
    productionAssets: validateProductionAssets(value.productionAssets, "details.productionAssets"),
  };
  assertArtifactKinds(artifacts, "canonical-oven");
  if (stringsIn({ details: normalized, artifacts }).some((value) => fakePattern.test(value))) {
    fail("canonical-oven evidence contains fixture, placeholder, synthetic, or mock markers.");
  }
  return normalized;
}

export function validateOvenEvidence(value, { catalog }) {
  assertExactKeys(value, evidenceKeys, "root");
  if (value.schema !== OVEN_EVIDENCE_SCHEMA) fail(`schema must be ${OVEN_EVIDENCE_SCHEMA}.`);
  if (!evidenceClasses.has(value.evidenceClass)) fail("evidenceClass is invalid.");
  const capturedAt = timestamp(value.capturedAt, "capturedAt");
  const artifacts = validateArtifacts(value.artifacts, "artifacts");
  let details;
  if (value.evidenceClass.endsWith("fixture")) {
    if (value.sourceKind !== "fixture" || value.fixture !== true || value.ovenId !== null || value.catalogRevision !== null) {
      fail(`${value.evidenceClass} must be explicitly fixture-owned and catalog-independent.`);
    }
    details = validateFixtureDetails(value.details, value.evidenceClass);
  } else if (value.evidenceClass === "catalog-route") {
    if (value.sourceKind !== "burnlist-catalog" || value.fixture !== false || value.ovenId !== null
      || value.catalogRevision !== catalog.catalogRevision) {
      fail("catalog-route must bind the current catalog revision without claiming an Oven.");
    }
    details = validateCatalogRouteDetails(value.details, catalog);
    assertArtifactKinds(artifacts, "catalog-route");
  } else {
    const entry = typeof value.ovenId === "string" ? officialOvenEntry(catalog, value.ovenId) : null;
    if (!entry) fail("canonical-oven ovenId must name an official catalog entry.");
    if (value.sourceKind !== "canonical-producer" || value.fixture !== false
      || value.catalogRevision !== catalog.catalogRevision) {
      fail("canonical-oven must bind the current catalog and a non-fixture canonical producer.");
    }
    details = validateCanonicalDetails(value.details, entry, artifacts);
  }
  return Object.freeze({ ...value, capturedAt, details, artifacts });
}

export function validateOfficialOvenEvidenceBundle(value, { catalog }) {
  assertExactKeys(value, ["schema", "generatedAt", "catalogRevision", "entries"], "bundle");
  if (value.schema !== OFFICIAL_OVEN_EVIDENCE_SCHEMA) fail(`bundle schema must be ${OFFICIAL_OVEN_EVIDENCE_SCHEMA}.`);
  timestamp(value.generatedAt, "bundle.generatedAt");
  if (value.catalogRevision !== catalog.catalogRevision) fail("bundle catalogRevision does not match the current catalog.");
  if (!Array.isArray(value.entries)) fail("bundle.entries must be an array.");
  const expectedIds = catalog.entries.map(({ id }) => id);
  if (value.entries.length !== expectedIds.length || value.entries.some((entry, index) => entry?.ovenId !== expectedIds[index])) {
    fail("bundle.entries must cover the ordered official catalog exactly once.");
  }
  for (const [index, item] of value.entries.entries()) {
    assertExactKeys(item, ["ovenId", "status", "evidence", "blocker"], `bundle.entries[${index}]`);
    const catalogEntry = catalog.entries[index];
    if (item.status !== catalogEntry.acceptance.state) fail(`${item.ovenId} status does not match its catalog acceptance state.`);
    if (item.status === "accepted") {
      if (item.blocker !== null) fail(`${item.ovenId} accepted evidence cannot have a blocker.`);
      const evidence = validateOvenEvidence(item.evidence, { catalog });
      if (evidence.evidenceClass !== "canonical-oven" || evidence.ovenId !== item.ovenId) {
        fail(`${item.ovenId} accepted evidence must be its own canonical-oven artifact.`);
      }
    } else {
      if (item.evidence !== null) fail(`${item.ovenId} ${item.status} state cannot attach acceptance evidence.`);
      text(item.blocker, `${item.ovenId}.blocker`, 1000);
    }
  }
  return value;
}

export function loadCurrentOfficialOvenCatalog() {
  return loadOfficialOvenCatalog({ ovensDir: resolve(packageRoot, "ovens"), handlers: listOvenHandlers() });
}

export function verifyOfficialOvenEvidenceDocument(value, { catalog = loadCurrentOfficialOvenCatalog() } = {}) {
  if (value?.schema === OFFICIAL_OVEN_EVIDENCE_SCHEMA) return validateOfficialOvenEvidenceBundle(value, { catalog });
  return validateOvenEvidence(value, { catalog });
}

function readEvidenceFile(path) {
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > 16 * 1024 * 1024) fail("file must be a regular file no larger than 16 MiB.");
  return JSON.parse(readFileSync(path, "utf8"));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const [path, ...extra] = process.argv.slice(2);
    if (!path || extra.length) throw new Error("Usage: node scripts/verify-official-oven-evidence.mjs <evidence.json>");
    const value = readEvidenceFile(resolve(path));
    verifyOfficialOvenEvidenceDocument(value);
    process.stdout.write(`${JSON.stringify({ valid: true, schema: value.schema })}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
