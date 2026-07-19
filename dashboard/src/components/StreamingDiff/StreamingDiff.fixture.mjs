export const streamingDiffFixture = {
  identity: {
    logicalRepoKey: "fixture/repository",
    worktreeKey: "feature-streaming-diff",
    session: "session-20260718-102030",
  },
  updatedAt: "2026-07-18T10:24:00.000Z",
  cards: [
    {
      revId: "r-0123456789abcdef",
      toolUseId: "tool-captured-001",
      ts: "2026-07-18T10:20:30.000Z",
      status: "captured",
      files: [
        {
          path: "src/streaming-diff.ts",
          kind: "modified",
          diff: "@@ -1 +1 @@\n-export const state = \"old\";\n+export const state = \"new\";",
        },
        {
          path: "src/new-file.mjs",
          kind: "added",
          diff: "@@ -0,0 +1,2 @@\n+export const ready = true;\n+",
        },
        {
          path: "notes/obsolete.txt",
          kind: "deleted",
          diff: "@@ -1 +0,0 @@\n-remove this note",
        },
      ],
    },
    {
      revId: "r-fedcba9876543210",
      toolUseId: "tool-partial-002",
      ts: "2026-07-18T10:23:45.000Z",
      status: "partial",
      partialReason: "Binary output was captured as metadata only.",
      files: [
        {
          path: "assets/preview.bin",
          kind: "binary",
          meta: {
            bytes: 4096,
            reason: "Binary content is not rendered.",
          },
        },
      ],
    },
  ],
};
