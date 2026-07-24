import { lstatSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findBurnlistDir } from "../../cli/lifecycle-moves.mjs";
import { locateItemSpan, validateAssignedItem } from "../assignment/item-metadata.mjs";
import { parseItemRef } from "../assignment/selectors.mjs";
import { assignmentStore } from "../assignment/store.mjs";
import { readCapabilityCatalog, resolveCapability, canonicalCapabilityBytes, canonicalGrantBytes, GUARANTEE_LABELS } from "../capabilities/contract.mjs";
import { assertTrustedCapability } from "../capabilities/trust.mjs";
import { checkSnapshot, holdSnapshot, readSnapshotBytes, releaseSnapshot, snapshotTarget } from "../capabilities/snapshot.mjs";
import { compileLoopFiles } from "../dsl/compile.mjs";
import { loadFrozenRecipe } from "../dsl/frozen.mjs";
import { prefixed, rawSha256 } from "../dsl/hash.mjs";
import { createNormalizedInvocation } from "../adapters/normalized-invocation.mjs";
import { agentProfileRevision } from "../agents/profile.mjs";
import { readProfile, readRoute, requiredRoutes } from "../config/profiles.mjs";
import { localRecordPath } from "../config/store.mjs";
import { boundPolicyRevision, canonicalBoundPolicyBytes, loadBoundPolicy } from "./run-artifacts.mjs";
import { createRunRunner } from "./runner.mjs";
import { deriveCandidate } from "./candidate.mjs";
import { ownerClaimId } from "./run-claim.mjs";
import { newRunId } from "./run-codec.mjs";

const INPUT_KEYS = new Set(["runId", "itemRef"]);
const builtinsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../loops");

