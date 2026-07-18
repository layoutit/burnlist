import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { assertDomEquivalent, extractById } from "../test-support/dom-normalize";
import { PaginationBar, type PaginationBarProps } from "./PaginationBar";

const goldenDir = resolve("ovens/differential-testing/renderer/goldens");

function render(props: PaginationBarProps): string {
  return renderToStaticMarkup(createElement(PaginationBar, props));
}

function expectedPagination({
  pageSize,
  pageIndex,
  pageCount,
  start,
  end,
  total,
}: PaginationBarProps): string {
  return `<div id="driving-parity-pagination" class="driving-parity-controls driving-parity-pagination"${total <= pageSize ? " hidden" : ""}>
    <select id="driving-parity-page-size" aria-label="Differential Testing rows per page">
      <option value="25"${pageSize === 25 ? " selected" : ""}>25</option>
      <option value="50"${pageSize === 50 ? " selected" : ""}>50</option>
      <option value="100"${pageSize === 100 ? " selected" : ""}>100</option>
      <option value="200"${pageSize === 200 ? " selected" : ""}>200</option>
    </select>
    <button type="button" id="driving-parity-page-prev" aria-label="Differential Testing previous page"${pageIndex === 0 ? " disabled" : ""}>Prev</button>
    <span class="page-status" id="driving-parity-page-status">${start}-${end} / ${total}</span>
    <button type="button" id="driving-parity-page-next" aria-label="Differential Testing next page"${pageIndex >= pageCount - 1 ? " disabled" : ""}>Next</button>
  </div>`;
}

function assertPagination(props: PaginationBarProps, message: string): void {
  assertDomEquivalent(render(props), expectedPagination(props), message);
}

test("PaginationBar hides when the visible total fits on one page", () => {
  assertPagination({ pageSize: 25, pageIndex: 0, pageCount: 1, start: 1, end: 25, total: 25 }, "hidden pagination differs");
  assertPagination({ pageSize: 25, pageIndex: 0, pageCount: 1, start: 1, end: 2, total: 2 }, "hidden pagination differs");
});

test("PaginationBar enables the bar when more rows are visible", () => {
  assertPagination({ pageSize: 25, pageIndex: 0, pageCount: 2, start: 1, end: 25, total: 26 }, "visible pagination differs");
});

test("PaginationBar disables the previous button only on the first page", () => {
  assertPagination({ pageSize: 25, pageIndex: 0, pageCount: 3, start: 1, end: 25, total: 60 }, "first page differs");
  assertPagination({ pageSize: 25, pageIndex: 1, pageCount: 3, start: 26, end: 50, total: 60 }, "middle page differs");
});

test("PaginationBar disables the next button on the last page", () => {
  assertPagination({ pageSize: 25, pageIndex: 1, pageCount: 2, start: 26, end: 30, total: 30 }, "last page differs");
});

test("PaginationBar keeps both navigation buttons enabled on a middle page", () => {
  assertPagination({ pageSize: 25, pageIndex: 1, pageCount: 3, start: 26, end: 50, total: 60 }, "middle page differs");
});

test("PaginationBar selects each fixed page size option", () => {
  for (const pageSize of [25, 50, 100, 200]) {
    assertPagination({ pageSize, pageIndex: 0, pageCount: 2, start: 1, end: pageSize, total: pageSize + 1 }, `page size ${pageSize} differs`);
  }
});

test("PaginationBar disables next for a one-page count even when total exceeds page size", () => {
  assertPagination({ pageSize: 25, pageIndex: 0, pageCount: 1, start: 1, end: 25, total: 60 }, "single-page edge differs");
});

test("PaginationBar matches the selected DT goldens", () => {
  const states: Array<[string, PaginationBarProps]> = [
    ["dt-main", { pageSize: 25, pageIndex: 0, pageCount: 1, start: 1, end: 2, total: 2 }],
    ["dt-paginated", { pageSize: 25, pageIndex: 0, pageCount: 3, start: 1, end: 25, total: 60 }],
    ["dt-paginated-mid", { pageSize: 25, pageIndex: 1, pageCount: 3, start: 26, end: 50, total: 60 }],
    ["dt-server-paged", { pageSize: 25, pageIndex: 0, pageCount: 1, start: 1, end: 2, total: 2 }],
  ];

  for (const [name, props] of states) {
    const golden = readFileSync(resolve(goldenDir, `${name}.html`), "utf8");
    assertDomEquivalent(render(props), extractById(golden, "driving-parity-pagination"), `${name} pagination differs`);
  }
});
