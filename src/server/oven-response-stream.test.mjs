import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { streamOvenResponse } from "./oven-response-stream.mjs";

class FakeResponse extends EventEmitter {
  constructor(writeResults = []) {
    super();
    this.chunks = [];
    this.destroyed = false;
    this.ended = false;
    this.writeResults = [...writeResults];
  }

  write(chunk) {
    this.chunks.push(Buffer.from(chunk));
    return this.writeResults.length ? this.writeResults.shift() : true;
  }

  end() {
    this.ended = true;
    this.emit("finish");
  }

  destroy() {
    this.destroyed = true;
    this.emit("close");
  }
}

function fakeTimers() {
  const pending = new Set();
  return {
    pending,
    setTimeout(callback) {
      const token = { callback };
      pending.add(token);
      return token;
    },
    clearTimeout(token) { pending.delete(token); },
  };
}

test("streams bounded chunks across buffer segments and cleans up once", () => {
  const req = new EventEmitter();
  const res = new FakeResponse();
  let cleanups = 0;
  streamOvenResponse(req, res, [Buffer.from("abcdef"), Buffer.from("gh")], {
    chunkBytes: 3,
    onCleanup() { cleanups += 1; },
  });

  assert.equal(Buffer.concat(res.chunks).toString(), "abcdefgh");
  assert.deepEqual(res.chunks.map((chunk) => chunk.length), [3, 3, 2]);
  assert.equal(res.ended, true);
  assert.equal(cleanups, 1);
  res.emit("close");
  req.emit("aborted");
  assert.equal(cleanups, 1);
});

test("backpressure pauses until drain and clears the stall timer", () => {
  const req = new EventEmitter();
  const res = new FakeResponse([false]);
  const timers = fakeTimers();
  let cleanups = 0;
  streamOvenResponse(req, res, [Buffer.from("abcdef")], {
    chunkBytes: 3,
    timeoutMs: 50,
    timers,
    onCleanup() { cleanups += 1; },
  });

  assert.equal(res.ended, false);
  assert.equal(timers.pending.size, 1);
  res.emit("drain");
  assert.equal(Buffer.concat(res.chunks).toString(), "abcdef");
  assert.equal(res.ended, true);
  assert.equal(timers.pending.size, 0);
  assert.equal(cleanups, 1);
});

test("a stalled response times out, destroys the client, and releases once", () => {
  const req = new EventEmitter();
  const res = new FakeResponse([false]);
  const timers = fakeTimers();
  let cleanups = 0;
  streamOvenResponse(req, res, [Buffer.from("blocked")], {
    timers,
    onCleanup() { cleanups += 1; },
  });

  const [{ callback }] = timers.pending;
  callback();
  assert.equal(res.destroyed, true);
  assert.equal(res.ended, false);
  assert.equal(timers.pending.size, 0);
  assert.equal(cleanups, 1);
});

test("an aborted request destroys the response and detaches pending work", () => {
  const req = new EventEmitter();
  const res = new FakeResponse([false]);
  const timers = fakeTimers();
  let cleanups = 0;
  streamOvenResponse(req, res, [Buffer.from("blocked")], {
    timers,
    onCleanup() { cleanups += 1; },
  });

  req.emit("aborted");
  assert.equal(res.destroyed, true);
  assert.equal(timers.pending.size, 0);
  assert.equal(cleanups, 1);
  res.emit("drain");
  assert.equal(res.ended, false);
});

test("rejects unsafe stream configuration before attaching listeners", () => {
  const req = new EventEmitter();
  const res = new FakeResponse();
  assert.throws(() => streamOvenResponse(req, res, [], { chunkBytes: 0 }), /chunkBytes/u);
  assert.throws(() => streamOvenResponse(req, res, [], { timeoutMs: 0 }), /timeoutMs/u);
  assert.throws(() => streamOvenResponse(req, res, ["text"]), /must be Buffers/u);
  assert.equal(req.listenerCount("aborted"), 0);
  assert.equal(res.listenerCount("close"), 0);
});