function fail(message, code = "ELOOP_RUN_BINDING") {
  throw Object.assign(new Error(`Loop Run binder: ${message}`), { code });
}
function closed(value, keys) { return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function exactInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !INPUT_KEYS.has(key))
    || typeof value.itemRef !== "string") fail("creation accepts only runId and itemRef");
  return value;
}
function identity(path, kind = "file") {
  const value = lstatSync(path);
  const directory = kind.startsWith("directory");
  if (value.isSymbolicLink() || kind === "file" && !value.isFile() || directory && !value.isDirectory())
    fail(`authority input has invalid type: ${path}`);
  return Object.freeze(directory
    ? { kind, path, dev: String(value.dev), ino: String(value.ino), size: String(value.size),
      mode: String(value.mode), mtimeMs: String(value.mtimeMs), ctimeMs: String(value.ctimeMs) }
    : { kind, path, dev: String(value.dev), ino: String(value.ino), size: String(value.size),
      mode: String(value.mode), mtimeMs: String(value.mtimeMs), ctimeMs: String(value.ctimeMs) });
}
function boundaryEvidence(paths) {
  return Object.freeze([...new Set(paths)].sort().map((path) => identity(path)));
}
function assignmentAncestorEvidence(repoRoot, artifactPath) {
  const root = resolve(repoRoot), output = [];
  for (let current = dirname(artifactPath); current.startsWith(`${root}/`) || current === root; current = dirname(current)) {
    output.push(identity(current, "directory-identity"));
    if (current === root) break;
  }
  return output;
}
function assertBoundaryEvidence(evidence) {
  if (!Array.isArray(evidence) || !evidence.length) fail("authority boundary evidence is missing");
  for (const expected of evidence) {
    const observed = identity(expected.path, expected.kind);
    const keys = expected.kind === "directory-identity" ? ["dev", "ino", "mode"] : ["dev", "ino", "size", "mode", "mtimeMs", "ctimeMs"];
    for (const key of keys)
      if (observed[key] !== expected[key]) fail(`authority input changed before Run publication: ${expected.path}`, "ELOOP_RUN_BINDING_STALE");
  }
}
function executableSnapshot(loopRef) {
  if (loopRef !== "loop:builtin:review") fail(`executable source identity is unavailable for ${loopRef}`);
  const directory = join(builtinsRoot, "review"), files = {}, evidence = [];
  for (const [name, maximum] of [["review.loop", 65536], ["instructions.md", 262144]]) {
    const path = join(directory, name), captured = readSnapshotBytes({ root: builtinsRoot, path, maximum });
    files[name] = captured.bytes;
    evidence.push(Object.freeze({ kind: "file", path, dev: String(captured.identity.dev), ino: String(captured.identity.ino),
      size: String(captured.identity.size), mode: String(captured.identity.mode),
      mtimeMs: String(captured.identity.mtimeMs), ctimeMs: String(captured.identity.ctimeMs) }));
    for (const ancestor of captured.ancestors) evidence.push(Object.freeze({ kind: "directory", path: ancestor.path,
      dev: String(ancestor.identity.dev), ino: String(ancestor.identity.ino), size: String(ancestor.identity.size),
      mode: String(ancestor.identity.mode), mtimeMs: String(ancestor.identity.mtimeMs), ctimeMs: String(ancestor.identity.ctimeMs) }));
  }
  const compiled = compileLoopFiles(files);
  if (!compiled.ok) fail("captured executable source does not compile");
  assertBoundaryEvidence(evidence);
  return { compiled, evidence };
}
function currentPolicy(repoRoot, recipeRevision) {
  const authorityInputs = [];
  const add = (role, path, executable = false) => authorityInputs.push(Object.freeze({ role, path, executable }));
  const routes = requiredRoutes.map(({ route }) => {
    const routeRecord = readRoute({ repoRoot, route });
    const profile = readProfile({ repoRoot, slug: routeRecord.profile });
    add(`route:${route}`, localRecordPath(repoRoot, "routes", route.replace(".", "-")));
    add(`profile:${route}`, localRecordPath(repoRoot, "profiles", profile.id));
    add(`adapter:${route}`, profile.binary, true);
    const executableDigest = snapshotTarget({ root: dirname(profile.binary), path: profile.binary }).digest;
    return { route, profile, profileRevision: agentProfileRevision(profile), executableDigest,
      guarantees: route === "review.strong"
        ? { freshSession: "enforced", filesystemWriteDeny: "supervised" }
        : { freshSession: "enforced" } };
  }).sort((left, right) => Buffer.compare(Buffer.from(left.route), Buffer.from(right.route)));
  const resolved = resolveCapability(readCapabilityCatalog(repoRoot), "repo-verify");
  const trust = assertTrustedCapability({ repoRoot, resolved });
  add("capability-catalog", join(repoRoot, ".burnlist", "loop-capabilities.json"));
  add("capability-trust", localRecordPath(repoRoot, "capabilities", resolved.policy.id));
  add("capability-bin", resolved.policy.argv[0], true);
  const grants = trust.grants;
  const policy = { schema: "burnlist-loop-bound-policy@1", recipeRevision, routes,
    capabilities: [{ id: resolved.policy.id, policy: resolved.policy, revision: resolved.revision,
      policyDigest: rawSha256(canonicalCapabilityBytes(resolved.policy)), grants,
      grantsDigest: rawSha256(canonicalGrantBytes(grants, resolved.policy)), trust,
      guarantees: GUARANTEE_LABELS }] };
  const bytes = canonicalBoundPolicyBytes(policy);
  return { policy: loadBoundPolicy(bytes).policy, bytes, authorityInputs: Object.freeze(authorityInputs.sort((left, right) => Buffer.compare(Buffer.from(left.role), Buffer.from(right.role)))) };
}
function liveAuthorityEvidence(inputs) {
  return Object.freeze(inputs.map(({ role, path, executable }) => {
    const snapshot = snapshotTarget({ root: dirname(path), path });
    if (executable && (snapshot.identity.mode & 0o111) === 0)
      fail(`launch executable is not executable: ${path}`, "ELOOP_RUN_BINDING_STALE");
    return Object.freeze({ role, executable, snapshot });
  }));
}
function assertLiveAuthorityEvidence(evidence) {
  if (!Array.isArray(evidence) || !evidence.length) fail("live launch authority evidence is missing");
  for (const item of evidence) {
    if (!closed(item, ["role", "executable", "snapshot"]) || typeof item.role !== "string" || !item.role || typeof item.executable !== "boolean") fail("invalid live launch authority evidence");
    const snapshot = item.snapshot, file = snapshot?.kind === "file";
    if (!closed(snapshot, file ? ["root", "path", "kind", "ancestors", "identity", "digest", "maximum"] : ["root", "path", "kind", "ancestors", "identity"])
      || !Array.isArray(snapshot.ancestors) || !closed(snapshot.identity, ["dev", "ino", "size", "mode", "mtimeMs", "ctimeMs"])
      || snapshot.ancestors.some((ancestor) => !closed(ancestor, ["path", "identity"]) || !closed(ancestor.identity, ["dev", "ino", "size", "mode", "mtimeMs", "ctimeMs"]))) fail("invalid live launch authority evidence");
    checkSnapshot(item.snapshot);
    if (item.executable && (item.snapshot.identity.mode & 0o111) === 0) fail(`launch executable is not executable: ${item.snapshot.path}`, "ELOOP_RUN_BINDING_STALE");
  }
}
export function launchAuthorityDigest(evidence) {
  const inputs = evidence.map(({ role, executable, snapshot }) => ({ role, executable, root: snapshot.root, path: snapshot.path,
    kind: snapshot.kind, ancestors: snapshot.ancestors.map((ancestor) => ({ path: ancestor.path, identity: ancestor.identity })),
    identity: snapshot.identity, digest: snapshot.digest ?? null, maximum: snapshot.maximum ?? null }));
  return rawSha256(Buffer.from(`${JSON.stringify({ schema: "burnlist-loop-launch-authority@1", inputs })}\n`));
}
export function assertExecutableBinding(authority) {
  if (!authority?.artifact?.executionRevision || !authority.currentCompiled?.revisions?.executable)
    fail("installed executable recipe is unavailable");
  if (authority.currentCompiled.revisions.executable !== authority.artifact.executionRevision)
    fail(`installed executable ${authority.currentCompiled.revisions.executable} does not match assignment pin ${authority.artifact.executionRevision}`, "ELOOP_RUN_EXECUTABLE_DRIFT");
  return authority.artifact.executionRevision;
}

