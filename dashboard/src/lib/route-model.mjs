const ovenSections = new Map([
  ["differential-testing", "differential-testing"],
  ["model-lab", "model-lab"],
  ["performance-tracing", "performance-tracing"],
  ["streaming-diff", "streaming-diff"],
  ["visual-parity", "visual-parity"],
]);

function decode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function parts(pathname) {
  return String(pathname ?? "").split("/").filter(Boolean).map(decode);
}

function params(search) {
  if (search instanceof URLSearchParams) return new URLSearchParams(search);
  return new URLSearchParams(String(search ?? ""));
}

function queryFields(search, names) {
  const source = params(search);
  return Object.fromEntries(names.flatMap((name) => source.has(name) ? [[name, source.get(name)]] : []));
}

function ovenRoute({ repoKey, burnlistId, ovenId, search }) {
  if (burnlistId && ovenId === "checklist") return { section: "burnlist", repoKey, burnlistId, ovenId, ...queryFields(search, ["plan", "filter", "page"]) };
  const section = ovenSections.get(ovenId) ?? "custom-oven";
  const fields = section === "differential-testing"
    ? ["scenario", "plan", "filter", "page"]
    : section === "streaming-diff"
      ? ["worktreeKey", "session", "plan", "filter", "page"]
      : ["plan", "filter", "page"];
  return { section, repoKey, ...(burnlistId ? { burnlistId } : {}), ovenId, ...queryFields(search, fields) };
}

export function parseRoute({ pathname = "/", search = "" } = {}) {
  const path = parts(pathname);
  if (path.length === 0) {
    const plan = queryFields(search, ["plan", "filter"]);
    return plan.plan ? { section: "burnlist", ...plan } : { section: "landing", ...plan };
  }
  if (path.length === 1 && path[0] === "ovens") return { section: "ovens-catalog" };
  if (path.length === 2 && path[0] === "ovens") return path[1] === "new"
    ? { section: "new-oven" }
    : { section: "oven-explainer", ovenId: path[1] };
  if (path.length === 2 && path[0] === "runs" && path[1] === "new") return { section: "run-burn" };
  if (path.length === 3 && path[0] === "r") return { section: "burnlist", repoKey: path[1], burnlistId: path[2], ...queryFields(search, ["plan", "filter", "page"]) };
  if (path.length === 4 && path[0] === "r" && path[2] === "o") return ovenRoute({ repoKey: path[1], ovenId: path[3], search });
  if (path.length === 5 && path[0] === "r" && path[3] === "o") return ovenRoute({ repoKey: path[1], burnlistId: path[2], ovenId: path[4], search });
  if (path.length === 2 && !["api", "ovens", "runs"].includes(path[0])) return { section: "burnlist", repo: path[0], burnlistId: path[1], ...queryFields(search, ["plan", "filter", "page"]) };
  return { section: "landing", ...queryFields(search, ["filter"]) };
}

function queryString(query) {
  const result = new URLSearchParams();
  if (query instanceof URLSearchParams) {
    for (const [key, value] of query) result.append(key, value);
  } else if (typeof query === "string") {
    for (const [key, value] of new URLSearchParams(query)) result.append(key, value);
  } else if (query && typeof query === "object") {
    for (const [key, value] of Object.entries(query)) if (value !== null && value !== undefined && value !== "") result.set(key, String(value));
  }
  const value = result.toString();
  return value ? `?${value}` : "";
}

export function repoOvenHref({ repoKey, ovenId, query } = {}) {
  const path = repoKey
    ? `/r/${encodeURIComponent(repoKey)}/o/${encodeURIComponent(ovenId)}`
    : `/ovens/${encodeURIComponent(ovenId)}`;
  return `${path}${queryString(query)}`;
}

export function burnlistHref({ repoKey, burnlistId, query } = {}) {
  return `/r/${encodeURIComponent(repoKey)}/${encodeURIComponent(burnlistId)}${queryString(query)}`;
}

export function streamingDiffFeedHref({ repoKey, worktreeKey, session } = {}) {
  return repoOvenHref({ repoKey, ovenId: "streaming-diff", query: { worktreeKey, session } });
}

export function differentialTestingScenarioHref({ repoKey, scenario } = {}) {
  return repoOvenHref({ repoKey, ovenId: "differential-testing", query: { scenario } });
}

export function legacyRoute({ pathname = "/", search = "" } = {}) {
  const match = String(pathname).match(/^\/ovens\/([a-z0-9]+(?:-[a-z0-9]+)*)\/view$/u);
  if (!match) return null;
  const source = params(search);
  const repoKey = source.get("repoKey");
  source.delete("repoKey");
  return repoOvenHref({ repoKey, ovenId: decode(match[1]), query: source });
}
