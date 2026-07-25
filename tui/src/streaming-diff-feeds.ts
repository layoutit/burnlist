import type { createDataClient } from "./data-client";
import type { ProjectSummary } from "./types";

type Client = ReturnType<typeof createDataClient>;
export function streamingRepositories(projects: readonly ProjectSummary[], repoKey: string | null) { return repoKey ? [{ repoKey, label: repoKey }] : projects.flatMap((project) => project.repoKey ? [{ repoKey: project.repoKey, label: project.displayName }] : []); }
export async function loadStreamingFeeds(client: Client, repositories: readonly { repoKey: string; label: string }[], signal?: AbortSignal) {
  const results = await Promise.allSettled(repositories.map(async (repository) => (await client.streamingFeeds(repository.repoKey, signal)).map((feed: { repoLabel?: string }) => ({ ...feed, repoLabel: repository.label }))));
  const feeds = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (results.some((result) => result.status === "fulfilled") || !repositories.length) return feeds.sort((left: { updatedAt?: string | null }, right: { updatedAt?: string | null }) => (Date.parse(right.updatedAt ?? "") || 0) - (Date.parse(left.updatedAt ?? "") || 0));
  const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  throw failure?.reason ?? new Error("Could not load recent feeds.");
}