/** Read-only production authority. It never writes assignment, setup, trust, or source files. */
export async function bindRunCreation({ repoRoot, input }) {
  const request = exactInput(input);
  const item = parseItemRef(request.itemRef), located = findBurnlistDir(repoRoot, item.burnlistId);
  const span = locateItemSpan(readFileSync(join(located.dir, "burnlist.md")), item.itemId);
  const metadata = validateAssignedItem(item.selector, span), artifact = assignmentStore(repoRoot).load(metadata["Assignment-Id"]);
  if (artifact.assignmentId !== metadata["Assignment-Id"] || artifact.itemRef !== item.selector
    || artifact.selector !== metadata.Selector || artifact.assignedItemDigest !== metadata.assignedDigest
    || artifact.unassignedItemDigest !== metadata.unassignedDigest
    || artifact.executionRevision !== metadata["Execution-Revision"]
    || artifact.packageRevision !== metadata["Package-Revision"]) fail("Run creation requires one canonical item assignment");
  const source = executableSnapshot(artifact.selector);
  const recipeRevision = assertExecutableBinding({ artifact, currentCompiled: source.compiled });
  const policy = currentPolicy(repoRoot, recipeRevision);
  const evidence = boundaryEvidence([join(located.dir, "burnlist.md"),
    join(artifact.path, "manifest.json"), join(artifact.path, "recipe.frozen"), ...policy.authorityInputs.map((input) => input.path)]);
  const value = Object.freeze({ runId: request.runId, assignmentId: artifact.assignmentId,
    itemRef: artifact.itemRef, itemRevision: artifact.assignedItemDigest,
    itemText: metadata.unassignedSpan.toString("utf8"),
    frozenRecipeBytes: Buffer.from(artifact.frozenRecipeBytes), policyBytes: Buffer.from(policy.bytes),
    boundaryEvidence: Object.freeze([...evidence, ...assignmentAncestorEvidence(repoRoot, artifact.path), ...source.evidence]) });
  return value;
}

