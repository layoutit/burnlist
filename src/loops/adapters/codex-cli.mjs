import { spawn as nodeSpawn } from "node:child_process";
import { TextDecoder } from "node:util";
import { isAbsolute } from "node:path";
import { requestedCodexIdentity, validateAgentProfile, validateCodexProbe } from "../agents/profile.mjs";

const MAX_OUTPUT_BYTES = 1048576;
const MAX_JSONL_LINE_BYTES = 65536;
const DIRECT_GUARANTEES = Object.freeze({ freshSession: "enforced", filesystemWriteDeny: "supervised", foregroundHandle: "supervised", cancellation: "supervised", lifecycle: "unsupported" });

function fail(message, code = "ELOOP_CODEX_ADAPTER") { throw Object.assign(new Error(`Codex adapter: ${message}`), { code }); }
function text(value, label, maximum = 262144) {
  if (typeof value !== "string" || !value || Buffer.byteLength(value) > maximum || value.includes("\0")) fail(`invalid ${label}`);
  return value;
}
function invocation(profile, cwd, prompt) {
  const requested = requestedCodexIdentity(profile);
  if (typeof cwd !== "string" || !isAbsolute(cwd) || /[\0\r\n]/u.test(cwd)) fail("invalid cwd");
  return Object.freeze({
    command: requested.binary,
    args: ["exec", "--json", "--ephemeral", "-m", requested.model, "-c", `model_reasoning_effort=${requested.effort}`, "-s", requested.sandbox, "-C", cwd, "--skip-git-repo-check", "--", text(prompt, "prompt")],
    requested,
  });
}
function safeToken(value) { return Number.isSafeInteger(value) && value >= 0; }
function usageFrom(events) {
  const event = [...events].reverse().find((item) => item.type === "turn.completed" && item.usage && typeof item.usage === "object" && !Array.isArray(item.usage));
  if (!event) return null;
  const usage = event.usage; const cached = usage.cached_input_tokens ?? 0;
  if (![usage.input_tokens, usage.output_tokens, cached].every(safeToken) || usage.input_tokens > Number.MAX_SAFE_INTEGER - usage.output_tokens) return null;
  return Object.freeze({ inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, cachedInputTokens: cached, totalTokens: usage.input_tokens + usage.output_tokens });
}
function providerReported(events) {
  const event = events.find((item) => item.type === "thread.started" && typeof item.thread_id === "string");
  if (!event || !event.thread_id || Buffer.byteLength(event.thread_id) > 512 || /[\0\r\n]/u.test(event.thread_id)) return null;
  const optional = (value) => typeof value === "string" && value && Buffer.byteLength(value) <= 512 && !/[\0\r\n]/u.test(value) ? value : null;
  return Object.freeze({ model: optional(event.model), sessionId: event.thread_id, version: optional(event.version) });
}
function parseJsonl(bytes) {
  if (bytes.length > MAX_OUTPUT_BYTES) fail("JSONL output exceeds limit", "ELOOP_CODEX_OUTPUT_LIMIT");
  let source; try { source = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { fail("JSONL output is not UTF-8", "ELOOP_CODEX_OUTPUT"); }
  const lines = source.split("\n");
  if (lines.at(-1) !== "") fail("JSONL output is not LF terminated", "ELOOP_CODEX_OUTPUT");
  const events = [];
  for (const line of lines.slice(0, -1)) {
    if (!line || Buffer.byteLength(line) > MAX_JSONL_LINE_BYTES) fail("malformed JSONL output", "ELOOP_CODEX_OUTPUT");
    let value; try { value = JSON.parse(line); } catch { fail("malformed JSONL output", "ELOOP_CODEX_OUTPUT"); }
    if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.type !== "string" || !value.type || Buffer.byteLength(value.type) > 128 || /[\0\r\n]/u.test(value.type)) fail("malformed JSONL event", "ELOOP_CODEX_OUTPUT");
    events.push(Object.freeze(value));
  }
  return Object.freeze(events);
}
function isolation(value) {
  // A direct child close is observable.  It is not evidence about descendants,
  // so the default controller must never manufacture an empty-process proof.
  if (value === undefined) return { guarantees: DIRECT_GUARANTEES, terminate: (child, signal) => child.kill(signal), proveEmpty: async () => false, requireEmptyProof: false };
  const labels = ["freshSession", "filesystemWriteDeny", "foregroundHandle", "cancellation", "lifecycle"];
  if (!value || typeof value !== "object" || !value.guarantees || typeof value.terminate !== "function"
    || typeof value.proveEmpty !== "function" || labels.some((key) => !["enforced", "detected-at-boundaries", "supervised", "unsupported"].includes(value.guarantees[key]))) fail("invalid foreground controller");
  return { ...value, requireEmptyProof: value.requireEmptyProof !== false };
}

