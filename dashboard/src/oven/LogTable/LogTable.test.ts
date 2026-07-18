import assert from "node:assert/strict";
import { test } from "node:test";
import { Fragment, createElement } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { LogTable } from "./LogTable";

function FrozenChecklistLog({ rows, emptyState }) {
  return createElement(
    "div",
    { className: "checklist-log-list" },
    createElement(
      "div",
      { className: "checklist-log-table-header" },
      createElement("span", null, "Age"),
      createElement("span", null, "Event"),
      createElement("span", null, "Result"),
      createElement("span", null, "Delta"),
      createElement("span", null, "Done"),
    ),
    rows.map((item) => createElement(
      "article",
      { className: "log-row log-table-row", key: `${item.id}/${item.completedAt}` },
      createElement("span", { className: "log-table-cell age" }, item.age),
      createElement("span", { className: "log-table-cell event" }, item.id),
      createElement("span", { className: "log-table-cell result improved" }, "Done"),
      createElement("span", { className: "log-table-cell delta improved" }, "+1"),
      createElement("span", { className: "log-table-cell done" }, item.percent, "%"),
    )),
    !rows.length && emptyState,
  );
}

function checklistProps(rows, emptyState) {
  return {
    columns: ["Age", "Event", "Result", "Delta", "Done"],
    rows: rows.map((item) => ({
      className: "log-row log-table-row",
      cells: [
        { className: "log-table-cell age", content: item.age },
        { className: "log-table-cell event", content: item.id },
        { className: "log-table-cell result improved", content: "Done" },
        { className: "log-table-cell delta improved", content: "+1" },
        { className: "log-table-cell done", content: createElement(Fragment, null, item.percent, "%") },
      ],
    })),
    emptyState,
  };
}

test("LogTable preserves the populated Checklist snapshot", () => {
  const rows = [
    { id: "BL-2", completedAt: "2026-07-18T11:40:00Z", age: "20m", percent: 100 },
    { id: "BL-1", completedAt: "2026-07-18T11:20:00Z", age: "40m", percent: 50 },
  ];
  const props = checklistProps(rows);
  const componentOutput = renderToString(createElement(LogTable, props));
  const frozenOutput = renderToString(createElement(FrozenChecklistLog, { rows }));
  const expected = "<div class=\"checklist-log-list\"><div class=\"checklist-log-table-header\"><span>Age</span><span>Event</span><span>Result</span><span>Delta</span><span>Done</span></div><article class=\"log-row log-table-row\"><span class=\"log-table-cell age\">20m</span><span class=\"log-table-cell event\">BL-2</span><span class=\"log-table-cell result improved\">Done</span><span class=\"log-table-cell delta improved\">+1</span><span class=\"log-table-cell done\">100%</span></article><article class=\"log-row log-table-row\"><span class=\"log-table-cell age\">40m</span><span class=\"log-table-cell event\">BL-1</span><span class=\"log-table-cell result improved\">Done</span><span class=\"log-table-cell delta improved\">+1</span><span class=\"log-table-cell done\">50%</span></article></div>";

  assert.equal(componentOutput, frozenOutput);
  assert.equal(renderToStaticMarkup(createElement(LogTable, props)), expected);
});

test("LogTable preserves the empty Checklist snapshot", () => {
  const emptyState = createElement("div", { className: "event-ledger-empty" }, "No completed events");
  const rows = [];
  const props = checklistProps(rows, emptyState);
  const componentOutput = renderToString(createElement(LogTable, props));
  const frozenOutput = renderToString(createElement(FrozenChecklistLog, { rows, emptyState }));
  const expected = "<div class=\"checklist-log-list\"><div class=\"checklist-log-table-header\"><span>Age</span><span>Event</span><span>Result</span><span>Delta</span><span>Done</span></div><div class=\"event-ledger-empty\">No completed events</div></div>";

  assert.equal(componentOutput, frozenOutput);
  assert.equal(renderToStaticMarkup(createElement(LogTable, props)), expected);
  assert.match(componentOutput, /<div class="checklist-log-table-header">[\s\S]*<div class="event-ledger-empty">No completed events<\/div>/u);
});

