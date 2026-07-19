import type { ReactNode } from "react";
import { count } from "../../../../ovens/differential-testing/renderer/differential-testing-render.js";
import { templateHtml } from "../../../../ovens/differential-testing/renderer/differential-testing-template.js";

type FieldsProps = {
  total: unknown;
  toolbar: ReactNode;
  fields: ReactNode;
  pagination: ReactNode;
};

const inlineStyles = [...templateHtml().matchAll(/<style>([\s\S]*?)<\/style>/gu)].map((match) => match[1]);

export function DifferentialTestingFields({ total, toolbar, fields, pagination }: FieldsProps) {
  return <main id="driving-parity-page" className="driving-parity-page">
    <div className="driving-parity-toolbar meta-row plan-meta-row">
      <h2 id="driving-parity-summary" className="driving-parity-summary">Fields List<span className="field-list-count">({count(total)})</span></h2>
      {toolbar}
    </div>
    <section className="driving-parity-inline-renderer" id="driving-parity-inline-renderer">
      <style>{inlineStyles[0]}</style>
      <style>{inlineStyles[1]}</style>
      <main>
        <div className="legend">
          <div className="filters">
            <label className="filter-control">
              <select id="sort-mode" aria-label="sort cards" defaultValue="improved">
                <option value="default">Default</option>
                <option value="improved">Changed</option>
                <option value="target">Target</option>
                <option value="failing">Failing</option>
                <option value="frames">Frames</option>
                <option value="group">Group</option>
                <option value="name">Name</option>
                <option value="type">Type</option>
              </select>
            </label>
            <label className="filter-control">
              <select id="field-filter" aria-label="field filter">
                <option value="all">All</option>
                <option value="tested">Tested</option>
                <option value="failing">Failing</option>
                <option value="missing">Uncovered</option>
                <option value="nulls">Nulls</option>
                <option value="inactive">Inactive</option>
                <option value="materialized">Materialized</option>
              </select>
            </label>
            <label className="filter-control"><input type="search" id="field-search" aria-label="search fields" placeholder="Search fields" /></label>
            <label className="filter-control"><select id="group-filter" aria-label="signal group filter"><option value="all">All groups</option></select></label>
            <label className="filter-control">
              <select id="page-size" aria-label="rows per page" defaultValue="25">
                <option value="25">25</option><option value="50">50</option><option value="100">100</option><option value="200">200</option>
              </select>
            </label>
            <div className="pagination" id="pagination" hidden>
              <button type="button" id="page-prev" aria-label="previous page">Prev</button>
              <span className="pagination-status" id="page-status">0-0 / 0</span>
              <button type="button" id="page-next" aria-label="next page">Next</button>
            </div>
            <div className="accordion-actions">
              <button type="button" id="collapse-groups">Collapse all</button>
              <button type="button" id="expand-groups">Expand all</button>
            </div>
          </div>
        </div>
        <section className="coverage" id="coverage" />
        <div className="rows" id="rows"><div className="rows-view" id="hybrid-rows">{fields}</div></div>
      </main>
    </section>
    {pagination}
  </main>;
}