/** A direct foreground process is fresh per call; reviewer write denial remains supervised. */
export function startCodexInvocation({ profile, cwd, prompt, spawn = nodeSpawn, trustedIsolation }) {
  const current = validateAgentProfile(profile); const launch = invocation(current, cwd, prompt); const controller = isolation(trustedIsolation);
  let child;
  try {
    child = spawn(launch.command, launch.args, { cwd, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) { controller.dispose?.(); throw error; }
  if (!child || !Number.isInteger(child.pid) || child.pid <= 0 || !child.stdout || !child.stderr || typeof child.once !== "function") {
    child?.once?.("error", () => {}); // consume the deferred spawn error after failing closed synchronously
    controller.dispose?.();
    fail("spawn did not return a foreground process handle", "ELOOP_CODEX_HANDLE");
  }
  const stdout = []; let outputBytes = 0; let outputExceeded = false; let cancellationRequested = false; let termSent = false; let killSent = false; let settled = false; let finalizing = false; let forceTimer;
  const boundedTerminate = () => {
    if (!termSent) { try { termSent = controller.terminate(child, "SIGTERM") === true; } catch { termSent = false; } }
    if (!forceTimer) forceTimer = setTimeout(() => { if (settled) return; try { killSent = controller.terminate(child, "SIGKILL") === true; } catch { killSent = false; } }, 100);
  };
  const capture = (target) => (chunk) => {
    const bytes = Buffer.from(chunk); outputBytes += bytes.length;
    if (outputBytes > MAX_OUTPUT_BYTES) { outputExceeded = true; boundedTerminate(); return; }
    if (target) target.push(bytes);
  };
  child.stdout.on("data", capture(stdout)); child.stderr.on("data", capture(null));
  const completion = new Promise((resolve, reject) => {
    const finalize = async ({ processError = null, exitCode = null, signal = null }) => {
      if (settled || finalizing) return; finalizing = true; clearTimeout(forceTimer);
      let empty = false; try { empty = await controller.proveEmpty({ pid: child.pid, exitCode, signal, processError }) === true; } catch { empty = false; }
      finally { try { controller.dispose?.(); } catch { empty = false; } }
      if (!empty && (controller.requireEmptyProof || cancellationRequested)) {
        settled = true;
        resolve(Object.freeze({
          requested: launch.requested, providerReported: null, technicallyProven: Object.freeze({ argv: [launch.command, ...launch.args], pidObserved: true }),
          guarantees: Object.freeze({ ...controller.guarantees }), events: Object.freeze([]), usage: null, usageStatus: "unavailable",
          exitCode: Number.isInteger(exitCode) ? exitCode : null, signal: signal ?? null, cancellationRequested,
          termination: Object.freeze({ termSent, killSent, emptyProven: false, descendants: controller.guarantees.lifecycle }),
          quarantineRequired: true, outcome: "quarantined",
        })); return;
      }
      try {
        if (processError) throw processError;
        if (outputExceeded) fail("JSONL output exceeds limit", "ELOOP_CODEX_OUTPUT_LIMIT");
        const events = parseJsonl(Buffer.concat(stdout)); const provider = providerReported(events); const usage = usageFrom(events);
        settled = true;
        resolve(Object.freeze({
          requested: launch.requested, providerReported: provider, technicallyProven: Object.freeze({ argv: [launch.command, ...launch.args], pidObserved: true }),
          guarantees: Object.freeze({ ...controller.guarantees }), events, usage, usageStatus: usage ? "reported" : "unavailable",
          exitCode: Number.isInteger(exitCode) ? exitCode : null, signal: signal ?? null, cancellationRequested,
          termination: Object.freeze({ termSent, killSent, emptyProven: empty, descendants: controller.guarantees.lifecycle }),
          quarantineRequired: false,
          outcome: cancellationRequested ? "cancelled" : exitCode === 0 && !signal ? "completed" : "failed",
        }));
      } catch (error) { settled = true; reject(error); }
    };
    child.once("error", (error) => { void finalize({ processError: error }); });
    child.once("close", (exitCode, signal) => { void finalize({ exitCode, signal }); });
  });
  return Object.freeze({
    pid: child.pid, requested: launch.requested, completion,
    cancel() {
      if (settled || cancellationRequested) return false; cancellationRequested = true;
      boundedTerminate();
      return termSent;
    },
  });
}

/** Child JSONL may report identity/usage, but only the trusted host controller supplies guarantees. */
export async function probeCodexCli({ profile, cwd, spawn = nodeSpawn, trustedIsolation }) {
  const handle = startCodexInvocation({ profile, cwd, spawn, trustedIsolation, prompt: "Burnlist adapter probe. Report provider identity only." });
  const result = await handle.completion;
  if (result.outcome !== "completed" || !result.providerReported) fail(`probe did not provide provider identity (${result.outcome})`, "ELOOP_CODEX_PROBE");
  return validateCodexProbe({
    schema: "burnlist-codex-probe@1", requested: result.requested, providerReported: result.providerReported,
    technicallyProven: result.technicallyProven, guarantees: { ...result.guarantees, usage: result.usageStatus },
  });
}
