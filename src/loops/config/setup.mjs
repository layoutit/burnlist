import { assertTrustedCapability } from "../capabilities/trust.mjs";
import { readCapabilityCatalog, resolveCapability } from "../capabilities/contract.mjs";
import { resolveConfiguredStageOneRoutes } from "../agents/profile.mjs";
import { readProfile, readRoute, requiredRoutes } from "./profiles.mjs";

function profileCommand(slug = "<slug>", authority = "read|write") { return `burnlist agent profile add ${slug} --adapter builtin:codex-cli --binary <absolute-path> --model <id> --effort <level> --authority ${authority}`; }
function routeCommand(route) { return `burnlist route set ${route} --profile <slug>`; }
function record(kind, id, detail, remedy) { return { kind, id, detail, remedy }; }
function clean(error) { return String(error?.message ?? error).replace(/^Loop (?:agent|local config|capability trust|capability): /u, ""); }

/** Strictly read-only: configuration and trust readiness only; no child is launched. */
export function setupStatus({ repoRoot } = {}) {
  const failures = [], profiles = [], routes = {};
  for (const expected of requiredRoutes) {
    let assigned;
    try { assigned = readRoute({ repoRoot, route: expected.route }); routes[expected.route] = assigned.profile; }
    catch (error) { failures.push(record("route", expected.route, clean(error), routeCommand(expected.route))); continue; }
    let profile;
    try { profile = readProfile({ repoRoot, slug: assigned.profile }); profiles.push(profile); }
    catch (error) { failures.push(record("profile", assigned.profile, clean(error), profileCommand(assigned.profile, expected.authority))); continue; }
  }
  if (Object.keys(routes).length === requiredRoutes.length && profiles.length === requiredRoutes.length) {
    try { resolveConfiguredStageOneRoutes({ profiles, routes }); }
    catch (error) { failures.push(record("routing", "stage-one", clean(error), "repair the named profile or route and run burnlist loop setup status again")); }
  }
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
