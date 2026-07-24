export const streamingDiffFixture = {
  id: "streaming-diff",
  checkpoints: ["collapsed", "expanded"] as const,
  payload: {
    identity: { session: "run-42" },
    feeds: [{ identity: { session: "run-42", worktreeKey: "main" }, repoLabel: "Example repository", updatedAt: "2026-07-24T10:00:00Z" }],
    cards: [{ toolUseId: "edit-7", revId: "a1b2", ts: "2026-07-24", status: "partial", partialReason: "Capture still running", files: [{ path: "src/app.ts", kind: "modified", diff: "@@ -1 +1 @@\n-old\n+new" }, { path: "secrets.env", kind: "redacted", meta: { reason: "Sensitive content" } }, { path: "logo.png", kind: "binary", meta: { bytes: 128 } }] }],
  },
} as const;
