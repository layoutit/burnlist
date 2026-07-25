import { assertTrustedCapability } from "../capabilities/trust.mjs";
import { readCapabilityCatalog, resolveCapability } from "../capabilities/contract.mjs";

function record(kind, id, detail, remedy) { return { kind, id, detail, remedy }; }
function clean(error) { return String(error?.message ?? error).replace(/^Loop (?:agent|local config|capability trust|capability): /u, ""); }

/** Strictly read-only: configuration and trust readiness only; no child is launched. */
export function setupStatus({ repoRoot } = {}) {
  const failures = [];
  let resolved;
  try { resolved = resolveCapability(readCapabilityCatalog(repoRoot), "repo-verify"); }
  catch (error) { failures.push(record("capability", "repo-verify", clean(error), "create .burnlist/loop-capabilities.json from the Review Loop capability example, then run burnlist loop capability inspect repo-verify")); }
  if (resolved) {
    try { assertTrustedCapability({ repoRoot, resolved }); }
    catch (error) { failures.push(record("trust", "repo-verify", clean(error), `burnlist loop capability trust repo-verify --revision ${resolved.revision} --grants <json-file>`)); }
  }
  return { ready: failures.length === 0, failures };
}

export function renderSetupStatus(status) {
  if (status.ready) return "Loop setup: ready\n";
  return ["Loop setup: incomplete", ...status.failures.map((failure) => `MISSING ${failure.kind} ${failure.id}: ${failure.detail}\nREMEDIATION: ${failure.remedy}`), ""].join("\n");
}
