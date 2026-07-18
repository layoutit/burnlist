import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DiffCard } from "./DiffCard";

test("DiffCard preserves a complete card with file content", () => {
  const card = {
    toolUseId: "tool-123", revId: "rev-456", ts: "2026-07-18T10:20:30.000Z", status: "captured",
    files: [{ path: "src/app.ts", kind: "modified", diff: "@@ -1 +1 @@\n-old\n+new" }],
  };
  const timestamp = new Date(card.ts).toLocaleString();
  const markup = renderToStaticMarkup(createElement(DiffCard, { card }));

  assert.equal(markup, `<div data-slot="card" class="ui-card streaming-diff-card"><div data-slot="card-header" class="ui-card-header streaming-diff-card-header"><div><div data-slot="card-title" class="ui-card-title">tool-123</div><div data-slot="card-description" class="ui-card-description"><time dateTime="${card.ts}">${timestamp}</time> · rev-456</div></div><span data-slot="badge" data-variant="default" class="ui-badge ui-badge--default">captured</span></div><div data-slot="card-content" class="ui-card-content streaming-diff-card-content"><section class="streaming-diff-file"><div class="streaming-diff-file-head"><code>src/app.ts</code><span data-slot="badge" data-variant="secondary" class="ui-badge ui-badge--secondary">modified</span></div><pre class="streaming-diff-unified">@@ -1 +1 @@\n-old\n+new</pre></section></div></div>`);
});

test("DiffCard preserves the partial status paragraph", () => {
  const card = { toolUseId: "tool-partial", revId: "rev-partial", ts: "2026-07-18T11:00:00.000Z", status: "partial", partialReason: "Capture stopped early.", files: [] };
  const timestamp = new Date(card.ts).toLocaleString();
  const markup = renderToStaticMarkup(createElement(DiffCard, { card }));

  assert.equal(markup, `<div data-slot="card" class="ui-card streaming-diff-card"><div data-slot="card-header" class="ui-card-header streaming-diff-card-header"><div><div data-slot="card-title" class="ui-card-title">tool-partial</div><div data-slot="card-description" class="ui-card-description"><time dateTime="${card.ts}">${timestamp}</time> · rev-partial</div></div><span data-slot="badge" data-variant="destructive" class="ui-badge ui-badge--destructive">partial</span></div><div data-slot="card-content" class="ui-card-content streaming-diff-card-content"><p class="streaming-diff-partial">Capture stopped early.</p><p class="streaming-diff-file-meta">No file content was captured.</p></div></div>`);
});

test("DiffCard reports when no file content was captured", () => {
  const card = { toolUseId: "tool-empty", revId: "rev-empty", ts: "2026-07-18T12:00:00.000Z", status: "captured", files: [] };
  const markup = renderToStaticMarkup(createElement(DiffCard, { card }));

  assert.match(markup, /No file content was captured\./u);
  assert.match(markup, /data-variant="default"[^>]*>captured/u);
  assert.match(markup, /tool-empty/u);
  assert.match(markup, /rev-empty/u);
  assert.match(markup, new RegExp(new Date(card.ts).toLocaleString().replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
});