function sealRunAuthority(runId, authority) {
  if (!authority || authority.runId !== runId || !Buffer.isBuffer(authority.frozenRecipeBytes) || !Buffer.isBuffer(authority.policyBytes)) fail("invalid production runner authority");
  return Object.freeze({ schema: "burnlist-loop-m12-run-authority@1", runId, assignmentId: authority.assignmentId,
    itemRef: authority.itemRef, itemRevision: authority.itemRevision, itemText: authority.itemText,
    frozenRecipe: authority.frozenRecipeBytes.toString("base64"), policy: authority.policyBytes.toString("base64") });
}
function unsealRunAuthority(authority) {
  if (!authority || authority.schema !== "burnlist-loop-m12-run-authority@1") fail("sealed production authority is unavailable");
  return Object.freeze({ runId: authority.runId, assignmentId: authority.assignmentId, itemRef: authority.itemRef,
    itemRevision: authority.itemRevision, itemText: authority.itemText, frozenRecipeBytes: Buffer.from(authority.frozenRecipe, "base64"),
    policyBytes: Buffer.from(authority.policy, "base64") });
}

/** The one production creation path seals all dispatch inputs before the Run exists. */
export async function createProductionRun({ repoRoot, store, itemRef, runId = newRunId() }) {
  if (!store?.createRun || typeof repoRoot !== "string" || typeof itemRef !== "string") fail("invalid production Run creation");
  let authority = await bindRunCreation({ repoRoot, input: { runId, itemRef } });
  // A reservation is durable before its Run directory is published.  A normal
  // CLI retry has no RunRef to repeat, so recover only an absent reservation
  // for this exact still-bound assignment; every other current Run remains the
  // store's normal admission decision.
  const reserved = store.readCurrentRun?.(authority.itemRef);
  if (reserved && reserved.runId !== runId && reserved.assignmentId === authority.assignmentId) {
    try { store.read(reserved.runId); }
    catch (error) {
      if (error?.code !== "ENOENT") throw error;
      runId = reserved.runId;
      authority = await bindRunCreation({ repoRoot, input: { runId, itemRef } });
    }
  }
  revalidatePreparedBinding({ repoRoot, bound: authority });
  const graph = loadFrozenRecipe(authority.frozenRecipeBytes).ir;
  store.createRun({ runId, itemRef: authority.itemRef, graph, authority: sealRunAuthority(runId, authority) });
  return store.read(runId);
}

/** Final synchronous publication boundary over the exact assignment and live policy. */
export function revalidatePreparedBinding({ repoRoot, bound }) {
  assertBoundaryEvidence(bound.boundaryEvidence);
  const item = parseItemRef(bound.itemRef);
  const located = findBurnlistDir(repoRoot, item.burnlistId);
  const span = locateItemSpan(readFileSync(join(located.dir, "burnlist.md")), item.itemId);
  const metadata = validateAssignedItem(item.selector, span);
  const artifact = assignmentStore(repoRoot).load(metadata["Assignment-Id"]);
  if (artifact.assignmentId !== bound.assignmentId || artifact.itemRef !== bound.itemRef
    || artifact.assignedItemDigest !== bound.itemRevision
    || metadata.unassignedSpan.toString("utf8") !== bound.itemText
    || !artifact.frozenRecipeBytes.equals(bound.frozenRecipeBytes)
    || metadata["Execution-Revision"] !== artifact.executionRevision)
    fail("assignment changed before Run publication", "ELOOP_RUN_BINDING_STALE");
  const policy = currentPolicy(repoRoot, artifact.executionRevision);
  if (!policy.bytes.equals(bound.policyBytes))
    fail("configured authority changed before Run publication", "ELOOP_RUN_BINDING_STALE");
  assertBoundaryEvidence(bound.boundaryEvidence);
  return true;
}
function revalidateAssignedItem({ repoRoot, replay }) {
  const item = parseItemRef(replay.projection.itemRef), located = findBurnlistDir(repoRoot, item.burnlistId);
  if (located.lifecycle.folder !== "inprogress") fail("Run item is no longer active", "ELOOP_RUN_BINDING_STALE");
  const span = locateItemSpan(readFileSync(join(located.dir, "burnlist.md")), item.itemId);
  const metadata = validateAssignedItem(item.selector, span), artifact = assignmentStore(repoRoot).load(metadata["Assignment-Id"]);
  const expectedSelector = `loop:builtin:${replay.frozenRecipe.ir.id}`;
  if (metadata.assignedDigest !== replay.projection.itemRevision
    || metadata["Assignment-Id"] !== replay.projection.assignmentId
    || metadata.Selector !== expectedSelector
    || metadata["Execution-Revision"] !== replay.frozenRecipe.revisions.executable
    || metadata["Package-Revision"] !== replay.frozenRecipe.revisions.package
    || artifact.assignmentId !== replay.projection.assignmentId || artifact.itemRef !== item.selector
    || artifact.assignedItemDigest !== replay.projection.itemRevision || artifact.selector !== expectedSelector
    || artifact.executionRevision !== replay.frozenRecipe.revisions.executable
    || artifact.packageRevision !== replay.frozenRecipe.revisions.package)
    fail("Run item assignment changed after creation", "ELOOP_RUN_BINDING_STALE");
}

