import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createStreamingDiffChange, createStreamingDiffPayload } from "./streaming-diff-contract.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(scriptDirectory, "burnlist-dashboard-server.mjs");
const viewerId = "12345678-1234-4123-8123-123456789abc";
const threadId = "abcdef12-3456-4789-8abc-def123456789";
const otherThreadId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

test("Streaming Diff attaches one viewer to one hook-attributed thread over SSE", { timeout: 20_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "burnlist-streaming-diff-server-"));
  const repo = join(root, "fixture-repo");
  const feeds = join(root, "feeds");
  const payloadPath = join(feeds, "threads", threadId, "current.json");
  const otherPayloadPath = join(feeds, "threads", otherThreadId, "current.json");
  let child;
  try {
    await mkdir(repo, { recursive: true });
    await mkdir(dirname(payloadPath), { recursive: true });
    await mkdir(dirname(otherPayloadPath), { recursive: true });
    const firstChange = change({ before: "old\n", after: "new\n", revision: 1, timestamp: "2026-07-14T12:00:00.000Z" });
    await writePayload(payloadPath, 1, [firstChange], { label: "Primary task", lastActiveAt: new Date(Date.now() - 1_000).toISOString() });
    await writePayload(otherPayloadPath, 0, [], { threadId: otherThreadId, label: "Other agent task", lastActiveAt: new Date().toISOString() });
    const port = await availablePort();
    child = spawn(process.execPath, [
      serverPath,
      "--port", String(port),
      "--scan-root", repo,
      "--state-dir", join(root, "state"),
      "--streaming-diff-dir", feeds,
    ], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    const baseUrl = await waitForServer(child);

    assert.equal((await fetch(`${baseUrl}ovens/streaming-diff/view`)).status, 200);
    assert.equal((await fetch(`${baseUrl}api/oven-data/streaming-diff?viewer=${viewerId}`)).status, 404);
    const detached = await fetch(`${baseUrl}api/streaming-diff/events?viewer=${viewerId}`);
    assert.equal(detached.status, 200);
    assert.match(await detached.text(), /event: detached/u);

    const ovens = await (await fetch(`${baseUrl}api/ovens`)).json();
    const headers = { "content-type": "application/json", "x-burnlist-token": ovens.writeToken };
    const catalog = await fetch(`${baseUrl}api/streaming-diff/threads`, { headers });
    assert.equal(catalog.status, 200);
    assert.deepEqual((await catalog.json()).threads.map((thread) => thread.id), [otherThreadId, threadId]);
    assert.equal((await fetch(`${baseUrl}api/streaming-diff/claims`, { method: "POST", headers, body: "{}" })).status, 404);

    const attach = await fetch(`${baseUrl}api/streaming-diff/attachments`, {
      method: "POST",
      headers,
      body: JSON.stringify({ viewerId, threadId }),
    });
    assert.equal(attach.status, 201);

    const stream = await fetch(`${baseUrl}api/streaming-diff/events?viewer=${viewerId}`);
    assert.equal(stream.status, 200);
    assert.match(stream.headers.get("content-type") ?? "", /^text\/event-stream/u);
    const reader = stream.body.getReader();
    assert.match(await readUntil(reader, "event: snapshot"), /change-000001/u);

    const secondChange = change({ before: "new\n", after: "newer\n", revision: 2, timestamp: "2026-07-14T12:01:00.000Z" });
    await writePayload(payloadPath, 2, [secondChange, firstChange]);
    assert.match(await readUntil(reader, "id: 2"), /change-000002/u);
    await reader.cancel();

    const detach = await fetch(`${baseUrl}api/streaming-diff/attachments`, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ viewerId }),
    });
    assert.equal(detach.status, 200);
    assert.equal((await detach.json()).detachment.detached, true);
    const detachedAgain = await fetch(`${baseUrl}api/streaming-diff/events?viewer=${viewerId}`);
    assert.match(await detachedAgain.text(), /event: detached/u);

    const index = await (await fetch(`${baseUrl}api/burnlists`)).json();
    assert.equal(index.burnlists.find((entry) => entry.ovenId === "streaming-diff")?.href, "/ovens/streaming-diff/view");
  } finally {
    await stop(child);
    await rm(root, { recursive: true, force: true });
  }
});

function change({ before, after, revision, timestamp }) {
  return createStreamingDiffChange({
    before,
    after,
    revision,
    sourcePath: "demo.txt",
    threadId,
    turnId: `turn-${revision}`,
    toolName: "functions.exec",
    timestamp,
  });
}

async function writePayload(path, revision, changes, options = {}) {
  const payload = createStreamingDiffPayload({ threadId, turnId: `turn-${revision}`, revision, changes, ...options });
  await writeFile(path, `${JSON.stringify(payload)}\n`);
}

async function readUntil(reader, needle) {
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && !text.includes(needle)) {
    const result = await Promise.race([
      reader.read(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out waiting for ${needle}`)), 5_000)),
    ]);
    if (result.done) break;
    text += decoder.decode(result.value, { stream: true });
  }
  if (!text.includes(needle)) throw new Error(`SSE stream did not contain ${needle}: ${text}`);
  return text;
}

function availablePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : null;
      probe.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

function waitForServer(child) {
  return new Promise((resolveReady, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 8_000);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//u);
      if (!match) return;
      clearTimeout(timer);
      resolveReady(match[0]);
    });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited with ${code}: ${output}`));
    });
  });
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolveStop) => child.once("exit", resolveStop));
}
