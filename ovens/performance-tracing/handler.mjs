import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { OVEN_DATA_INPUT, registerOvenHandler } from "../../src/ovens/oven-registry.mjs";
import { safeStat } from "../../src/server/fs-safe.mjs";
import {
  readOvenJsonSnapshot,
  reconcileOvenJsonBindings,
  serveOvenJsonSnapshot,
} from "../../src/server/oven-json-handler.mjs";
import { assertPerformanceTracingData } from "./contract.mjs";

export const performanceTracingHandler = Object.freeze({
  id: "performance-tracing",
  dataInput: OVEN_DATA_INPUT.jsonPayload,
  validateData: validatePerformanceTracingRuntimeData,

  reconcileDataBindings(ctx) {
    reconcileOvenJsonBindings(ctx, "performance-tracing");
  },

  serveData(ctx) {
    reconcileOvenJsonBindings(ctx, "performance-tracing");
    // Provenance files are external freshness dependencies. Deliberately
    // revalidate them on every request instead of caching by report identity.
    const snapshot = readOvenJsonSnapshot(ctx, {
      ovenId: "performance-tracing",
      label: "configured Performance Tracing data",
      cache: false,
      validate(payload) {
        validatePerformanceTracingRuntimeData(payload, {
          bindingPath: ctx.bindingPath,
          maxOvenDataBytes: ctx.maxOvenDataBytes,
        });
      },
    });
    serveOvenJsonSnapshot(ctx, snapshot, {
      ovenId: "performance-tracing", path: ctx.bindingPath, validated: true,
    });
  },
});

export function validatePerformanceTracingRuntimeData(payload, { bindingPath, maxOvenDataBytes } = {}) {
  assertPerformanceTracingProvenanceCurrent(payload, bindingPath, maxOvenDataBytes);
  return assertPerformanceTracingData(payload);
}

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
