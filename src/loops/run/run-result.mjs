const SYSTEM = new Set(["error", "timeout", "cancelled", "lost", "exhausted"]);
const semantic = {
  task: new Set(["complete"]), review: new Set(["approve", "reject", "escalate"]), check: new Set(["pass", "fail"]),
};
const exact = (value, keys) => Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const fail = (message) => { throw Object.assign(new Error(`Run result: ${message}`), { code: "ERESULT" }); };

export function isSystemOutcome(kind) { return SYSTEM.has(kind); }
export function validateNormalizedResult(value, node, maximumOutputBytes) {
  if (!exact(value, ["kind", "summary", "outputBytes", "candidateId"]) || typeof value.kind !== "string" || typeof value.summary !== "string"
    || Buffer.byteLength(value.summary, "utf8") > 1024 || !Number.isSafeInteger(value.outputBytes) || value.outputBytes < 0 || value.outputBytes > maximumOutputBytes) fail("invalid normalized result");
  if (!(value.candidateId === null || /^cm1-sha256:[a-f0-9]{64}$/u.test(value.candidateId))) fail("invalid result candidate");
  const allowed = node?.kind === "agent" ? semantic[node.mode] : semantic[node?.kind];
  if (!SYSTEM.has(value.kind) && !allowed?.has(value.kind)) fail("outcome is not legal for node");
  return Object.freeze({ ...value });
}
