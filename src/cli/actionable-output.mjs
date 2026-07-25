import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { repoKey } from "../server/registry.mjs";

const DEFAULT_DASHBOARD_URL = "http://127.0.0.1:4510/";

function loopbackUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:"
      || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) return null;
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function dashboardRuntime({
  runtimePath = join(homedir(), ".burnlist", "server.json"),
  pidAlive = (pid) => {
    try { process.kill(pid, 0); return true; } catch { return false; }
  },
} = {}) {
  try {
    if (!existsSync(runtimePath)) return { baseUrl: DEFAULT_DASHBOARD_URL, live: false };
    const runtime = JSON.parse(readFileSync(runtimePath, "utf8"));
    const baseUrl = loopbackUrl(runtime?.url);
    if (!baseUrl || !Number.isSafeInteger(runtime?.pid) || runtime.pid <= 0 || !pidAlive(runtime.pid)) {
      return { baseUrl: DEFAULT_DASHBOARD_URL, live: false };
    }
    return { baseUrl, live: true };
  } catch {
    return { baseUrl: DEFAULT_DASHBOARD_URL, live: false };
  }
}

function canonicalRepoRoot(repoRoot) {
  try { return realpathSync(repoRoot); } catch { return repoRoot; }
}

export function dashboardUrl(repoRoot, {
  burnlistId = null,
  ovenId = null,
  runtime,
} = {}) {
  const root = canonicalRepoRoot(repoRoot);
  const state = runtime ?? dashboardRuntime();
  let path = `r/${repoKey(root)}`;
  if (burnlistId) path += `/${encodeURIComponent(burnlistId)}`;
  if (ovenId) path += `/o/${encodeURIComponent(ovenId)}`;
  return new URL(path, state.baseUrl).toString();
}

export function dashboardCatalogUrl(ovenId = null, { runtime } = {}) {
  const state = runtime ?? dashboardRuntime();
  return new URL(ovenId ? `ovens/${encodeURIComponent(ovenId)}` : "ovens", state.baseUrl).toString();
}

export function dashboardHandoff(repoRoot, url, nextCommand, { runtime } = {}) {
  const state = runtime ?? dashboardRuntime();
  const lines = [`Dashboard: ${url}`];
  if (!state.live) lines.push(`Dashboard start: burnlist --scan-root ${JSON.stringify(canonicalRepoRoot(repoRoot))}`);
  if (nextCommand) lines.push(`Next: ${nextCommand}`);
  return lines.join("\n");
}
