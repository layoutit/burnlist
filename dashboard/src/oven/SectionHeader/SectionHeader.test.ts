import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { SectionHeader } from "./SectionHeader";

test("SectionHeader keeps count and child markup stable", async () => {
    assert.equal(
      renderToStaticMarkup(createElement(SectionHeader, { title: "Events", count: 3 })),
      `<h2>Events <span class="field-list-count">(3)</span></h2>`,
    );
    assert.equal(
      renderToStaticMarkup(createElement(SectionHeader, { title: "Fields List", count: 12 })),
      `<h2>Fields List <span class="field-list-count">(12)</span></h2>`,
    );
    assert.equal(
      renderToStaticMarkup(createElement(SectionHeader, {
        title: "Events", count: 3, children: createElement("span", { className: "custom-count" }, "(custom)"),
      })),
      `<h2>Events <span class="custom-count">(custom)</span></h2>`,
    );
    assert.equal(
      renderToStaticMarkup(createElement(SectionHeader, { title: "Events", count: 3, className: "events-heading" })),
      `<h2 class="events-heading">Events <span class="field-list-count">(3)</span></h2>`,
    );

    function ReferenceSectionHeader({ title, count }) {
      return createElement("h2", null, `${title} `, createElement("span", { className: "field-list-count" }, "(", count, ")"));
    }

    const sectionHeaderOutput = renderToString(createElement(SectionHeader, { title: "Events", count: 3 }));
    const referenceOutput = renderToString(createElement(ReferenceSectionHeader, { title: "Events", count: 3 }));
    assert.equal(sectionHeaderOutput, referenceOutput);
    assert.match(sectionHeaderOutput, /^<h2>Events <span class="field-list-count">/u);
});
