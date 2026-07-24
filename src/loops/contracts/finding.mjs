import { prefixed } from "../dsl/hash.mjs";
import { DIGESTS, exact, fail, sortedUnique } from "./contract.mjs";

const KEYS = ["id", "severity", "summary", "evidenceRefs"];
const SEVERITIES = new Set(["blocker", "major", "minor", "note"]);
const ID = /^fi1-sha256:[a-f0-9]{64}$/u;
const FORBIDDEN_UNICODE = /[\p{Cc}\p{Cf}\p{Cs}]/u;

function fields({ severity, summary, evidenceRefs }) {
  if (!SEVERITIES.has(severity) || typeof summary !== "string" || !summary || Buffer.byteLength(summary) > 512
    || FORBIDDEN_UNICODE.test(summary) || !Array.isArray(evidenceRefs) || evidenceRefs.length < 1 || evidenceRefs.length > 16
    || !sortedUnique(evidenceRefs) || evidenceRefs.some((ref) => !DIGESTS.artifact.test(ref))) fail("invalid finding");
}
export function findingId(value) {
  fields(value);
  const { severity, summary, evidenceRefs } = value;
  return prefixed("fi1-sha256:", "finding-v1", [severity, summary, ...evidenceRefs]);
}

/** Validates a closed finding and proves its content-addressed identity. */
export function validateFinding(value) {
  if (!exact(value, KEYS) || !ID.test(value.id)) fail("invalid finding");
  fields(value);
  if (value.id !== findingId(value)) fail("finding id does not bind its content");
  return Object.freeze({ id: value.id, severity: value.severity, summary: value.summary, evidenceRefs: Object.freeze([...value.evidenceRefs]) });
}

export function validateFindingSet(findings, resolvedFindingIds, openFindings = new Map()) {
  if (!Array.isArray(findings) || findings.length > 50 || !Array.isArray(resolvedFindingIds) || resolvedFindingIds.length > 50
    || !sortedUnique(resolvedFindingIds) || resolvedFindingIds.some((id) => !ID.test(id))) fail("invalid finding set");
  const checked = findings.map(validateFinding);
  if (!sortedUnique(checked.map((finding) => finding.id)) || new Set(checked.map((finding) => finding.id)).size !== checked.length) fail("findings are not id-sorted unique");
  const seen = new Set();
  for (const finding of checked) {
    const earlier = openFindings.get(finding.id);
    if (earlier && JSON.stringify(earlier) !== JSON.stringify(finding)) fail("existing finding id changed");
    seen.add(finding.id);
  }
  for (const id of resolvedFindingIds) {
    if (seen.has(id) || !openFindings.has(id)) fail("resolution is not an open finding");
  }
  for (const id of openFindings.keys()) if (!seen.has(id) && !resolvedFindingIds.includes(id)) fail("open finding was neither preserved nor resolved");
  return Object.freeze({ findings: Object.freeze(checked), resolvedFindingIds: Object.freeze([...resolvedFindingIds]) });
}

export function nextOpenFindings(openFindings, result) {
  const next = new Map(openFindings);
  for (const id of result.resolvedFindingIds) next.delete(id);
  for (const finding of result.findings) next.set(finding.id, finding);
  return next;
}
