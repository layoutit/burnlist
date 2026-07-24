import type { LandingSnapshot, OvenDataSnapshot, OvenPackageDetail, ProgressSnapshot } from "./types";
import { adaptOvenDefinition, ovenDataPath, ovenDefinitionPath, type OvenQuery, type OvenScope } from "./oven-runtime/definition-adapter";
import { adaptStreamingDiff } from "../../dashboard/src/lib/streaming-diff-oven-adapter";
// @ts-expect-error Console feed mapper is the canonical route/filter boundary.
import { mapStreamingDiffFeeds } from "../../dashboard/src/lib/streaming-diff.mjs";

function baseUrl(input: string): string {
  const url = new URL(input);
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new TypeError("Burnlist TUI server must use http or https.");
  }
  return url.href.replace(/\/$/u, "");
}

type CachedJson = { etag: string; body: unknown };
export type SnapshotFetch<T> = Readonly<{ data: T; outcome: "accepted" | "unchanged" }>;
const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export class DataClientError extends Error {
  constructor(message: string, readonly status?: number) { super(message); this.name = "DataClientError"; }
}

async function getJsonResult<T>(base: string, path: string, cache: Map<string, CachedJson>, signal?: AbortSignal): Promise<SnapshotFetch<T>> {
  const cached = cache.get(path);
  const response = await fetch(`${base}${path}`, {
    headers: { accept: "application/json", ...(cached ? { "If-None-Match": cached.etag } : {}) },
    signal,
  });
  if (response.status === 304) {
    if (!cached) throw new DataClientError("Burnlist server returned 304 before an initial snapshot.", 304);
    return { data: cloneJson(cached.body as T), outcome: "unchanged" };
  }
  const body = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) {
    if (response.status === 404 || response.status === 410) cache.delete(path);
    throw new DataClientError(body?.error ?? `Burnlist server returned ${response.status}.`, response.status);
  }
  if (body === null) throw new DataClientError("Burnlist server returned malformed JSON.", response.status);
  const etag = response.headers.get("etag");
  if (etag) cache.set(path, { etag, body: cloneJson(body) });
  return { data: cloneJson(body as T), outcome: "accepted" };
}

async function getJson<T>(base: string, path: string, cache: Map<string, CachedJson>, signal?: AbortSignal): Promise<T> {
  return (await getJsonResult<T>(base, path, cache, signal)).data;
}

export function createDataClient(input: string) {
  const base = baseUrl(input);
  const cache = new Map<string, CachedJson>();
  return Object.freeze({
    base,
    async landing(signal?: AbortSignal): Promise<LandingSnapshot> {
      const [projectPayload, burnlistPayload, ovenPayload] = await Promise.all([
        getJson<{ generatedAt: string; projects: LandingSnapshot["projects"] }>(base, "/api/projects", cache, signal),
        getJson<{ generatedAt: string; burnlists: LandingSnapshot["burnlists"] }>(base, "/api/burnlists", cache, signal),
        getJson<{ ovens: LandingSnapshot["ovens"] }>(base, "/api/ovens", cache, signal),
      ]);
      return {
        projects: projectPayload.projects,
        burnlists: burnlistPayload.burnlists,
        ovens: ovenPayload.ovens,
        generatedAt: burnlistPayload.generatedAt ?? projectPayload.generatedAt,
      };
    },
    progress(planPath: string, signal?: AbortSignal): Promise<ProgressSnapshot> {
      return getJson(base, `/api/progress?plan=${encodeURIComponent(planPath)}`, cache, signal);
    },
    progressResult(planPath: string, signal?: AbortSignal): Promise<SnapshotFetch<ProgressSnapshot>> {
      return getJsonResult(base, `/api/progress?plan=${encodeURIComponent(planPath)}`, cache, signal);
    },
    ovenData(ovenId: string, repoKey: string | null, signal?: AbortSignal, query?: OvenQuery): Promise<OvenDataSnapshot> {
      return getJson(base, ovenDataPath({ ovenId, repoKey }, query), cache, signal);
    },
    ovenDataResult(ovenId: string, repoKey: string | null, signal?: AbortSignal, query?: OvenQuery): Promise<SnapshotFetch<OvenDataSnapshot>> {
      return getJsonResult(base, ovenDataPath({ ovenId, repoKey }, query), cache, signal);
    },
    async streamingFeeds(repoKey: string, signal?: AbortSignal) {
      const raw = await getJson<unknown>(base, `/api/oven-data/streaming-diff?list=&repoKey=${encodeURIComponent(repoKey)}`, cache, signal);
      return mapStreamingDiffFeeds(raw).filter((feed: { identity: { logicalRepoKey: string } }) => feed.identity.logicalRepoKey === repoKey);
    },
    async streamingSession(repoKey: string, worktreeKey: string, session: string, signal?: AbortSignal): Promise<OvenDataSnapshot> {
      const query = new URLSearchParams({ repoKey, worktreeKey, session });
      const raw = await getJson<unknown>(base, `/api/oven-data/streaming-diff?${query}`, cache, signal);
      return { ovenId: "streaming-diff", payload: adaptStreamingDiff(raw as never) };
    },
    async oven(ovenId: string, repoKey: string | null = null, signal?: AbortSignal): Promise<OvenPackageDetail> {
      const scope: OvenScope = { ovenId, repoKey };
      const response = await getJson<unknown>(base, ovenDefinitionPath(scope), cache, signal);
      const definition = adaptOvenDefinition(response, scope);
      return definition.detail;
    },
    async ovenResult(ovenId: string, repoKey: string | null = null, signal?: AbortSignal): Promise<SnapshotFetch<OvenPackageDetail>> {
      const scope: OvenScope = { ovenId, repoKey };
      const response = await getJsonResult<unknown>(base, ovenDefinitionPath(scope), cache, signal);
      return { data: adaptOvenDefinition(response.data, scope).detail, outcome: response.outcome };
    },
  });
}