/** Launch boundary: live setup/trust is compared with frozen policy; Loop source is not read. */
function acceptCurrentPolicy({ repoRoot, replay, current }) {
  if (!replay?.frozenRecipe?.revisions?.executable || !replay.boundPolicy || !Buffer.isBuffer(replay.policyBytes))
    fail("verified frozen Run authority is required");
  if (!current.bytes.equals(replay.policyBytes)) fail("configured authority changed after Run creation", "ELOOP_RUN_BINDING_STALE");
  revalidateAssignedItem({ repoRoot, replay });
  return current;
}

export function revalidateRunBinding({ repoRoot, replay }) {
  const current = currentPolicy(repoRoot, replay.frozenRecipe.revisions.executable);
  return acceptCurrentPolicy({ repoRoot, replay, current }).policy;
}

/** Capture live launch inputs inside the canonical launch lock; callers never supply this evidence. */
export function captureRunLaunchBinding({ repoRoot, replay }) {
  const current = currentPolicy(repoRoot, replay.frozenRecipe.revisions.executable);
  acceptCurrentPolicy({ repoRoot, replay, current });
  const evidence = liveAuthorityEvidence(current.authorityInputs);
  assertLiveAuthorityEvidence(evidence);
  return Object.freeze({ evidence, authorityDigest: launchAuthorityDigest(evidence) });
}

/** Recheck the exact captured descriptors, ancestors, and digests at the final launch boundary. */
export function recheckRunLaunchBinding(captured) {
  if (!captured || Object.keys(captured).length !== 2 || typeof captured.authorityDigest !== "string") fail("invalid private launch authority evidence");
  assertLiveAuthorityEvidence(captured.evidence);
  if (captured.authorityDigest !== launchAuthorityDigest(captured.evidence)) fail("private launch authority digest changed");
}
export function holdRunLaunchBinding(captured) {
  if (!captured || Object.keys(captured).length !== 2 || typeof captured.authorityDigest !== "string") fail("invalid private launch authority evidence");
  const held = [];
  try { for (const { snapshot } of captured.evidence) held.push(holdSnapshot(snapshot)); return Object.freeze(held); }
  catch (error) { try { releaseRunLaunchBinding(held); } catch {} throw error; }
}
export function releaseRunLaunchBinding(held) {
  if (!Array.isArray(held)) fail("invalid held launch authority");
  let failure;
  for (const item of held) {
    try { releaseSnapshot(item); }
    catch (error) { failure ??= error; }
  }
  if (failure) throw failure;
}

/**
 * Build the production M3 callback from already-frozen Run authority.  This is
 * deliberately a direct Codex path: Docker controllers are legacy setup
 * artifacts and are not consulted for foreground Stage One dispatch.
 */
export function createBoundNormalizedInvocation({ repoRoot, replay, contextFor, candidateForBoundary = null,
  startAgent, runCheck, agentTimeoutMs = 0 }) {
  if (typeof repoRoot !== "string" || !replay?.projection?.assignmentId || !replay?.frozenRecipe?.ir
    || typeof replay.itemText !== "string" || !replay.itemText
    || !Buffer.isBuffer(replay.policyBytes) || typeof contextFor !== "function") fail("invalid production invocation input");
  const policy = loadBoundPolicy(replay.policyBytes).policy;
  const route = (name) => policy.routes.find((entry) => entry.route === name);
  const implementation = route("implementation.standard"), review = route("review.strong");
  if (!implementation || !review) fail("frozen Stage One routes are unavailable");
  const nodes = new Map(replay.frozenRecipe.ir.nodes.map((node) => [node.id, node]));
  return createNormalizedInvocation({ repoRoot, nodes,
    routes: { implementation: { profile: implementation.profile }, review: { profile: review.profile } },
    bindingFor(invocation, node) {
      const context = contextFor(invocation, node), instruction = replay.frozenRecipe.instructions
        .find((item) => item.id === node.instructions);
      if (!context || node.kind === "agent" && !instruction) fail("frozen invocation context is unavailable");
      return { claimId: context.claimId, assignmentId: replay.projection.assignmentId,
        recipeRevision: replay.frozenRecipe.revisions.executable, policyRevision: boundPolicyRevision(policy),
        inputCandidate: context.inputCandidate, instructionBytes: instruction
          ? Buffer.from(instruction.base64, "base64").toString("utf8") : "Run the frozen trusted capability.\n",
        itemText: replay.itemText, candidateContext: context.candidateContext,
        reviewerEvidence: context.reviewerEvidence ?? [] };
    }, candidateForBoundary, startAgent, runCheck, agentTimeoutMs });
}