test("LogTable reproduces the Differential Testing log superset snapshot", () => {
  const nestedResult = (indicator, value) => createElement(
    "span",
    { className: "log-delta-content" },
    createElement("span", { className: "log-delta-indicator" }, indicator),
    createElement("span", null, value),
  );
  const props = {
    columns: ["Age", "Frame", "Result", "Delta", "Done"],
    rows: [
      {
        className: "log-row improved no-detail log-table-row",
        cells: [
          { className: "log-table-cell age", content: "2m" },
          { className: "log-table-cell failed improved", content: "5" },
          { className: "log-table-cell result improved", content: nestedResult("▲", "2") },
          { className: "log-table-cell delta improved", content: "20%" },
          { className: "log-table-cell done", content: "50%" },
        ],
      },
      {
        className: "log-row worsened no-detail log-table-row",
        cells: [
          { className: "log-table-cell age", content: "65m" },
          { className: "log-table-cell failed worsened", content: "9" },
          { className: "log-table-cell result worsened", content: nestedResult("▼", "3") },
          { className: "log-table-cell delta worsened", content: "25%" },
          { className: "log-table-cell done", content: "75%" },
        ],
      },
      {
        className: "log-row unchanged no-detail log-table-row",
        cells: [
          { className: "log-table-cell age", content: "90m" },
          { className: "log-table-cell failed unchanged", content: "—" },
          { className: "log-table-cell result unchanged", content: "—" },
          { className: "log-table-cell delta unchanged", content: "—" },
          { className: "log-table-cell done", content: "—" },
        ],
      },
      {
        className: "log-row unchanged no-detail log-table-row",
        cells: [
          { className: "log-table-cell age", content: "120m" },
          { className: "log-table-cell failed unchanged", content: "42" },
          { className: "log-table-cell result unchanged", content: "0" },
          { className: "log-table-cell delta unchanged", content: "0%" },
          { className: "log-table-cell done", content: "50%" },
        ],
      },
    ],
    placeholderCount: 4,
  };
  const expected = "<div class=\"checklist-log-list\"><div class=\"checklist-log-table-header\"><span>Age</span><span>Frame</span><span>Result</span><span>Delta</span><span>Done</span></div><article class=\"log-row improved no-detail log-table-row\"><span class=\"log-table-cell age\">2m</span><span class=\"log-table-cell failed improved\">5</span><span class=\"log-table-cell result improved\"><span class=\"log-delta-content\"><span class=\"log-delta-indicator\">▲</span><span>2</span></span></span><span class=\"log-table-cell delta improved\">20%</span><span class=\"log-table-cell done\">50%</span></article><article class=\"log-row worsened no-detail log-table-row\"><span class=\"log-table-cell age\">65m</span><span class=\"log-table-cell failed worsened\">9</span><span class=\"log-table-cell result worsened\"><span class=\"log-delta-content\"><span class=\"log-delta-indicator\">▼</span><span>3</span></span></span><span class=\"log-table-cell delta worsened\">25%</span><span class=\"log-table-cell done\">75%</span></article><article class=\"log-row unchanged no-detail log-table-row\"><span class=\"log-table-cell age\">90m</span><span class=\"log-table-cell failed unchanged\">—</span><span class=\"log-table-cell result unchanged\">—</span><span class=\"log-table-cell delta unchanged\">—</span><span class=\"log-table-cell done\">—</span></article><article class=\"log-row unchanged no-detail log-table-row\"><span class=\"log-table-cell age\">120m</span><span class=\"log-table-cell failed unchanged\">42</span><span class=\"log-table-cell result unchanged\">0</span><span class=\"log-table-cell delta unchanged\">0%</span><span class=\"log-table-cell done\">50%</span></article><article class=\"log-row no-detail log-table-row log-placeholder-row\" aria-hidden=\"true\"><span class=\"log-table-cell age\">.</span><span class=\"log-table-cell\">.</span><span class=\"log-table-cell\">.</span><span class=\"log-table-cell\">.</span><span class=\"log-table-cell\">.</span></article><article class=\"log-row no-detail log-table-row log-placeholder-row\" aria-hidden=\"true\"><span class=\"log-table-cell age\">.</span><span class=\"log-table-cell\">.</span><span class=\"log-table-cell\">.</span><span class=\"log-table-cell\">.</span><span class=\"log-table-cell\">.</span></article><article class=\"log-row no-detail log-table-row log-placeholder-row\" aria-hidden=\"true\"><span class=\"log-table-cell age\">.</span><span class=\"log-table-cell\">.</span><span class=\"log-table-cell\">.</span><span class=\"log-table-cell\">.</span><span class=\"log-table-cell\">.</span></article><article class=\"log-row no-detail log-table-row log-placeholder-row\" aria-hidden=\"true\"><span class=\"log-table-cell age\">.</span><span class=\"log-table-cell\">.</span><span class=\"log-table-cell\">.</span><span class=\"log-table-cell\">.</span><span class=\"log-table-cell\">.</span></article></div>";

  assert.equal(renderToStaticMarkup(createElement(LogTable, props)), expected);
});
