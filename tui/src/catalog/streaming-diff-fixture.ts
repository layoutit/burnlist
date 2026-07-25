import { adaptStreamingDiff } from "../../../dashboard/src/lib/streaming-diff-oven-adapter";

const raw = { identity: { logicalRepoKey: "fixture-repository", worktreeKey: "main", session: "run-42" }, updatedAt: "2026-07-24T10:00:00Z", cards: [{ toolUseId: "edit-7", revId: "a1b2", ts: "2026-07-24", status: "partial", partialReason: "Capture still running", files: [{ path: "src/app.ts", kind: "modified", diff: "@@ -1 +1 @@\n-old\n+new" }, { path: "secrets.env", kind: "redacted", meta: { reason: "Sensitive content" } }, { path: "logo.png", kind: "binary", meta: { bytes: 128 } }] }] } as const;
export const streamingDiffFixture = { id: "streaming-diff", checkpoints: ["collapsed", "expanded"] as const, raw, payload: adaptStreamingDiff(raw as any) as any } as const;
/** The landing feed model is separate from the selected-session Oven payload. */
export const streamingFeedFixture = {
  feeds: [
    { identity: raw.identity, repoLabel: "Example", updatedAt: raw.updatedAt, href: "/r/fixture-repository/o/streaming-diff?worktreeKey=main&session=run-42" },
    { identity: { logicalRepoKey: "fixture-repository", worktreeKey: "feature", session: "run-43" }, repoLabel: "Example", updatedAt: "2026-07-24T09:00:00Z", href: "/r/fixture-repository/o/streaming-diff?worktreeKey=feature&session=run-43" },
  ],
  showRepository: true,
} as const;