/** Compose frozen creation authority, the M3 dispatcher, and the M2 runner. */
export function createProductionRunRunner({ repoRoot, store, runId, authority, contextFor,
  startAgent, runCheck, agentTimeoutMs = 0 }) {
  if (authority?.schema === "burnlist-loop-m12-run-authority@1") authority = unsealRunAuthority(authority);
  if (!store?.replay || !authority?.assignmentId || !Buffer.isBuffer(authority.frozenRecipeBytes)
    || !Buffer.isBuffer(authority.policyBytes)) fail("invalid production runner authority");
  const frozenRecipe = loadFrozenRecipe(authority.frozenRecipeBytes);
  const replay = { projection: { assignmentId: authority.assignmentId }, frozenRecipe,
    policyBytes: authority.policyBytes, itemText: authority.itemText };
  const liveContext = (invocation, node) => {
    const execution = store.replay(runId).execution;
    const candidate = execution.candidate ?? deriveCandidate({ repoRoot });
    const checkNode = frozenRecipe.ir.nodes.find((item) => item.kind === "check");
    const check = checkNode && execution.evidence[checkNode.id];
    const reviewerEvidence = node.mode === "review"
      ? check?.kind === "pass" && check.candidateId === candidate.id && execution.latest.check?.candidateId === candidate.id
        ? [`trusted-check candidate=${candidate.id} summary=${execution.latest.check.summary}`] : []
      : [];
    return { claimId: ownerClaimId({ runId: invocation.runId, nodeId: invocation.nodeId, attempt: invocation.attempt,
      assignmentId: authority.assignmentId, inputCandidate: candidate.id }), inputCandidate: candidate.id,
      candidateContext: candidate.context, reviewerEvidence };
  };
  const dispatch = createBoundNormalizedInvocation({ repoRoot, replay, contextFor: contextFor ?? liveContext,
    candidateForBoundary: () => deriveCandidate({ repoRoot }), startAgent, runCheck, agentTimeoutMs });
  const invoke = async (invocation) => {
    const captured = captureRunLaunchBinding({ repoRoot, replay: { ...replay, projection: { ...replay.projection, itemRef: authority.itemRef, itemRevision: authority.itemRevision }, boundPolicy: loadBoundPolicy(authority.policyBytes).policy } });
    recheckRunLaunchBinding(captured); const held = holdRunLaunchBinding(captured);
    try { recheckRunLaunchBinding(captured); return await dispatch(invocation); }
    finally { releaseRunLaunchBinding(held); }
  };
  return createRunRunner({ store, runId, invoke, bindCandidate() {
    const candidate = deriveCandidate({ repoRoot }); return { candidateId: candidate.id, candidateContext: candidate.context };
  } });
}

/** Resume constructs exclusively from the immutable per-Run record; it never rebinds source or policy. */
export function createStoredProductionRunRunner({ repoRoot, store, runId, startAgent, runCheck, agentTimeoutMs = 0 }) {
  if (!store?.readAuthority) fail("sealed production authority is unavailable");
  const authority = store.readAuthority(runId), current = store.readCurrentRun?.(authority.itemRef);
  if (!current || current.runId !== runId || current.assignmentId !== authority.assignmentId) fail("Run is superseded and cannot launch", "ELOOP_RUN_SUPERSEDED");
  return createProductionRunRunner({ repoRoot, store, runId, authority, startAgent, runCheck, agentTimeoutMs });
}
