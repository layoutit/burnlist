import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MultiMonitorThreadHeader } from "./MultiMonitor";
import { MultiMonitorComposer } from "./MultiMonitorComposer";

const identity = {
  logicalRepoKey: "aaaaaaaaaaaa",
  worktreeKey: "bbbbbbbbbbbb",
  session: "019f9426-6dde-7293-a57a-163f81e195cb",
};

test("Multi Monitor thread header exposes stable identity and actions", () => {
  const html = renderToStaticMarkup(createElement(MultiMonitorThreadHeader, {
    identity,
    onRemove() {},
    state: "Live",
    title: "Build a multi-column Codex task surface",
  }));

  assert.match(html, /Build a multi-column Codex task surface/u);
  assert.match(html, /Live/u);
  assert.match(html, /Thread …81e195cb/u);
  assert.match(html, /Open thread 019f9426-6dde-7293-a57a-163f81e195cb in Agent Monitor/u);
  assert.match(html, /Remove thread 019f9426-6dde-7293-a57a-163f81e195cb/u);
});

test("Multi Monitor composer exposes acknowledged Codex delivery", () => {
  const html = renderToStaticMarkup(createElement(MultiMonitorComposer, {
    canSend: true,
    identity,
    writeToken: "fixture-token",
  }));
  assert.match(html, /aria-label="Message Codex task 019f9426-6dde-7293-a57a-163f81e195cb"/u);
  assert.match(html, /<textarea[^>]+aria-label="Message for Codex"/u);
  assert.match(html, /<button[^>]+aria-label="Send message"[^>]+disabled=""/u);
  assert.match(html, /Send to Codex/u);
  assert.doesNotMatch(html, /Copy draft|Copy to Codex|Queued/u);
});

test("Multi Monitor composer disables delivery without shared Codex ownership", () => {
  const html = renderToStaticMarkup(createElement(MultiMonitorComposer, {
    identity,
    writeToken: "fixture-token",
  }));
  assert.match(html, /Restart Codex to enable sending/u);
  assert.match(html, /<button[^>]+aria-label="Send message"[^>]+disabled=""/u);
});
