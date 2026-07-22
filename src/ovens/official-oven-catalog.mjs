import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { compileOven } from "./dsl/oven-compile.mjs";
import { ovenId } from "./oven-contract.mjs";
import { OVEN_DATA_INPUT } from "./oven-registry.mjs";

export const OFFICIAL_OVEN_CATALOG_SCHEMA = "burnlist-official-oven-catalog@1";
export const OFFICIAL_OVEN_CATALOG_MAX_BYTES = 128 * 1024;

const OVEN_SOURCE_MAX_BYTES = 1024 * 1024;
const rootKeys = ["schema", "catalogVersion", "entries"];
const entryKeys = [
  "id", "version", "contract", "dataInput", "producer", "routeKind", "maturity", "acceptance",
];
const acceptanceKeys = ["state", "evidenceClass", "fixtureEvidence"];
const dataInputs = new Set(Object.values(OVEN_DATA_INPUT));
const routeKinds = new Set(["burnlist-lens", "repo-oven"]);
const maturities = new Set(["shipped", "experimental", "deprecated"]);
const acceptanceStates = new Set(["accepted", "unverified", "blocked"]);
const semverPattern = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const contractPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*@[1-9][0-9]*$/u;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function fail(message) {
  throw new Error(`Official Oven catalog ${message}`);
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

function assertString(value, label, pattern, maxLength = 120) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || !pattern.test(value)) {
    fail(`${label} is invalid.`);
  }
  return value;
}

function assertEnum(value, values, label) {
  if (!values.has(value)) fail(`${label} must be one of ${[...values].join(", ")}.`);
  return value;
}

function normalizeEntry(value, index) {
  const label = `entries[${index}]`;
  assertExactKeys(value, entryKeys, label);
  let id;
  try {
    id = ovenId(value.id);
  } catch {
    fail(`${label}.id is invalid.`);
  }
  assertExactKeys(value.acceptance, acceptanceKeys, `${label}.acceptance`);
  return {
    id,
    version: assertString(value.version, `${label}.version`, semverPattern),
    contract: assertString(value.contract, `${label}.contract`, contractPattern),
    dataInput: assertEnum(value.dataInput, dataInputs, `${label}.dataInput`),
    producer: assertString(value.producer, `${label}.producer`, slugPattern),
    routeKind: assertEnum(value.routeKind, routeKinds, `${label}.routeKind`),
    maturity: assertEnum(value.maturity, maturities, `${label}.maturity`),
    acceptance: {
      state: assertEnum(value.acceptance.state, acceptanceStates, `${label}.acceptance.state`),
      evidenceClass: value.acceptance.evidenceClass === "canonical-oven"
        ? value.acceptance.evidenceClass
        : fail(`${label}.acceptance.evidenceClass must be canonical-oven.`),
      fixtureEvidence: value.acceptance.fixtureEvidence === "forbidden"
        ? value.acceptance.fixtureEvidence
        : fail(`${label}.acceptance.fixtureEvidence must be forbidden.`),
    },
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function readBoundedUtf8(path, maxBytes, label) {
  let stat;
  try {
    stat = statSync(path);
  } catch (error) {
    fail(`${label} is unavailable: ${error.message}`);
  }
  if (!stat.isFile()) fail(`${label} must be a file.`);
  if (stat.size > maxBytes) fail(`${label} exceeds ${maxBytes} bytes.`);
  return readFileSync(path, "utf8");
}

function sortedIds(values) {
  return [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

function assertExactIds(actual, expected, label) {
  const actualIds = sortedIds(actual);
  const expectedIds = sortedIds(expected);
  if (actualIds.length !== expectedIds.length || actualIds.some((id, index) => id !== expectedIds[index])) {
    fail(`${label} ids must equal the catalog (expected: ${expectedIds.join(", ")}; actual: ${actualIds.join(", ")}).`);
  }
}

export function parseOfficialOvenCatalog(value) {
  assertExactKeys(value, rootKeys, "root");
  if (value.schema !== OFFICIAL_OVEN_CATALOG_SCHEMA) fail(`schema must be ${OFFICIAL_OVEN_CATALOG_SCHEMA}.`);
  const catalogVersion = assertString(value.catalogVersion, "catalogVersion", semverPattern);
  if (!Array.isArray(value.entries) || value.entries.length === 0 || value.entries.length > 64) {
    fail("entries must contain between 1 and 64 entries.");
  }
  const entries = value.entries.map(normalizeEntry);
  const ids = entries.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) fail("entry ids must be unique.");
  const orderedIds = sortedIds(ids);
  if (ids.some((id, index) => id !== orderedIds[index])) fail("entries must be ordered by id.");
  const normalized = { schema: value.schema, catalogVersion, entries };
  const catalogRevision = createHash("sha256").update(canonicalJson(normalized)).digest("hex");
  return deepFreeze({ ...normalized, catalogRevision });
}

export function auditOfficialOvenInstall({ catalog, ovensDir, handlers }) {
  const expectedIds = catalog.entries.map((entry) => entry.id);
  const packageIds = readdirSync(ovensDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name);
  assertExactIds(packageIds, expectedIds, "package directory");

  const handlerById = new Map();
  for (const handler of handlers ?? []) {
    if (!handler || typeof handler !== "object") fail("handlers must contain objects.");
    const id = ovenId(handler.id);
    if (handlerById.has(id)) fail(`handler ${id} is duplicated.`);
    handlerById.set(id, handler);
  }
  assertExactIds(handlerById.keys(), expectedIds, "registered handler");

  for (const entry of catalog.entries) {
    const packageDir = join(ovensDir, entry.id);
    readBoundedUtf8(join(packageDir, "instructions.md"), OVEN_SOURCE_MAX_BYTES, `${entry.id} instructions`);
    const source = readBoundedUtf8(
      join(packageDir, `${entry.id}.oven`), OVEN_SOURCE_MAX_BYTES, `${entry.id} source`,
    );
    let ir;
    try {
      ir = compileOven(source).ir;
    } catch (error) {
      fail(`${entry.id} source does not compile: ${error.message}`);
    }
    if (ir.id !== entry.id || ir.version !== entry.version || ir.contract !== entry.contract) {
      fail(`${entry.id} package identity does not match its catalog entry.`);
    }
    if (handlerById.get(entry.id).dataInput !== entry.dataInput) {
      fail(`${entry.id} handler dataInput does not match its catalog entry.`);
    }
  }
  return catalog;
}

export function loadOfficialOvenCatalog({ ovensDir, handlers, catalogPath = join(ovensDir, "catalog.json") }) {
  const source = readBoundedUtf8(catalogPath, OFFICIAL_OVEN_CATALOG_MAX_BYTES, "manifest");
  let value;
  try {
    value = JSON.parse(source);
  } catch (error) {
    fail(`manifest is not valid JSON: ${error.message}`);
  }
  return auditOfficialOvenInstall({ catalog: parseOfficialOvenCatalog(value), ovensDir, handlers });
}

export function officialOvenEntry(catalog, id) {
  const safeId = ovenId(id);
  return catalog.entries.find((entry) => entry.id === safeId) ?? null;
}
