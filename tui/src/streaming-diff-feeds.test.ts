import { expect, test } from "bun:test";
import { loadStreamingFeeds, streamingRepositories } from "./streaming-diff-feeds";
const feed = (repo: string, session: string, updatedAt: string) => ({ identity: { logicalRepoKey: repo, worktreeKey: "main", session }, updatedAt, href: `/${repo}/${session}` });
test("global feed loader retains successful labeled repositories and rejects only when all fail", async () => {
  const client = { streamingFeeds: async (repo: string) => { if (repo === "bad") throw new Error("unavailable"); return [feed(repo, "one", repo === "good" ? "2026-07-24T11:00:00Z" : "2026-07-24T10:00:00Z")]; } } as any;
  const repositories = streamingRepositories([{ repoKey: "good", displayName: "Good" }, { repoKey: "bad", displayName: "Bad" }] as any, null);
  const loaded = await loadStreamingFeeds(client, repositories); expect(loaded).toHaveLength(1); expect(loaded[0]).toMatchObject({ repoLabel: "Good", identity: { logicalRepoKey: "good" } });
  await expect(loadStreamingFeeds({ streamingFeeds: async () => { throw new Error("all unavailable"); } } as any, repositories)).rejects.toThrow("all unavailable");
  expect(await loadStreamingFeeds({ streamingFeeds: async () => [] } as any, repositories)).toEqual([]);
  expect(await loadStreamingFeeds(client, [])).toEqual([]);
});
