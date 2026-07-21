import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { DomainTabs } from "./DomainTabs";

function FrozenDomainTabs({ tabs, activeId, onSelect }) {
  return createElement(
    "nav",
    { "aria-label": "Visual parity domains", className: "visual-parity-domains" },
    tabs.map((tab) => {
      const current = tab.id === activeId;
      return createElement(
        "button",
        { "aria-pressed": current, className: current ? "is-active" : "", key: tab.id, onClick: () => onSelect(tab.id), type: "button" },
        createElement("span", null, tab.label),
        createElement("small", null, tab.qualification, " · ", tab.failed ? `${tab.failed} fail` : "pass"),
      );
    }),
  );
}

test("DomainTabs matches active and inactive domain buttons", () => {
  const props = {
    tabs: [
      { id: "target", label: "Target", qualification: "target", failed: 0 },
      { id: "context", label: "Context", qualification: "context", failed: 2 },
    ],
    activeId: "target",
    onSelect: () => {},
  };
  assert.equal(renderToString(createElement(DomainTabs, props)), renderToString(createElement(FrozenDomainTabs, props)));
});
