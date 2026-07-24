import { access, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { parse } from "@babel/parser";
import { hash } from "./terminal-oven-parity-source.mjs";

const stable = (value) => `${JSON.stringify(value, null, 2)}\n`;
const same = (left, right) => stable(left) === stable(right);
const fail = (message) => { throw new Error(`terminal inventory audit: ${message}`); };
const unwrap = (node) => ["TSAsExpression", "TSTypeAssertion", "TSSatisfiesExpression"].includes(node?.type) ? unwrap(node.expression) : node;
const name = (node) => node?.type === "Identifier" ? node.name : null;
function literal(node) {
  node = unwrap(node);
  if (!node) fail("registry contains a nonliteral value");
  if (node.type === "StringLiteral" || node.type === "BooleanLiteral" || node.type === "NumericLiteral") return node.value;
  if (node.type === "NullLiteral") return null;
  if (node.type === "ArrayExpression") return node.elements.map((item) => { if (!item || item.type === "SpreadElement") fail("registry array must not contain spread or holes"); return literal(item); });
  if (node.type === "ObjectExpression") {
    const out = {};
    for (const property of node.properties) {
      if (property.type !== "ObjectProperty" || property.computed || property.method || property.shorthand || !property.key || property.key.type !== "Identifier") fail("registry object must use direct literal properties");
      if (Object.hasOwn(out, property.key.name)) fail("registry object has duplicate field");
      out[property.key.name] = literal(property.value);
    }
    return out;
  }
  fail("registry contains identifier, computed field, or expression");
}
function frozenLiteral(ast, exportName) {
  for (const statement of ast.program.body) {
    if (statement.type !== "ExportNamedDeclaration") continue;
    for (const declaration of statement.declaration?.declarations || []) {
      const init = unwrap(declaration.init);
      const freeze = init?.type === "CallExpression" && init.callee.type === "MemberExpression" && name(init.callee.object) === "Object" && name(init.callee.property) === "freeze";
      if (name(declaration.id) === exportName) {
        if (!freeze || init.arguments.length !== 1 || unwrap(init.arguments[0])?.type !== "ArrayExpression") fail(`${exportName} must be Object.freeze(literal array)`);
        return literal(init.arguments[0]);
      }
    }
  }
  fail(`missing ${exportName}`);
}
const structuralKinds = ["box", "grid", "stack", "panel", "text", "icon"];
const atomsFor = (kind) => [`grammar:element:${kind}`, `compiled:element:${kind}`];
const expectedAtoms = structuralKinds.flatMap(atomsFor).sort();
const exportName = "tui/src/oven-runtime/layout/structural-viewport.tsx#StructuralOvenViewport";
const sourceFiles = ["tui/src/oven-runtime/layout/layout-runtime.ts", "tui/src/oven-runtime/layout/structural-viewport.tsx", "tui/src/catalog/structural-fixture.oven", "tui/src/catalog/frame-renderer.tsx", "tui/package.json", "tui/package-lock.json"];
const structuralHashFiles = ["tui/package-lock.json", "tui/package.json", "tui/src/catalog/frame-renderer.tsx", "tui/src/catalog/structural-fixture.oven", "tui/src/oven-runtime/layout/layout-runtime.ts", "tui/src/oven-runtime/layout/structural-viewport.tsx"];
const exact = (row, keys) => row && typeof row === "object" && !Array.isArray(row) && Object.keys(row).length === keys.length && keys.every((key) => Object.hasOwn(row, key));
const structuralFrames = [40, 60, 80, 100, 140].flatMap((width) => [[width, 10, "short"], [width, 20, "tall"], [width, 20, "final-focus"]].map(([w, h, checkpoint]) => `structural-layout:${w}x${h}:${checkpoint}`));
const run = promisify(execFile);
async function implementation(root) {
  const [path, exported] = exportName.split("#");
  if (!path || !exported || path.includes("..") || !path.startsWith("tui/")) fail("implementation export must be a contained path#NamedExport");
  try { await access(resolve(root, ".git")); try { await run("git", ["-C", root, "ls-files", "--error-unmatch", "--", path]); } catch { fail("implementation export source is not tracked"); } } catch (error) { if (String(error?.message).includes("not tracked")) throw error; }
  const ast = parse(await readFile(resolve(root, path), "utf8"), { sourceType: "module", plugins: ["typescript", "jsx"] });
  const found = ast.program.body.some((statement) => statement.type === "ExportNamedDeclaration" && ((statement.declaration?.type === "FunctionDeclaration" && statement.declaration.id?.name === exported) || (statement.declaration?.type === "VariableDeclaration" && statement.declaration.declarations.some((declaration) => name(declaration.id) === exported)) || statement.specifiers.some((specifier) => name(specifier.exported) === exported)));
  if (!found) fail("implementation export is not a named export");
}

export async function loadStructuralRegistry(root, atoms) {
  const path = "tui/src/oven-runtime/capability-registry.ts";
  const text = await readFile(resolve(root, path), "utf8");
  const ast = parse(text, { sourceType: "module", plugins: ["typescript"] });
  const actions = frozenLiteral(ast, "TERMINAL_OVEN_ACTIONS");
  const claims = frozenLiteral(ast, "TERMINAL_OVEN_CAPABILITIES");
  if (!Array.isArray(actions) || actions.length) fail("structural layout claims must not declare actions");
  if (!Array.isArray(claims) || claims.length !== expectedAtoms.length) fail("structural layout requires exactly twelve literal claims");
  const mappings = claims.flatMap((claim) => {
    if (!exact(claim, ["sourceFamilyId", "implementationExport", "fixtureIds", "atomMappings"]) || claim.implementationExport !== exportName || !same(claim.fixtureIds, ["structural-layout"]) || !Array.isArray(claim.atomMappings) || claim.atomMappings.length !== 1) fail("structural layout claim has an unknown family or shape");
    const mapping = claim.atomMappings[0];
    if (claim.sourceFamilyId !== mapping?.atomId) fail("structural claim family must equal its exact atom family");
    return [mapping];
  });
  const atomIds = mappings.map((mapping) => mapping?.atomId);
  if (!same([...atomIds].sort(), expectedAtoms) || new Set(atomIds).size !== atomIds.length) fail("structural layout claim has missing or duplicate atom mappings");
  const atomSet = new Set(atoms.map((atom) => atom.id));
  if (atomIds.some((id) => !atomSet.has(id))) fail("structural layout claim maps an unknown atom");
  if (claims.some((claim) => !atoms.some((atom) => atom.id === claim.sourceFamilyId && atom.familyId === claim.sourceFamilyId))) fail("structural claim family is not source-derived");
  await implementation(root);
  const evidence = JSON.parse(await readFile(resolve(root, "tui/src/oven-runtime/terminal-evidence-index.json"), "utf8"));
  const frameIndex = JSON.parse(await readFile(resolve(root, "dashboard/src/generated/terminal-frames/index.json"), "utf8"));
  if (evidence?.schema !== "burnlist-terminal-evidence-index@1" || evidence.generator !== "burnlist-b6-offscreen@1" || !Array.isArray(evidence.records) || frameIndex?.schema !== "burnlist-terminal-frame-index@1" || frameIndex.generator !== "burnlist-b6-offscreen@1" || !Array.isArray(frameIndex.entries)) fail("terminal evidence artifacts are invalid");
  const currentSources = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [file, hash(await readFile(resolve(root, file), "utf8"))])));
  const structuralSourceSha256 = hash((await Promise.all(structuralHashFiles.map(async (file) => `${file}\n${await readFile(resolve(root, file), "utf8")}`))).join("\n"));
  const records = new Map(evidence.records.map((record) => [record?.recordId, record]));
  if (records.size !== evidence.records.length) fail("terminal evidence has duplicate record ids");
  const entries = new Map(frameIndex.entries.map((entry) => [entry.id, entry]));
  if (entries.size !== frameIndex.entries.length) fail("terminal frame index has duplicate entries");
  for (const mapping of mappings) {
    if (!exact(mapping, ["atomId", "evidence"]) || !exact(mapping.evidence, ["recordId", "target"])) fail("structural atom mapping has extra or malformed fields");
    const record = records.get(mapping.evidence.recordId), target = `atom:${mapping.atomId}`;
    if (!record || mapping.evidence.target !== target || record.target !== target || record.fixture !== "structural-layout" || record.implementationExport !== exportName || !same(record.sourceFiles, currentSources)) fail("structural evidence target or source provenance drifted");
    const entry = entries.get(record.frameId);
    if (!entry || entry.fixture !== "structural-layout" || entry.sha256 !== record.artifactSha256 || entry.path !== record.artifactPath.replace("dashboard/src/generated/terminal-frames/", "")) fail("structural evidence does not join its frame index");
    const artifact = await readFile(resolve(root, record.artifactPath), "utf8"), frame = JSON.parse(artifact);
    if (hash(artifact) !== entry.sha256) fail("structural frame artifact hash drifted");
    if (entry.fixtureSha256 !== structuralSourceSha256 || frame.fixtureSha256 !== structuralSourceSha256 || frame.renderer?.sourceSha256 !== structuralSourceSha256) fail("structural source bytes do not cryptographically join the frame artifact");
  }
  const related = evidence.records.filter((record) => record?.fixture === "structural-layout");
  const support = new Set(structuralFrames.map((frameId) => `support:frame:${frameId}`));
  if (related.length !== structuralFrames.length || related.some((record) => !expectedAtoms.includes(String(record.target).replace(/^atom:/u, "")) && !support.has(record.target))) fail("structural evidence has an unrelated or missing record");
  const byFrame = new Map();
  for (const record of related) {
    if (!exact(record, ["recordId", "target", "fixture", "frameId", "artifactPath", "artifactSha256", "implementationExport", "sourceFiles"]) || !structuralFrames.includes(record.frameId) || byFrame.has(record.frameId)) fail("structural evidence frame matrix has an orphan or duplicate");
    byFrame.set(record.frameId, record);
  }
  if (byFrame.size !== structuralFrames.length || structuralFrames.some((frameId) => !byFrame.has(frameId))) fail("structural evidence frame matrix is incomplete");
  const evidenceByFrame = new Map(evidence.records.map((record) => [record?.frameId, record]));
  if (evidenceByFrame.size !== evidence.records.length || evidenceByFrame.size !== entries.size || [...entries.values()].some((entry) => {
    const record = evidenceByFrame.get(entry.id);
    return !record || record.fixture !== entry.fixture || record.artifactSha256 !== entry.sha256 || record.artifactPath !== `dashboard/src/generated/terminal-frames/${entry.path}`;
  })) fail("global frame evidence is incomplete or orphaned");
  return { path, fingerprint: hash(text), actions: [], annotations: [], claims, covered: atomIds.sort(), evidence: { sourceFiles: currentSources } };
}
