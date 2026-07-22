import assert from "node:assert/strict";
import test from "node:test";
import { createSseTransport } from "./transports";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  listeners = new Map<string, () => void>();
  closed = false;
  removed?: [string, () => void];
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onerror?: () => void;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: () => void) { this.listeners.set(type, listener); }
  removeEventListener(type: string, listener: () => void) {
    this.removed = [type, listener];
    this.listeners.delete(type);
  }
  close() { this.closed = true; }
  dispatch(type: string) { this.listeners.get(type)?.(); }
  dispatchMessage(data: string) { this.onmessage?.({ data }); }
}

test("Streaming Diff SSE forwards content and closes cleanly", () => {
  const calls: unknown[] = [];
  const stop = createSseTransport({
    makeUrl: () => "/stream",
    EventSourceImpl: FakeEventSource,
  }).start({
    onReset: () => calls.push("reset"),
    onOpen: () => calls.push("open"),
    onMessage: (raw: string) => calls.push(["message", raw]),
    onError: () => calls.push("error"),
  });
  const stream = FakeEventSource.instances.at(-1)!;

  stream.onopen!();
  stream.dispatch("reset");
  stream.dispatchMessage('{"id":"card-1"}');
  stream.onerror!();
  stop();

  assert.equal(stream.url, "/stream");
  assert.deepEqual(calls, ["open", "reset", ["message", '{"id":"card-1"}'], "error"]);
  assert.equal(stream.removed?.[0], "reset");
  assert.equal(typeof stream.removed?.[1], "function");
  assert.equal(stream.closed, true);
});
