import type { LandingSnapshot, OvenDataSnapshot, OvenPackageDetail, ProgressSnapshot } from "./types";
import { adaptOvenDefinition, ovenDataPath, ovenDefinitionPath, type OvenQuery, type OvenScope } from "./oven-runtime/definition-adapter";

function baseUrl(input: string): string {
  const url = new URL(input);
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new TypeError("Burnlist TUI server must use http or https.");
  }
  return url.href.replace(/\/$/u, "");
}

async function getJson<T>(base: string, path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    headers: { accept: "application/json" },
    signal,
  });
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Burnlist server returned ${response.status}.`);
  return body as T;
}

export function createDataClient(input: string) {
  const base = baseUrl(input);
  return Object.freeze({
    base,
    async landing(signal?: AbortSignal): Promise<LandingSnapshot> {
      const [projectPayload, burnlistPayload, ovenPayload] = await Promise.all([
        getJson<{ generatedAt: string; projects: LandingSnapshot["projects"] }>(base, "/api/projects", signal),
        getJson<{ generatedAt: string; burnlists: LandingSnapshot["burnlists"] }>(base, "/api/burnlists", signal),
        getJson<{ ovens: LandingSnapshot["ovens"] }>(base, "/api/ovens", signal),
      ]);
      return {
        projects: projectPayload.projects,
        burnlists: burnlistPayload.burnlists,
        ovens: ovenPayload.ovens,
        generatedAt: burnlistPayload.generatedAt ?? projectPayload.generatedAt,
      };
    },
    progress(planPath: string, signal?: AbortSignal): Promise<ProgressSnapshot> {
      return getJson(base, `/api/progress?plan=${encodeURIComponent(planPath)}`, signal);
    },
    ovenData(ovenId: string, repoKey: string | null, signal?: AbortSignal, query?: OvenQuery): Promise<OvenDataSnapshot> {
      return getJson(base, ovenDataPath({ ovenId, repoKey }, query), signal);
    },
    async oven(ovenId: string, repoKey: string | null = null, signal?: AbortSignal): Promise<OvenPackageDetail> {
      const scope: OvenScope = { ovenId, repoKey };
      const response = await getJson<unknown>(base, ovenDefinitionPath(scope), signal);
      const definition = adaptOvenDefinition(response, scope);
      return definition.detail;
    },
  });
}
