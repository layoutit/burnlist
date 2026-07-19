import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { differentialRefreshStatusLabel as oracleLabel } from "../differential-testing-render/differential-testing-renderer.js";
import { assertDomEquivalent, extractById } from "../test-support/dom-normalize";
import { differentialRefreshStatusLabel, RefreshStatusChip, type RefreshStatusChipProps } from "./RefreshStatusChip";

const goldenDir = resolve("dashboard/src/oven/differential-testing-render/goldens");

function render(props: RefreshStatusChipProps): string {
  return renderToStaticMarkup(createElement(RefreshStatusChip, props));
}

test("differentialRefreshStatusLabel matches the vanilla oracle", () => {
  const clientStatuses: Array<string | null | undefined> = [null, "loading", "queued", "running", "failed", "complete", undefined];
  const refreshes: Array<RefreshStatusChipProps["refresh"]> = [
    { status: undefined },
    { status: "queued" },
    { status: "running" },
    { status: "failed" },
    { status: "complete" },
    undefined,
  ];

  for (const clientStatus of clientStatuses) {
    for (const refresh of refreshes) {
      assert.equal(
        differentialRefreshStatusLabel(refresh, clientStatus),
        oracleLabel(refresh, clientStatus),
        `label differs for client=${String(clientStatus)}, refresh=${String(refresh?.status)}`,
      );
    }
  }
});

test("RefreshStatusChip matches the hand-written DOM contract", () => {
  const cases: Array<[string, RefreshStatusChipProps, string]> = [
    [
      "complete empty label",
      { refresh: { status: "complete" } },
      '<span id="differential-refresh-status" class="differential-refresh-status complete" title="" hidden></span>',
    ],
    [
      "missing refresh",
      {},
      '<span id="differential-refresh-status" class="differential-refresh-status " title="" hidden></span>',
    ],
    [
      "queued",
      { refresh: { status: "queued" } },
      '<span id="differential-refresh-status" class="differential-refresh-status queued" title="Queued">Queued</span>',
    ],
    [
      "running",
      { refresh: { status: "running" } },
      '<span id="differential-refresh-status" class="differential-refresh-status running" title="Updating">Updating</span>',
    ],
    [
      "failed with error",
      { refresh: { status: "failed", error: "Request failed" } },
      '<span id="differential-refresh-status" class="differential-refresh-status failed" title="Request failed">Update failed</span>',
    ],
    [
      "failed without error",
      { refresh: { status: "failed" } },
      '<span id="differential-refresh-status" class="differential-refresh-status failed" title="Update failed">Update failed</span>',
    ],
    [
      "client status override",
      { refresh: { status: "complete" }, clientStatus: "loading" },
      '<span id="differential-refresh-status" class="differential-refresh-status loading" title="Loading">Loading</span>',
    ],
    [
      "complete client status preserves queued refresh label",
      { refresh: { status: "queued", error: "stale" }, clientStatus: "complete" },
      '<span id="differential-refresh-status" class="differential-refresh-status complete" title="Queued">Queued</span>',
    ],
    [
      "running status ignores stale error",
      { refresh: { status: "running", error: "stale" } },
      '<span id="differential-refresh-status" class="differential-refresh-status running" title="Updating">Updating</span>',
    ],
    [
      "failed status with empty error falls back to label",
      { refresh: { status: "failed", error: "" } },
      '<span id="differential-refresh-status" class="differential-refresh-status failed" title="Update failed">Update failed</span>',
    ],
    [
      "escaped failed error",
      { refresh: { status: "failed", error: `Bad <&'" error` } },
      '<span id="differential-refresh-status" class="differential-refresh-status failed" title="Bad &lt;&amp;\'&quot; error">Update failed</span>',
    ],
  ];

  for (const [name, props, expected] of cases) assertDomEquivalent(render(props), expected, name);
});

test("RefreshStatusChip matches the DT refresh-status goldens", () => {
  const cases: Array<[string, RefreshStatusChipProps]> = [
    ["dt-main", { refresh: { status: "complete" } }],
    ["pt-main", {}],
  ];

  for (const [name, props] of cases) {
    const golden = readFileSync(resolve(goldenDir, `${name}.html`), "utf8");
    assertDomEquivalent(render(props), extractById(golden, "differential-refresh-status"), `${name} refresh status differs`);
  }
});
