import assert from "node:assert/strict";
import { connect } from "node:net";
import { httpGet, withServer } from "../src/server/dashboard-routes-fixtures.mjs";

const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const OVEN_ID = "admission-oven";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function exactPayload() {
  const empty = JSON.stringify({ padding: "" });
  const payload = { padding: "x".repeat(MAX_SOURCE_BYTES - Buffer.byteLength(empty)) };
  assert.equal(Buffer.byteLength(JSON.stringify(payload)), MAX_SOURCE_BYTES);
  return payload;
}

function openPausedRequest(url) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const socket = connect({ host: target.hostname, port: Number(target.port) });
    let settled = false;
    socket.once("error", reject);
    socket.once("connect", () => {
      socket.write([
        `GET ${target.pathname}${target.search} HTTP/1.1`,
        `Host: ${target.host}`,
        "Connection: keep-alive",
        "",
        "",
      ].join("\r\n"));
    });
    socket.once("data", (chunk) => {
      settled = true;
      socket.pause();
      resolve({ socket, firstChunkBytes: chunk.length, firstLine: chunk.toString("latin1").split("\r\n")[0] });
    });
    socket.once("close", () => {
      if (!settled) reject(new Error("Slow admission request closed before its first response bytes."));
    });
  });
}

async function fetchAfterRelease(url) {
  const deadline = Date.now() + 2_000;
  let response;
  do {
    response = await fetch(url);
    if (response.status === 200) return response;
    await response.arrayBuffer();
    await delay(25);
  } while (Date.now() < deadline);
  return response;
}

export async function measureOvenResponseAdmission() {
  return withServer({
    ovens: [{ id: OVEN_ID }],
    ovenData: [{ id: OVEN_ID, payload: exactPayload() }],
    serverArgs: ["--max-oven-data-bytes", String(MAX_SOURCE_BYTES)],
  }, async ({ baseUrl }) => {
    const catalog = JSON.parse((await httpGet(baseUrl, "/api/ovens")).body);
    const repoKey = catalog.ovens.find((oven) => oven.id === OVEN_ID)?.repoKey;
    assert.ok(repoKey, "the admission fixture Oven must be discoverable");
    const url = new URL(`/api/oven-data/${OVEN_ID}?repoKey=${repoKey}`, baseUrl).href;
    const slow = await openPausedRequest(url);
    assert.match(slow.firstLine, / 200 /u);

    const rejected = await fetch(url);
    const rejectedBytes = (await rejected.arrayBuffer()).byteLength;
    assert.equal(rejected.status, 503, "a second maximum response must exceed the shared active-byte budget");
    slow.socket.destroy();

    const recovered = await fetchAfterRelease(url);
    assert.equal(recovered.status, 200, "aborting the slow client must release response admission");
    const contentLength = Number(recovered.headers.get("content-length"));
    const recoveredBytes = (await recovered.arrayBuffer()).byteLength;
    assert.equal(recoveredBytes, contentLength);
    assert.ok(contentLength > MAX_SOURCE_BYTES);
    return {
      configuredMaximumSourceBytes: MAX_SOURCE_BYTES,
      maximumResponseBytes: contentLength,
      slowClientFirstChunkBytes: slow.firstChunkBytes,
      concurrentStatus: rejected.status,
      concurrentResponseBytes: rejectedBytes,
      abortedReservationReleased: true,
      recoveredStatus: recovered.status,
      recoveredResponseBytes: recoveredBytes,
    };
  });
}
