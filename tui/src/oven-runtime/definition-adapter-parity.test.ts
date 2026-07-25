import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
// @ts-expect-error Production compiler intentionally remains JavaScript.
import { compileOven } from "../../../src/ovens/dsl/oven-compile.mjs";
// @ts-expect-error Console source remains JavaScript by design.
import { ovenDefinitionUrl } from "../../../dashboard/src/lib/oven-definition.mjs";
// @ts-expect-error Console source remains JavaScript by design.
import { runtimeCollectionPage } from "../../../dashboard/src/oven/runtime/oven-payload-metadata.ts";
// @ts-expect-error Console source remains JavaScript by design.
import { parseRoute, repoOvenHref } from "../../../dashboard/src/lib/route-model.mjs";
import { adaptOvenDefinition, definitionChangeInvalidates, ovenDataPath, ovenDefinitionPath, ovenPageEnvelope, ovenScopeKey } from "./definition-adapter";
import { adaptChecklist } from "../../../dashboard/src/lib/checklist-adapter";
import { admitTerminalOven } from "./terminal-contract";
import { TERMINAL_IMPLEMENTED_CAPABILITIES } from "./components/terminal-capabilities";
// @ts-expect-error Server fixture is production JavaScript by design.
import { httpGet, withServer } from "../../../src/server/dashboard-routes-fixtures.mjs";

const revision = `o1-sha256:${"a".repeat(64)}`;
const source = readFileSync(new URL("../../../ovens/checklist/checklist.oven", import.meta.url), "utf8").replace('id="checklist"', 'id="shared"');
const compiled = compileOven(source, { file: "shared.oven" });
if (!compiled.ok) throw new Error("Scoped definition fixture did not compile.");
const ir = compiled.ir;
const detail = { id: "shared", name: "Shared", description: "Scoped", version: "0.1.0", contract: "checklist-progress@1", builtIn: false, dataInput: "json-payload", instructions: "# Shared", oven: source };

describe("terminal definition adapter correspondence", () => {
  test("uses console-equivalent scoped definition and route/query models", () => {
    const scope = { ovenId: "shared", repoKey: "repo/a" } as const;
    expect(ovenDefinitionPath(scope)).toBe(ovenDefinitionUrl("shared", "repo/a"));
    expect(ovenDataPath(scope, { page: 2, pageSize: 25, search: "error" })).toBe("/api/oven-data/shared?page=2&pageSize=25&search=error&repoKey=repo%2Fa");
    const href = repoOvenHref({ repoKey: scope.repoKey, ovenId: scope.ovenId, query: { page: 2, search: "error" } });
    expect(parseRoute({ pathname: href.split("?")[0], search: href.includes("?") ? `?${href.split("?")[1]}` : "" })).toMatchObject({ repoKey: "repo/a", ovenId: "shared", page: "2" });
    expect(() => ovenDataPath(scope, "repoKey=another")).toThrow("cannot override");
  });

  test("keeps same-id custom definitions and revision invalidation repository-scoped", () => {
    const first = { ovenId: "shared", repoKey: "repo-a" } as const;
    const second = { ovenId: "shared", repoKey: "repo-b" } as const;
    expect(ovenScopeKey(first)).not.toBe(ovenScopeKey(second));
    const firstDefinition = adaptOvenDefinition({ oven: { ...detail, repoKey: "repo-a", ovenRevision: revision, ir } }, first);
    const secondDefinition = adaptOvenDefinition({ oven: { ...detail, repoKey: "repo-b", ovenRevision: `o1-sha256:${"b".repeat(64)}`, ir } }, second);
    expect(firstDefinition.definitionRepoKey).toBe("repo-a");
    expect(secondDefinition.definitionRepoKey).toBe("repo-b");
    expect(definitionChangeInvalidates(first, { kind: "definition-changed", phase: "complete", ovenId: "shared", repoKey: "repo-a" })).toBe(true);
    expect(definitionChangeInvalidates(second, { kind: "definition-changed", phase: "complete", ovenId: "shared", repoKey: "repo-a" })).toBe(false);
    expect(definitionChangeInvalidates({ ...first, definitionRepoKey: null }, { kind: "definition-changed", phase: "complete", ovenId: "shared", repoKey: null })).toBe(true);
    expect(definitionChangeInvalidates({ ...first, definitionRepoKey: null }, { kind: "definition-changed", phase: "complete", ovenId: "shared", repoKey: "repo-a" })).toBe(false);
    expect(() => adaptOvenDefinition({ oven: { ...detail, repoKey: "repo-b", ovenRevision: revision, ir } }, first)).toThrow("outside");
  });

  test("reads the exact console page envelope without a terminal-only wrapper", () => {
    const payload = { fields: [], __burnlistOvenRuntime: { collectionPages: { "/fields": { page: 1, pageSize: 25, pageCount: 3, total: 51 } } } };
    expect(JSON.stringify(ovenPageEnvelope(payload, "/fields"))).toBe(JSON.stringify(runtimeCollectionPage(payload, "/fields")));
    expect(ovenPageEnvelope({ fields: [] }, "/fields")).toBeUndefined();
  });

  test("rejects hostile, malformed, and revisionless package details before they reach terminal chrome", () => {
    const scope = { ovenId: "shared", repoKey: "repo-a" } as const;
    expect(() => adaptOvenDefinition({ oven: { ...detail, repoKey: "repo-a", ovenRevision: "latest", ir } }, scope)).toThrow("revision");
    expect(() => adaptOvenDefinition({ oven: { ...detail, name: "\u001b[2Jspoof", repoKey: "repo-a", ovenRevision: revision, ir } }, scope)).toThrow("package detail");
    expect(() => adaptOvenDefinition({ oven: { ...detail, id: "other", repoKey: "repo-a", ovenRevision: revision, ir: { ...ir, id: "other" } } }, scope)).toThrow("runtime definition");
    expect(() => adaptOvenDefinition({ oven: { ...detail, repoKey: "repo-a", ovenRevision: revision, ir: { ...ir, root: [null] } } }, scope)).toThrow("runtime definition");
  });

  test("admits a live Checklist definition and adapted progress through the terminal runtime", async () => {
    await withServer({ withBurnlist: true }, async ({ baseUrl, planPath }: { baseUrl: string; planPath: string }) => {
      const landing = JSON.parse((await httpGet(baseUrl, "/api/burnlists")).body);
      const repoKey = landing.burnlists[0]!.repoKey;
      const definition = adaptOvenDefinition(JSON.parse((await httpGet(baseUrl, `/api/ovens/checklist?repoKey=${repoKey}`)).body), { ovenId: "checklist", repoKey });
      const progress = JSON.parse((await httpGet(baseUrl, `/api/progress?plan=${encodeURIComponent(planPath)}`)).body);
      const payload = JSON.parse(JSON.stringify(adaptChecklist({ ...progress, history: progress.history ?? [], active: progress.active.map((item: { fields?: Record<string, string> }) => ({ ...item, fields: item.fields ?? {} })), completed: progress.completed.map((item: { detail?: string }) => ({ ...item, detail: item.detail ?? "" })) })));
      const result = admitTerminalOven(definition.ir, { status: "ready", payload }, { viewport: { width: 80, height: 24 } }, [], TERMINAL_IMPLEMENTED_CAPABILITIES);
      expect(result.status, JSON.stringify(result.diagnostics)).toBe("ready");
    });
  });
});
