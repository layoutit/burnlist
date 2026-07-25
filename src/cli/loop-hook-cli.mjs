import { resolveUmbrella } from "./umbrella.mjs";
import { publishNativeLoopObservation } from "../loops/events/hook-observation.mjs";

const MAX_BYTES = 256 * 1024;
const READ_TIMEOUT_MS = 750;

function readStdinCapped(input = process.stdin) {
  return new Promise((resolveRead) => {
    const chunks = []; let bytes = 0; let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      input.off("data", onData); input.off("end", onEnd); input.off("error", onError);
      resolveRead(value);
    };
    const onData = (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BYTES) { try { input.destroy(); } catch {} finish(null); }
      else chunks.push(Buffer.from(chunk));
    };
    const onEnd = () => finish(Buffer.concat(chunks, bytes));
    const onError = () => finish(null);
    const timer = setTimeout(() => finish(null), READ_TIMEOUT_MS);
    input.on("data", onData); input.once("end", onEnd); input.once("error", onError); input.resume();
  });
}

export function parseLoopHookPayload(bytes) {
  if (!bytes || bytes.length < 2 || bytes.length > MAX_BYTES) return null;
  try {
    const value = JSON.parse(bytes);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

/** Advisory hook entry: every failure becomes a quiet no-op. */
export async function runLoopObservationHook({ provider, input = process.stdin } = {}) {
  try {
    if (!["codex", "claude"].includes(provider)) return null;
    const payload = parseLoopHookPayload(await readStdinCapped(input));
    if (!payload) return null;
    const repoRoot = resolveUmbrella(payload.cwd ?? process.cwd());
    return publishNativeLoopObservation({ repoRoot, provider, payload });
  } catch { return null; }
}
