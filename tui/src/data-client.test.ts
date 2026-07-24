import { afterEach, describe, expect, mock, test } from "bun:test";
import { createDataClient } from "./data-client";
// @ts-expect-error Production DSL remains JavaScript by design.
import { compileOven } from "../../src/ovens/dsl/oven-compile.mjs";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
function validIr(id: string) {
  const source = `<oven id="${id}" version="0.1.0" contract="checklist-progress@1" theme="checklist"><kpi-strip title="Fixture"><kpi-item heading="Current" source="/current"/></kpi-strip></oven>`;
  const result = compileOven(source, { file: `${id}.oven` });
  if (!result.ok) throw new Error(`Fixture ${id} did not compile.`);
  return { source, ir: result.ir };
}

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
    const fixture = validIr("checklist");
    globalThis.fetch = mock(async (request: string | URL | Request) => {
      requested = String(request);
      return Response.json({ oven: {
        id: "checklist", name: "Checklist", description: "Progress", version: "0.1.0", contract: "checklist-progress@1", builtIn: true, dataInput: "producer-managed", instructions: "# Checklist", oven: fixture.source, repoKey: null,
        ovenRevision: `o1-sha256:${"a".repeat(64)}`,
        ir: fixture.ir,
      } });
    }) as unknown as typeof fetch;
    const oven = await createDataClient("http://127.0.0.1:4815").oven("checklist");
    expect(requested).toEndWith("/api/ovens/checklist");
    expect(oven.instructions).toBe("# Checklist");
  });

  test("loads a same-id custom Oven definition in its repository scope", async () => {
    let requested = "";
    const fixture = validIr("shared");
    globalThis.fetch = mock(async (request: string | URL | Request) => {
      requested = String(request);
      return Response.json({ oven: {
        id: "shared", name: "Repository shared", description: "Scoped", version: "0.1.0", contract: "checklist-progress@1", builtIn: false, dataInput: "json-payload", instructions: "# Shared", oven: fixture.source, repoKey: "repo/a", ovenRevision: `o1-sha256:${"b".repeat(64)}`,
        ir: fixture.ir,
      } });
    }) as unknown as typeof fetch;
    const oven = await createDataClient("http://127.0.0.1:4815").oven("shared", "repo/a");
    expect(requested).toEndWith("/api/ovens/shared?repoKey=repo%2Fa");
    expect(oven.repoKey).toBe("repo/a");
    expect(oven.ovenRevision).toBe(`o1-sha256:${"b".repeat(64)}`);
  });
});
