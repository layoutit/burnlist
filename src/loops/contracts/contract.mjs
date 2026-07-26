import { TextDecoder } from "node:util";
import { RUN_REF } from "../run/run-ref.mjs";

export const MAX_RESULT_BYTES = 65_536;
export const MAX_RESULT_DEPTH = 4;
export const DIGESTS = Object.freeze({
  assignment: /^as1-sha256:[a-f0-9]{64}$/u, claim: /^cl1-sha256:[a-f0-9]{64}$/u,
  invocation: /^iv1-sha256:[a-f0-9]{64}$/u, recipe: /^er1-sha256:[a-f0-9]{64}$/u,
  policy: /^bp1-sha256:[a-f0-9]{64}$/u, candidate: /^cm1-sha256:[a-f0-9]{64}$/u,
  capability: /^cp1-sha256:[a-f0-9]{64}$/u, item: /^id1-sha256:[a-f0-9]{64}$/u,
  artifact: /^artifact:sha256:[a-f0-9]{64}$/u, raw: /^sha256:[a-f0-9]{64}$/u,
});
export const RUN = RUN_REF;
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function error(message, code = "ELOOP_RESULT_CONTRACT") {
  return Object.assign(new TypeError(`Loop result: ${message}`), { code });
}
export function fail(message, code) { throw error(message, code); }
export function exact(value, keys) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
export function sortedUnique(values) {
  return Array.isArray(values) && values.every((value, index) => typeof value === "string" && (index === 0 || Buffer.compare(Buffer.from(values[index - 1]), Buffer.from(value)) < 0));
}
export function identity(value, label = "result") {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !["runId", "nodeId", "attempt", "claimId", "assignmentId", "invocationId", "recipeRevision", "policyRevision", "inputCandidate"].every((key) => Object.hasOwn(value, key))
    || !RUN.test(value.runId) || !SLUG.test(value.nodeId) || !Number.isInteger(value.attempt) || value.attempt < 1 || value.attempt > 100
    || !DIGESTS.claim.test(value.claimId) || !DIGESTS.assignment.test(value.assignmentId) || !DIGESTS.invocation.test(value.invocationId)
    || !DIGESTS.recipe.test(value.recipeRevision) || !DIGESTS.policy.test(value.policyRevision) || !DIGESTS.candidate.test(value.inputCandidate)) fail(`invalid ${label} identity`);
  return value;
}
export function bindingsMatch(value, expected) {
  return ["runId", "nodeId", "attempt", "claimId", "assignmentId", "invocationId", "recipeRevision", "policyRevision", "inputCandidate"].every((key) => value[key] === expected[key]);
}
/** The runner may journal a post-write candidate only after its child is quiescent. */
export function postWriteCandidateRecord({ actor, quiescent, candidate, priorCandidate = null }) {
  if (actor !== "runner" || quiescent !== true || !DIGESTS.candidate.test(candidate)
    || !(priorCandidate === null || DIGESTS.candidate.test(priorCandidate))) fail("post-write candidate lacks runner quiescence authority");
  return Object.freeze({ schema: "burnlist-loop-post-write-candidate@1", actor, quiescent: true, priorCandidate, candidate });
}
function depth(value, level = 0) {
  if (value === null || typeof value !== "object") return level;
  return Math.max(level, ...Object.values(value).map((item) => depth(item, level + 1)));
}
function rejectDuplicateKeys(text, maximumDepth) {
  let index = 0;
  const space = () => { while (/\s/u.test(text[index] ?? "")) index += 1; };
  const string = () => {
    const start = index; index += 1;
    while (index < text.length) { const char = text[index++]; if (char === "\\") { index += 1; continue; } if (char === '"') return JSON.parse(text.slice(start, index)); }
    fail("result has an unterminated string");
  };
  const value = (level) => {
    if (level > maximumDepth) fail("result exceeds JSON depth");
    space(); const char = text[index];
    if (char === '"') { string(); return; }
    if (char === "{") {
      index += 1; const keys = new Set(); space(); if (text[index] === "}") { index += 1; return; }
      while (true) { space(); if (text[index] !== '"') fail("result has invalid object key"); const key = string(); if (keys.has(key)) fail("result has duplicate object key"); keys.add(key); space(); if (text[index++] !== ":") fail("result has invalid object separator"); value(level + 1); space(); if (text[index] === "}") { index += 1; return; } if (text[index++] !== ",") fail("result has invalid object separator"); }
    }
    if (char === "[") { index += 1; space(); if (text[index] === "]") { index += 1; return; } while (true) { value(level + 1); space(); if (text[index] === "]") { index += 1; return; } if (text[index++] !== ",") fail("result has invalid array separator"); } }
    const matched = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/u.exec(text.slice(index));
    if (!matched) fail("result has invalid JSON value"); index += matched[0].length;
  };
  value(0); space(); if (index !== text.length) fail("result has trailing JSON bytes");
}
/** Bounds raw bytes before strict UTF-8/JSON work and rejects duplicate object keys. */
export function parseBoundedObject(bytes, { maximumBytes, maximumDepth, label = "result" }) {
  const raw = Buffer.from(bytes);
  if (raw.length < 2 || raw.length > maximumBytes) fail(`${label} bytes exceed bounds`);
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(raw); } catch { fail(`${label} is not UTF-8`); }
  rejectDuplicateKeys(text, maximumDepth); let value;
  try { value = JSON.parse(text); } catch { fail(`${label} is not JSON`); }
  if (!value || typeof value !== "object" || Array.isArray(value) || depth(value) > maximumDepth) fail(`${label} exceeds JSON depth`);
  return value;
}
/** Strictly parses a bounded UTF-8 JSON result. Canonical JSON is deliberately not required. */
export function parseResultBytes(bytes) {
  return parseBoundedObject(bytes, { maximumBytes: MAX_RESULT_BYTES, maximumDepth: MAX_RESULT_DEPTH });
}
