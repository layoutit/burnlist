import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_STDERR_CHARS = 4_096;
const MACOS_BUNDLED_CODEX = "/Applications/ChatGPT.app/Contents/Resources/codex";

export class CodexAppServerError extends Error {
  constructor(message, {
    code = "CODEX_APP_SERVER",
    data,
    definite = false,
    diagnostic = "",
  } = {}) {
    super(message);
    this.name = "CodexAppServerError";
    this.code = code;
    this.data = data;
    this.definite = definite;
    this.diagnostic = diagnostic;
  }
}

export function resolveCodexAppServerLaunch({
  env = process.env,
  fileExists = existsSync,
  home = os.homedir(),
  platform = process.platform,
  socket = null,
} = {}) {
  const configured = env.BURNLIST_CODEX_BIN?.trim();
  const command = configured
    || (platform === "darwin" && fileExists(MACOS_BUNDLED_CODEX) ? MACOS_BUNDLED_CODEX : "codex");
  const defaultSocket = join(home, ".codex", "burnlist-app-server", "app-server.sock");
  const sharedSocket = socket?.trim()
    || env.BURNLIST_CODEX_APP_SERVER_SOCKET?.trim()
    || (fileExists(defaultSocket) ? defaultSocket : null);
  return {
    command,
    args: sharedSocket
      ? ["app-server", "proxy", "--sock", sharedSocket]
      : ["app-server"],
    mode: sharedSocket ? "shared" : "isolated",
    socket: sharedSocket,
  };
}

export function createCodexAppServerClient({
  launch = resolveCodexAppServerLaunch(),
  spawnProcess = spawn,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  let child = null;
  let lines = null;
  let initialized = null;
  let nextId = 0;
  let stderr = "";
  const pending = new Map();
  const notifications = new Set();
  const serverRequests = new Set();

  function failure(message, options = {}) {
    return new CodexAppServerError(message, {
      ...options,
      diagnostic: [options.diagnostic, stderr.trim()]
        .filter(Boolean)
        .join("\n")
        .slice(-MAX_STDERR_CHARS),
    });
  }

  function rejectPending(error) {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  }

  function stopState(active, error, kill = false) {
    if (child !== active) return;
    rejectPending(error);
    lines?.close();
    lines = null;
    child = null;
    initialized = null;
    if (kill && active.exitCode === null) active.kill();
  }

  function defaultServerRequest(message) {
    if (message.method === "item/commandExecution/requestApproval"
        || message.method === "item/fileChange/requestApproval") {
      return { decision: "decline" };
    }
    if (message.method === "item/permissions/requestApproval") {
      return { permissions: {} };
    }
    if (message.method === "mcpServer/elicitation/request") {
      return { action: "decline", content: null };
    }
    if (message.method === "item/tool/requestUserInput") {
      const questions = Array.isArray(message.params?.questions) ? message.params.questions : [];
      return {
        answers: Object.fromEntries(questions.flatMap((question) =>
          typeof question?.id === "string" ? [[question.id, { answers: [] }]] : [])),
      };
    }
    return null;
  }

  function onMessage(active, line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      stopState(active, failure("Codex App Server returned invalid JSON"), true);
      return;
    }
    if (Object.hasOwn(message, "id") && !Object.hasOwn(message, "method")) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) {
        request.reject(new CodexAppServerError(
          "Codex App Server rejected the request.",
          {
            code: "CODEX_RPC_REJECTED",
            data: message.error.data,
            definite: true,
            diagnostic: String(message.error.message || ""),
          },
        ));
      } else {
        request.resolve(message.result);
      }
      return;
    }
    if (Object.hasOwn(message, "id") && Object.hasOwn(message, "method")) {
      let claimed = false;
      for (const listener of serverRequests) {
        try {
          if (listener(message) === true) claimed = true;
        } catch { /* A broken observer cannot strand an App Server request. */ }
      }
      if (!claimed) {
        const result = defaultServerRequest(message);
        write(result === null
          ? {
            id: message.id,
            error: { code: -32601, message: "This client cannot answer the server request." },
          }
          : { id: message.id, result });
      }
      return;
    }
    if (!Object.hasOwn(message, "id")) {
      for (const notify of notifications) {
        try { notify(message); } catch { /* Observer failures cannot break the transport. */ }
      }
    }
  }

  function write(message) {
    const active = child;
    if (!active?.stdin?.writable) throw failure("Codex App Server is not writable");
    active.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
      if (error) stopState(active, failure("Codex App Server transport failed", {
        code: "CODEX_CONNECTION",
      }), true);
    });
  }

  function rawRequest(method, params) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(failure(`Codex App Server timed out during ${method}`, { code: "CODEX_TIMEOUT" }));
      }, timeoutMs);
      pending.set(id, { reject, resolve, timer });
      try {
        write({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  }

  function start() {
    if (initialized) return initialized;
    stderr = "";
    child = spawnProcess(launch.command, launch.args, {
      env: process.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const active = child;
    lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => onMessage(active, line));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-MAX_STDERR_CHARS);
    });
    child.stdin.once("error", (error) => {
      stopState(active, failure("Codex App Server transport failed", {
        code: "CODEX_CONNECTION",
        diagnostic: error.message,
      }), true);
    });
    child.stdout.once("error", (error) => {
      stopState(active, failure("Codex App Server output failed", {
        code: "CODEX_CONNECTION",
        diagnostic: error.message,
      }), true);
    });
    child.once("error", (error) => {
      stopState(active, failure("Could not start Codex App Server", {
        diagnostic: error.message,
      }));
    });
    child.once("exit", (code, signal) => {
      stopState(active, failure("Codex App Server exited unexpectedly", {
        code: "CODEX_CONNECTION",
        diagnostic: signal ? `signal ${signal}` : `code ${code}`,
      }));
    });
    initialized = rawRequest("initialize", {
      clientInfo: { name: "burnlist", title: "Burnlist Multi Monitor", version: "0.0.2" },
    }).then((result) => {
      write({ method: "initialized", params: {} });
      return result;
    }).catch((error) => {
      stopState(active, error, true);
      throw error;
    });
    return initialized;
  }

  return Object.freeze({
    mode: launch.mode,
    socket: launch.socket,
    async request(method, params = {}) {
      await start();
      return rawRequest(method, params);
    },
    onNotification(listener) {
      notifications.add(listener);
      return () => notifications.delete(listener);
    },
    onServerRequest(listener) {
      serverRequests.add(listener);
      return () => serverRequests.delete(listener);
    },
    respondServerRequest(id, result) {
      write({ id, result });
    },
    close() {
      const active = child;
      if (!active) return;
      stopState(active, failure("Codex App Server connection closed"), true);
    },
  });
}
