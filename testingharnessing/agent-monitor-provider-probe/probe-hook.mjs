#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const provider = process.argv[2] ?? "unknown";
const configuredEvent = process.argv[3] ?? "unknown";
const chunks = [];
let bytes = 0;

for await (const chunk of process.stdin) {
  bytes += chunk.length;
  if (bytes > 256 * 1024) break;
  chunks.push(Buffer.from(chunk));
}

let payload = null;
try {
  payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
} catch {}

const probeValue = process.env.BURNLIST_PROBE_TOKEN ?? "";
const nativeEnvironment = Object.fromEntries([
  "GROK_HOOK_EVENT",
  "GROK_SESSION_ID",
  "GROK_WORKSPACE_ROOT",
  "CLAUDE_PROJECT_DIR",
].flatMap((key) => process.env[key] ? [[key, process.env[key]]] : []));
const event = {
  schema: "burnlist-provider-hook-probe@1",
  capturedAt: new Date().toISOString(),
  provider,
  configuredEvent,
  cwd: process.cwd(),
  parentPid: process.ppid,
  probeEnvironmentPresent: Boolean(probeValue),
  probeEnvironmentDigest: probeValue
    ? createHash("sha256").update(probeValue).digest("hex")
    : null,
  nativeEnvironment,
  payload,
};
const directory = resolve(root, "results", "events", provider);
mkdirSync(directory, { recursive: true });
const finalPath = resolve(directory, `${Date.now()}-${randomUUID()}.json`);
const temporaryPath = `${finalPath}.tmp`;
writeFileSync(temporaryPath, `${JSON.stringify(event, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
renameSync(temporaryPath, finalPath);

process.stdout.write("{}\n");
