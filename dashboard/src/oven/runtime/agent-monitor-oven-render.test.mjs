import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";

import { compileOven } from "../../../../src/ovens/dsl/oven-compile.mjs";
import { buildAgentMonitorSnapshot } from "../../../../ovens/agent-monitor/engine/agent-monitor-projection.mjs";
import { projectCodexRecord } from "../../../../ovens/agent-monitor/engine/agent-monitor-event.mjs";

const runtimePath = new URL("./OvenRuntime.tsx", import.meta.url).pathname;
const sourceDir = new URL("../../", import.meta.url).pathname;
const libPath = new URL("../../lib", import.meta.url).pathname;
const ovenPath = new URL("..", import.meta.url).pathname;
const NOW = "2026-07-26T12:00:00.000Z";

function payload() {
  const identity = {
    logicalRepoKey: "111111111111",
    worktreeKey: "222222222222",
    session: "session-a",
  };
  const events = Array.from({ length: 60 }, (_, index) => {
    const line = 60 - index;
    const record = {
      timestamp: NOW,
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        arguments: JSON.stringify({ cmd: `node fixture-${line}.mjs` }),
      },
    };
    return projectCodexRecord(record, line, identity.session, JSON.stringify(record), NOW);
  });
  return buildAgentMonitorSnapshot({
    activityAt: NOW,
    events,
    file: "session.jsonl",
    generatedAt: NOW,
    identity,
    line: 60,
    newEvents: events,
    nowMs: Date.parse(NOW),
  });
}

function categorizedPayload() {
  const result = payload();
  const variants = [
    ["command", "complete"],
    ["diff", "complete"],
    ["tool", "complete"],
    ["message", "observed"],
    ["lifecycle", "complete"],
    ["tool", "failed"],
  ];
  result.raw.completed = result.raw.completed.map((item, index) => ({
    ...item,
    category: variants[index % variants.length][0],
    result: variants[index % variants.length][1],
  }));
  return result;
}

test("Agent Monitor renders a bounded first page with visible health and controls", async () => {
  const outputDir = await mkdtemp(join(process.cwd(), ".agent-monitor-render-test-"));
  try {
    const runtimeOutput = join(outputDir, "OvenRuntime.mjs");
    await build({
      entryPoints: [runtimePath],
      bundle: true,
      format: "esm",
      outfile: runtimeOutput,
      platform: "node",
      alias: { "@": sourceDir, "@lib": libPath, "@oven": ovenPath },
      jsx: "automatic",
      packages: "external",
      target: "node18",
    });
    const { OvenRuntime } = await import(`${pathToFileURL(runtimeOutput).href}?test=${Date.now()}`);
    const source = await readFile("ovens/agent-monitor/agent-monitor.oven", "utf8");
    const compiled = compileOven(source, { file: "ovens/agent-monitor/agent-monitor.oven" });
    assert.equal(compiled.ok, true, compiled.ok ? "" : JSON.stringify(compiled.diagnostics));
    if (!compiled.ok) return;

    const markup = renderToStaticMarkup(createElement(OvenRuntime, {
      ir: compiled.ir,
      payload: payload(),
    }));
    assert.match(markup, /Live · 60 events/u);
    assert.match(markup, /Clear · no rule fired/u);
    assert.match(markup, /Work rhythm over time/u);
    assert.match(markup, /60 retained events/u);
    assert.match(markup, /Agent work rhythm over time with user messages and failures/u);
    assert.match(markup, /agent-monitor-activity-mark/u);
    assert.match(markup, /Recent monitorable events <span class="field-list-count">\(60\)<\/span>/u);
    assert.match(markup, /role="group" aria-label="Filter Agent Monitor events"/u);
    assert.match(markup, /aria-pressed="true">ALL<\/button>/u);
    assert.match(markup, /class="agent-monitor-filter-empty">No recent events in this filter\.<\/div>/u);
    assert.equal((markup.match(/id="agent-monitor-event-filter"/gu) ?? []).length, 1);
    assert.equal((markup.match(/data-slot="alert"/gu) ?? []).length, 26);
    assert.equal((markup.match(/class="agent-monitor-event"/gu) ?? []).length, 25);
    assert.equal((markup.match(/>Run<\/strong>/gu) ?? []).length, 25);
    assert.equal((markup.match(/fixture-\d+\.mjs/gu) ?? []).length, 25);
    assert.equal((markup.match(/data-slot="alert-title"/gu) ?? []).length, 26);
    assert.equal((markup.match(/data-slot="alert-description"/gu) ?? []).length, 26);
    assert.doesNotMatch(markup, /event-card-summary|agent-monitor-event-kind|agent-monitor-event-status-dot/u);
    assert.match(markup, /aria-label="Agent Monitor events next page"/u);
    assert.match(markup, />1-25 \/ 60<\/span>/u);
    assert.doesNotMatch(markup, /class="shell|checklist-progress-chart/u);

    const filteredMarkup = renderToStaticMarkup(createElement(OvenRuntime, {
      ir: compiled.ir,
      payload: categorizedPayload(),
      controls: { "agent-monitor-event-filter": "diff" },
    }));
    assert.match(filteredMarkup, /aria-pressed="true">DIFF<\/button>/u);
    assert.equal((filteredMarkup.match(/class="agent-monitor-event"/gu) ?? []).length, 10);
    assert.equal((filteredMarkup.match(/class="agent-monitor-event" data-category="diff"/gu) ?? []).length, 10);
    assert.match(filteredMarkup, /Recent monitorable events <span class="field-list-count">\(10\)<\/span>/u);
    assert.match(filteredMarkup, />1-10 \/ 10<\/span>/u);

    const emptyMarkup = renderToStaticMarkup(createElement(OvenRuntime, {
      ir: compiled.ir,
      payload: payload(),
      controls: { "agent-monitor-event-filter": "failed" },
    }));
    assert.match(emptyMarkup, /Recent monitorable events <span class="field-list-count">\(0\)<\/span>/u);
    assert.equal((emptyMarkup.match(/class="agent-monitor-event"/gu) ?? []).length, 0);
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
});
