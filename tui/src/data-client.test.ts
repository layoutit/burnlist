import { afterEach, describe, expect, mock, test } from "bun:test";
import { createDataClient } from "./data-client";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("Burnlist TUI data client", () => {
  test("loads the three landing resources concurrently", async () => {
    globalThis.fetch = mock(async (request: string | URL | Request) => {
      const path = new URL(String(request)).pathname;
      if (path === "/api/projects") return Response.json({ generatedAt: "now", projects: [{ displayName: "app" }] });
      if (path === "/api/burnlists") return Response.json({ generatedAt: "now", burnlists: [{ id: "ui" }] });
      return Response.json({ ovens: [{ id: "checklist" }] });
    }) as unknown as typeof fetch;
    const snapshot = await createDataClient("http://127.0.0.1:4815").landing();
    expect(snapshot.projects[0]?.displayName).toBe("app");
    expect(snapshot.burnlists[0]?.id).toBe("ui");
    expect(snapshot.ovens[0]?.id).toBe("checklist");
  });

  test("surfaces server errors", async () => {
    globalThis.fetch = mock(async () => Response.json({ error: "not ready" }, { status: 409 })) as unknown as typeof fetch;
    expect(createDataClient("http://127.0.0.1:4815").progress("/tmp/a"))
      .rejects.toThrow("not ready");
  });

  test("loads a repository-scoped Oven payload", async () => {
    let requested = "";
    globalThis.fetch = mock(async (request: string | URL | Request) => {
      requested = String(request);
      return Response.json({ ovenId: "visual-parity", payload: { schema: "burnlist-visual-parity-data@1" }, validated: true });
    }) as unknown as typeof fetch;
    const snapshot = await createDataClient("http://127.0.0.1:4815").ovenData("visual-parity", "abc123");
    expect(requested).toContain("/api/oven-data/visual-parity?repoKey=abc123");
    expect(snapshot.validated).toBe(true);
  });

  test("loads a generic Oven package without a repository binding", async () => {
    let requested = "";
    globalThis.fetch = mock(async (request: string | URL | Request) => {
      requested = String(request);
      return Response.json({ oven: { id: "checklist", name: "Checklist", instructions: "# Checklist" } });
    }) as unknown as typeof fetch;
    const oven = await createDataClient("http://127.0.0.1:4815").oven("checklist");
    expect(requested).toEndWith("/api/ovens/checklist");
    expect(oven.instructions).toBe("# Checklist");
  });
});
