import { assertTrustedCapability } from "../capabilities/trust.mjs";
import { readCapabilityCatalog, resolveCapability } from "../capabilities/contract.mjs";
import { lstatSync } from "node:fs";
import { resolve } from "node:path";

function record(kind, id, detail, remedy) { return { kind, id, detail, remedy }; }
function clean(error) { return String(error?.message ?? error).replace(/^Loop (?:agent|local config|capability trust|capability): /u, ""); }

/** Strictly read-only: configuration and trust readiness only; no child is launched. */
export function setupStatus({ repoRoot } = {}) {
  const failures = [];
  let resolved;
  try { resolved = resolveCapability(readCapabilityCatalog(repoRoot), "repo-verify"); }
  catch (error) { failures.push(record("capability", "repo-verify", clean(error), "create .burnlist/loop-capabilities.json from the Review Loop capability example, then run burnlist loop capability inspect repo-verify")); }
  if (resolved) {
    try {
      const trusted = assertTrustedCapability({ repoRoot, resolved });
      const paths = new Set([trusted.grants.cwd, ...trusted.grants.filesystem.read, ...trusted.grants.filesystem.write]);
      for (const path of paths) {
        try { lstatSync(resolve(repoRoot, path)); }
        catch (error) {
          if (error?.code !== "ENOENT") throw error;
          failures.push(record("path", path, "configured capability path does not exist",
            "create the path or narrow the capability catalog and grants to existing paths, then trust the new revision"));
        }
      }
    }
    catch (error) { failures.push(record("trust", "repo-verify", clean(error), `burnlist loop capability trust repo-verify --revision ${resolved.revision} --grants <json-file>`)); }
  }
  return { ready: failures.length === 0, failures };
}

export function renderSetupStatus(status) {
  if (status.ready) return "Loop setup: ready\n";
  return ["Loop setup: incomplete", ...status.failures.map((failure) => `MISSING ${failure.kind} ${failure.id}: ${failure.detail}\nREMEDIATION: ${failure.remedy}`), ""].join("\n");
}
