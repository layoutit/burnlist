import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { registerOvenHandler } from "../../../src/ovens/oven-registry.mjs";
import { readTextFileWithLimit, safeStat } from "../../../src/server/fs-safe.mjs";
import { assertPerformanceTracingData } from "./performance-tracing-contract.mjs";

export const performanceTracingHandler = Object.freeze({
  id: "performance-tracing",

  serveData({ bindingPath, maxOvenDataBytes }) {
    if (!safeStat(bindingPath)?.isFile()) {
      throw Object.assign(new Error("configured Performance Tracing data is missing"), { status: 404 });
    }
    const payload = JSON.parse(readTextFileWithLimit(
      bindingPath,
      maxOvenDataBytes,
      "Performance Tracing Oven data",
    ));
    assertPerformanceTracingProvenanceCurrent(payload, bindingPath, maxOvenDataBytes);
    assertPerformanceTracingData(payload);
    return { ovenId: "performance-tracing", path: bindingPath, payload, validated: true };
  },
});

export function assertPerformanceTracingProvenanceCurrent(payload, bindingPath, maxBytes = 512 * 1024 * 1024) {
  const files = payload?.provenance?.files;
  if (!files || typeof files !== "object" || !Object.keys(files).length) {
    throw staleError("Performance Tracing report has no source provenance to validate.");
  }
  const paths = Object.keys(files);
  for (const path of paths) {
    if (!path || isAbsolute(path) || path.split(/[\\/]/u).includes("..")) {
      throw staleError("Performance Tracing provenance contains an unsafe project path: " + path);
    }
  }
  const projectRoot = findProjectRoot(bindingPath, paths);
  if (!projectRoot) throw staleError("Performance Tracing report is stale: its project inputs cannot be found beside the bound report.");
  const changed = [];
  for (const path of paths) {
    const absolute = resolve(projectRoot, path);
    const stat = safeStat(absolute);
    const expected = files[path];
    if (!stat?.isFile()) {
      changed.push(path + " (missing)");
      continue;
    }
    if (stat.size > maxBytes) throw staleError("Performance Tracing provenance input exceeds the read limit: " + path);
    const digest = createHash("sha256").update(readFileSync(absolute)).digest("hex");
    if (stat.size !== Number(expected?.bytes) || digest !== expected?.sha256) changed.push(path);
  }
  if (changed.length) {
    throw staleError("Performance Tracing report is stale; rerun the configured trace command. Changed inputs: " + changed.join(", "));
  }
  return payload;
}

function findProjectRoot(bindingPath, paths) {
  let candidate = dirname(resolve(bindingPath));
  while (true) {
    if (paths.every((path) => {
      const absolute = resolve(candidate, path);
      const inside = relative(candidate, absolute);
      return inside && !inside.startsWith("..") && !isAbsolute(inside) && safeStat(absolute)?.isFile();
    })) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) return null;
    candidate = parent;
  }
}

function staleError(message) {
  return Object.assign(new Error(message), { status: 409 });
}

registerOvenHandler("performance-tracing", performanceTracingHandler);
