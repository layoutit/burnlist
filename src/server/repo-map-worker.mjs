import { parentPort, workerData } from "node:worker_threads";
import { buildRepoMap } from "./repo-map.mjs";

try {
  parentPort.postMessage({ ok: true, value: buildRepoMap(workerData) });
} catch (error) {
  parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
}
