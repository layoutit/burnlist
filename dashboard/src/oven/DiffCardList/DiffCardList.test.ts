import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DiffCardList } from "./DiffCardList";

test("DiffCardList preserves the card container and card markup", () => {
  const card = {
    toolUseId: "tool-123", revId: "rev-456", ts: "2026-07-18T10:20:30.000Z", status: "captured",
    files: [],
  };
  const timestamp = new Date(card.ts).toLocaleString();
  const markup = renderToStaticMarkup(createElement(DiffCardList, { cards: [card] }));

  assert.equal(markup, `<div class="streaming-diff-cards"><div data-slot="card" class="ui-card streaming-diff-card"><div data-slot="card-header" class="ui-card-header streaming-diff-card-header"><div><div data-slot="card-title" class="ui-card-title">tool-123</div><div data-slot="card-description" class="ui-card-description"><time dateTime="${card.ts}">${timestamp}</time> · rev-456</div></div><span data-slot="badge" data-variant="default" class="ui-badge ui-badge--default">captured</span></div><div data-slot="card-content" class="ui-card-content streaming-diff-card-content"><p class="streaming-diff-file-meta">No file content was captured.</p></div></div></div>`);
});

test("DiffCardList preserves the empty fallback after the card container", () => {
  const markup = renderToStaticMarkup(createElement(DiffCardList, { cards: [] }));

  assert.equal(markup, "<div class=\"streaming-diff-cards\"></div><p class=\"streaming-diff-message\">Waiting for diff cards.</p>");
});
