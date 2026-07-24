import { access, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { parse } from "@babel/parser";
import { hash } from "./terminal-oven-parity-source.mjs";
import { compileOven } from "../src/ovens/dsl/oven-compile.mjs";

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
const progressKinds = ["kpi-strip", "kpi-item", "progress-donut", "burn-donut", "waffle-metric", "progress-value"];
const publicProgressAtoms = ["public:dashboard/src/oven/index.ts#BurnDonut", "public:dashboard/src/oven/index.ts#ProgressDonut", "public:dashboard/src/oven/index.ts#WaffleMetric", "public:dashboard/src/oven/index.ts#KpiItem", "public:dashboard/src/oven/index.ts#KpiStrip"];
const progressAtoms = [...progressKinds.flatMap(atomsFor), ...publicProgressAtoms].sort();
const publicProgressKinds = Object.freeze({ BurnDonut: "burn-donut", ProgressDonut: "progress-donut", WaffleMetric: "waffle-metric", KpiItem: "kpi-item", KpiStrip: "kpi-strip" });
const independentlyExpectedKind = (atom) => atom.startsWith("public:") ? publicProgressKinds[atom.split("#").at(-1)] : atom.split(":").at(-1);
const targetFixture = (kind) => `tui/src/catalog/progress-target-${kind}.oven`;
const targetFixtureFiles = progressKinds.map(targetFixture);
const progressFiles = ["tui/package-lock.json", "tui/package.json", "tui/src/catalog/progress-frame-renderer.tsx", "tui/src/catalog/frame-renderer.tsx", "src/ovens/oven-progress-metrics.mjs", "tui/src/catalog/progress-fixture.oven", ...targetFixtureFiles, "tui/src/glyph-surface.ts", "tui/src/oven-runtime/components/component-layout.ts", "tui/src/oven-runtime/components/progress-components.tsx", "tui/src/oven-runtime/components/progress-glyph.ts", "tui/src/oven-runtime/components/terminal-capabilities.ts", "tui/src/oven-runtime/components/terminal-oven-viewport.tsx", "tui/src/oven-runtime/layout/layout-runtime.ts", "tui/src/oven-runtime/terminal-contract.ts", "tui/src/oven-runtime/value-runtime.ts"];
const progressHashFiles = progressFiles;
const progressSupportFrames = [20, 36, 60, 120].flatMap((width) => ["empty", "partial", "complete", "overflow", "required-error"].map((checkpoint) => `progress-components:${width}x20:${checkpoint}`));
const progressTargetFrames = progressKinds.map((kind) => `progress-target-${kind}:120x20:ready`);
const progressFrames = [...progressSupportFrames, ...progressTargetFrames];
const run = promisify(execFile);
async function implementation(root, target, tracked = false) {
  const [path, exported] = target.split("#");
  if (!path || !exported || path.includes("..") || !path.startsWith("tui/")) fail("implementation export must be a contained path#NamedExport");
  if (/test|fixture/iu.test(path)) fail("implementation export must not be test-only");
  if (tracked) try { await access(resolve(root, ".git")); try { await run("git", ["-C", root, "ls-files", "--error-unmatch", "--", path]); } catch { fail("implementation export source is not tracked"); } } catch (error) { if (String(error?.message).includes("not tracked")) throw error; }
  const ast = parse(await readFile(resolve(root, path), "utf8"), { sourceType: "module", plugins: ["typescript", "jsx"] });
  const found = ast.program.body.some((statement) => statement.type === "ExportNamedDeclaration" && ((statement.declaration?.type === "FunctionDeclaration" && statement.declaration.id?.name === exported) || (statement.declaration?.type === "VariableDeclaration" && statement.declaration.declarations.some((declaration) => name(declaration.id) === exported)) || statement.specifiers.some((specifier) => name(specifier.exported) === exported)));
  if (!found) fail("implementation export is not a named export");
}

async function independentlyTraceProgressTarget(root, kind) {
  if (!progressKinds.includes(kind)) fail("progress atom has no independently reviewed target kind");
  const fixtureSource = targetFixture(kind), text = await readFile(resolve(root, fixtureSource), "utf8"), compiled = compileOven(text, { file: fixtureSource });
  if (!compiled.ok) fail("progress target fixture does not compile");
  const found = [];
  const visit = (node, path) => {
    if (node.kind === kind) found.push({ node, path });
    for (const [index, child] of (node.children || []).entries()) visit(child, `${path}.children.${index}`);
  };
  for (const [index, node] of compiled.ir.root.entries()) visit(node, `root.${index}`);
  if (found.length !== 1) fail("progress target fixture has wrong kind isolation");
  const target = found[0];
  return { fixtureSource, fixtureSourceSha256: hash(text), targetPath: target.path, targetSource: target.node.source, targetNodeSha256: hash(JSON.stringify(target.node)) };
}

function assertTargetSemantics(kind, frame) {
  const semantic = frame.semanticText?.join("\n") || "", chars = new Set((frame.cells || []).map((cell) => cell.char));
  const headings = {
    "kpi-strip": "Isolated KPI strip", "kpi-item": "Isolated KPI item", "progress-donut": "Progress donut only",
    "burn-donut": "Burn donut only", "waffle-metric": "Waffle metric only", "progress-value": "Progress value only",
  };
  if (!semantic.includes(headings[kind]) || semantic.includes("Missing required")) fail("progress target has wrong isolated semantic signature");
  if (kind === "kpi-strip" && (!semantic.includes("Strip Alpha") || !semantic.includes("Strip Beta"))) fail("KPI strip evidence lacks isolated cells");
  if (kind === "kpi-item" && (!semantic.includes("item-only-value") || !semantic.includes("◒"))) fail("KPI item evidence lacks isolated render");
  if (kind === "progress-donut" && (!chars.has("━") || !chars.has("·") || !semantic.includes("37%"))) fail("progress donut evidence lacks unique glyph pattern");
  if (kind === "burn-donut" && new Set(frame.cells.filter((cell) => cell.char === "━").map((cell) => cell.fg)).size < 4) fail("burn donut evidence lacks result classes");
  if (kind === "waffle-metric" && (!chars.has("■") || !chars.has("□") || !semantic.includes("5"))) fail("waffle evidence lacks failed and empty cells");
  if (kind === "progress-value" && !semantic.includes("13 · 29 (45%)")) fail("progress value evidence lacks its unique semantic value");
}

export async function loadStructuralRegistry(root, atoms) {
  const path = "tui/src/oven-runtime/capability-registry.ts";
  const text = await readFile(resolve(root, path), "utf8");
  const ast = parse(text, { sourceType: "module", plugins: ["typescript"] });
  const actions = frozenLiteral(ast, "TERMINAL_OVEN_ACTIONS");
  const claims = frozenLiteral(ast, "TERMINAL_OVEN_CAPABILITIES");
  if (!Array.isArray(actions) || actions.length) fail("structural layout claims must not declare actions");
  if (!Array.isArray(claims) || claims.length !== expectedAtoms.length + progressAtoms.length) fail("registry requires exact structural, B7 family, and mapped public claims");
  const structuralClaims = claims.filter((claim) => same(claim.fixtureIds, ["structural-layout"]));
  const progressClaims = claims.filter((claim) => same(claim.fixtureIds, ["progress-components"]));
  if (structuralClaims.length !== 12) fail("structural layout requires exactly twelve literal claims");
  if (progressClaims.length !== progressAtoms.length) fail("progress family requires exact family and mapped public literal claims");
  const structuralMappings = structuralClaims.flatMap((claim) => {
    if (!exact(claim, ["sourceFamilyId", "implementationExport", "fixtureIds", "atomMappings"]) || claim.implementationExport !== exportName || !same(claim.fixtureIds, ["structural-layout"]) || !Array.isArray(claim.atomMappings) || claim.atomMappings.length !== 1) fail("structural layout claim has an unknown family or shape");
    const mapping = claim.atomMappings[0];
    if (claim.sourceFamilyId !== mapping?.atomId) fail("structural claim family must equal its exact atom family");
    return [mapping];
  });
  const progressMappings = progressClaims.flatMap((claim) => {
    if (!exact(claim, ["sourceFamilyId", "implementationExport", "fixtureIds", "atomMappings"]) || !Array.isArray(claim.atomMappings) || claim.atomMappings.length !== 1) fail("progress claim has an unknown family or shape");
    const mapping = claim.atomMappings[0];
    if (claim.sourceFamilyId !== mapping?.atomId) fail("progress claim family must equal its exact atom family");
    return [mapping];
  });
  const structuralIds = structuralMappings.map((mapping) => mapping?.atomId), progressIds = progressMappings.map((mapping) => mapping?.atomId), atomIds = [...structuralIds, ...progressIds];
  if (!same([...structuralIds].sort(), expectedAtoms) || new Set(structuralIds).size !== structuralIds.length) fail("structural layout claim has missing or duplicate atom mappings");
  if (!same([...progressIds].sort(), progressAtoms) || new Set(progressIds).size !== progressIds.length) fail("progress family has missing, extra, or duplicate atom mappings");
  const atomSet = new Set(atoms.map((atom) => atom.id));
  if (atomIds.some((id) => !atomSet.has(id))) fail("structural layout claim maps an unknown atom");
  if (claims.some((claim) => !atoms.some((atom) => atom.id === claim.sourceFamilyId && atom.familyId === claim.sourceFamilyId))) fail("claim family is not source-derived");
  await implementation(root, exportName, true);
  for (const target of new Set(progressClaims.map((claim) => claim.implementationExport))) await implementation(root, target);
  const evidence = JSON.parse(await readFile(resolve(root, "tui/src/oven-runtime/terminal-evidence-index.json"), "utf8"));
  const frameIndex = JSON.parse(await readFile(resolve(root, "dashboard/src/generated/terminal-frames/index.json"), "utf8"));
  const progressEvidence = JSON.parse(await readFile(resolve(root, "tui/src/oven-runtime/terminal-progress-evidence-index.json"), "utf8"));
  const progressIndex = JSON.parse(await readFile(resolve(root, "dashboard/src/generated/terminal-progress-frames/index.json"), "utf8"));
  if (evidence?.schema !== "burnlist-terminal-evidence-index@1" || evidence.generator !== "burnlist-b6-offscreen@1" || !Array.isArray(evidence.records) || frameIndex?.schema !== "burnlist-terminal-frame-index@1" || frameIndex.generator !== "burnlist-b6-offscreen@1" || !Array.isArray(frameIndex.entries)) fail("terminal evidence artifacts are invalid");
  if (progressEvidence?.schema !== "burnlist-terminal-progress-evidence-index@1" || progressEvidence.generator !== "burnlist-b7-progress@1" || !Array.isArray(progressEvidence.records) || progressIndex?.schema !== "burnlist-terminal-progress-frame-index@1" || progressIndex.generator !== "burnlist-b7-progress@1" || !Array.isArray(progressIndex.entries)) fail("progress evidence artifacts are invalid");
  const currentSources = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [file, hash(await readFile(resolve(root, file), "utf8"))])));
  const currentProgressSources = Object.fromEntries(await Promise.all(progressFiles.map(async (file) => [file, hash(await readFile(resolve(root, file), "utf8"))])));
  const structuralSourceSha256 = hash((await Promise.all(structuralHashFiles.map(async (file) => `${file}\n${await readFile(resolve(root, file), "utf8")}`))).join("\n"));
  const progressSourceSha256 = hash((await Promise.all(progressHashFiles.map(async (file) => `${file}\n${await readFile(resolve(root, file), "utf8")}`))).join("\n"));
  const records = new Map(evidence.records.map((record) => [record?.recordId, record]));
  const progressRecords = new Map(progressEvidence.records.map((record) => [record?.recordId, record]));
  if (records.size !== evidence.records.length) fail("terminal evidence has duplicate record ids");
  const entries = new Map(frameIndex.entries.map((entry) => [entry.id, entry]));
  const progressEntries = new Map(progressIndex.entries.map((entry) => [entry.id, entry]));
  if (entries.size !== frameIndex.entries.length) fail("terminal frame index has duplicate entries");
  for (const mapping of structuralMappings) {
    if (!exact(mapping, ["atomId", "evidence"]) || !exact(mapping.evidence, ["recordId", "target"])) fail("structural atom mapping has extra or malformed fields");
    const record = records.get(mapping.evidence.recordId), target = `atom:${mapping.atomId}`;
    if (!record || mapping.evidence.target !== target || record.target !== target || record.fixture !== "structural-layout" || record.implementationExport !== exportName || !same(record.sourceFiles, currentSources)) fail("structural evidence target or source provenance drifted");
    const entry = entries.get(record.frameId);
    if (!entry || entry.fixture !== "structural-layout" || entry.sha256 !== record.artifactSha256 || entry.path !== record.artifactPath.replace("dashboard/src/generated/terminal-frames/", "")) fail("structural evidence does not join its frame index");
    const artifact = await readFile(resolve(root, record.artifactPath), "utf8"), frame = JSON.parse(artifact);
    if (hash(artifact) !== entry.sha256) fail("structural frame artifact hash drifted");
    if (entry.fixtureSha256 !== structuralSourceSha256 || frame.fixtureSha256 !== structuralSourceSha256 || frame.renderer?.sourceSha256 !== structuralSourceSha256) fail("structural source bytes do not cryptographically join the frame artifact");
  }
  for (const mapping of progressMappings) {
    if (!exact(mapping, ["atomId", "evidence"]) || !exact(mapping.evidence, ["recordId", "target"])) fail("progress atom mapping has extra or malformed fields");
    const claim = progressClaims.find((row) => row.sourceFamilyId === mapping.atomId), record = progressRecords.get(mapping.evidence.recordId), target = `atom:${mapping.atomId}`;
    const expectedKind = independentlyExpectedKind(mapping.atomId), expectedTrace = await independentlyTraceProgressTarget(root, expectedKind);
    if (!exact(record, ["recordId", "target", "fixture", "frameId", "artifactPath", "artifactSha256", "implementationExport", "targetKind", "semanticSignature", "trace", "sourceFiles"])) fail("progress mapped evidence has unknown or missing fields");
    if (!record || mapping.evidence.target !== target || record.target !== target || record.fixture !== `progress-target-${expectedKind}` || record.implementationExport !== claim?.implementationExport || record.targetKind !== expectedKind || !same(record.trace, expectedTrace) || !same(record.sourceFiles, currentProgressSources)) fail("progress evidence target, export, kind, trace, or source provenance drifted");
    const entry = progressEntries.get(record.frameId);
    if (!entry || entry.id !== `progress-target-${expectedKind}:120x20:ready` || entry.fixture !== `progress-target-${expectedKind}` || entry.targetKind !== expectedKind || !same(entry.trace, expectedTrace) || entry.sha256 !== record.artifactSha256 || entry.path !== record.artifactPath.replace("dashboard/src/generated/terminal-progress-frames/", "")) fail("progress evidence does not join its independently compiled target frame");
    const artifact = await readFile(resolve(root, record.artifactPath), "utf8"), frame = JSON.parse(artifact);
    if (hash(artifact) !== entry.sha256 || entry.fixtureSha256 !== progressSourceSha256 || frame.fixtureSha256 !== progressSourceSha256 || frame.renderer?.sourceSha256 !== progressSourceSha256) fail("progress source bytes or frame hash drifted");
    for (const packageName of ["@opentui/core", "@opentui/react", "glyphcss", "@glyphcss/core", "@glyphcss/effects"]) if (!frame.renderer?.packages?.[packageName]?.version || !frame.renderer?.packages?.[packageName]?.integrity) fail("progress frame is missing glyphcss/OpenTUI provenance");
    const semanticSignature = hash(JSON.stringify({ semanticText: frame.semanticText, cells: frame.cells }));
    if (frame.checkpoint !== "ready" || frame.targetKind !== expectedKind || !same(frame.trace, expectedTrace) || frame.semanticSignature !== semanticSignature || entry.semanticSignature !== semanticSignature || record.semanticSignature !== semanticSignature) fail("progress artifact kind, compiled trace, or semantic signature drifted");
    assertTargetSemantics(expectedKind, frame);
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
  const progressRelated = progressEvidence.records.filter((record) => record?.fixture === "progress-components"), progressByFrame = new Map();
  if (progressRelated.length !== progressSupportFrames.length) fail("progress support evidence matrix is incomplete");
  for (const record of progressRelated) {
    if (!exact(record, ["recordId", "target", "fixture", "frameId", "artifactPath", "artifactSha256", "implementationExport", "sourceFiles"]) || !progressSupportFrames.includes(record.frameId) || progressByFrame.has(record.frameId)) fail("progress evidence frame matrix has an orphan or duplicate");
    const entry = progressEntries.get(record.frameId);
    if (!entry || entry.sha256 !== record.artifactSha256 || entry.path !== record.artifactPath.replace("dashboard/src/generated/terminal-progress-frames/", "") || !same(record.sourceFiles, currentProgressSources)) fail("progress support evidence does not join its frame index or sources");
    const artifact = await readFile(resolve(root, record.artifactPath), "utf8"), frame = JSON.parse(artifact);
    if (hash(artifact) !== record.artifactSha256) fail("progress support frame hash drifted");
    if (frame.fixtureSha256 !== progressSourceSha256 || frame.renderer?.sourceSha256 !== progressSourceSha256) fail("progress support source hash drifted");
    for (const packageName of ["@opentui/core", "@opentui/react", "glyphcss", "@glyphcss/core", "@glyphcss/effects"]) if (!frame.renderer?.packages?.[packageName]?.version || !frame.renderer?.packages?.[packageName]?.integrity) fail("progress support frame is missing glyphcss/OpenTUI provenance");
    progressByFrame.set(record.frameId, record);
  }
  if (progressSupportFrames.some((frameId) => !progressByFrame.has(frameId))) fail("progress support evidence matrix is incomplete");
  const referencedProgressFrames = new Set(progressEvidence.records.map((record) => record.frameId));
  if (progressFrames.some((frameId) => !referencedProgressFrames.has(frameId)) || progressEntries.size !== progressFrames.length || [...progressEntries.keys()].some((frameId) => !referencedProgressFrames.has(frameId))) fail("progress frame index has an orphan or unreferenced frame");
  const evidenceByFrame = new Map(evidence.records.map((record) => [record?.frameId, record]));
  if (evidenceByFrame.size !== evidence.records.length || evidenceByFrame.size !== entries.size || [...entries.values()].some((entry) => {
    const record = evidenceByFrame.get(entry.id);
    return !record || record.fixture !== entry.fixture || record.artifactSha256 !== entry.sha256 || record.artifactPath !== `dashboard/src/generated/terminal-frames/${entry.path}`;
  })) fail("global frame evidence is incomplete or orphaned");
  return { path, fingerprint: hash(text), actions: [], annotations: [], claims, covered: atomIds.sort(), evidence: { sourceFiles: { ...currentSources, ...currentProgressSources } } };
}
