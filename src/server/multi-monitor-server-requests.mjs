import { randomBytes } from "node:crypto";

const DEFAULT_MAX_PENDING = 32;
const DEFAULT_TTL_MS = 10 * 60_000;
const MAX_TEXT = 2_000;

function protocolError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status, definite: true });
}

function bounded(value, fallback = "") {
  return typeof value === "string" ? value.slice(0, MAX_TEXT) : fallback;
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? bounded(url.href) : "";
  } catch {
    return "";
  }
}

function requestKind(method) {
  return {
    "item/commandExecution/requestApproval": "command",
    "item/fileChange/requestApproval": "files",
    "item/permissions/requestApproval": "permissions",
    "item/tool/requestUserInput": "input",
    "mcpServer/elicitation/request": "elicitation",
  }[method] ?? null;
}

function publicQuestions(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3).flatMap((question) => {
    if (typeof question?.id !== "string" || typeof question?.question !== "string") return [];
    const options = Array.isArray(question.options)
      ? question.options.slice(0, 3).flatMap((option) =>
        typeof option?.label === "string"
          ? [{ label: bounded(option.label), description: bounded(option.description) }]
          : [])
      : [];
    return [{
      id: question.id.slice(0, 80),
      header: bounded(question.header),
      question: bounded(question.question),
      options,
      secret: question.isSecret === true,
    }];
  });
}

function publicRequest(message, requestId, createdAt) {
  const params = message.params;
  const kind = requestKind(message.method);
  if (!kind || !params || typeof params !== "object"
      || typeof params.threadId !== "string" || !params.threadId) return null;
  const detail = kind === "command"
    ? bounded(params.command, "Command approval requested.")
    : kind === "files"
      ? bounded(params.reason, "File change approval requested.")
      : kind === "permissions"
        ? bounded(params.reason, "Additional permissions requested.")
        : kind === "elicitation"
          ? bounded(params.message, "External input requested.")
          : "";
  return {
    requestId,
    kind,
    threadId: params.threadId,
    turnId: bounded(params.turnId),
    itemId: bounded(params.itemId),
    reason: bounded(params.reason),
    detail,
    cwd: bounded(params.cwd),
    serverName: bounded(params.serverName),
    url: kind === "elicitation" && params.mode === "url" ? safeUrl(params.url) : "",
    questions: kind === "input" ? publicQuestions(params.questions) : [],
    createdAt: new Date(createdAt).toISOString(),
  };
}

function inputAnswers(params, raw) {
  const provided = raw && typeof raw === "object" ? raw : {};
  const answers = {};
  for (const question of Array.isArray(params.questions) ? params.questions : []) {
    if (typeof question?.id !== "string") continue;
    const value = provided[question.id];
    if (!Array.isArray(value) || value.some((answer) => typeof answer !== "string")) {
      throw protocolError("INVALID_ANSWERS", "Answer every Codex question before continuing.");
    }
    answers[question.id] = { answers: value.map((answer) => answer.slice(0, MAX_TEXT)) };
  }
  return { answers };
}

function responseFor(entry, action, answers) {
  if (entry.kind === "command" || entry.kind === "files") {
    if (!["accept", "decline", "cancel"].includes(action)) {
      throw protocolError("INVALID_DECISION", "Choose approve, decline, or cancel.");
    }
    return { decision: action };
  }
  if (entry.kind === "permissions") {
    if (!["accept", "decline"].includes(action)) {
      throw protocolError("INVALID_DECISION", "Choose approve or decline.");
    }
    return action === "accept"
      ? { permissions: entry.params.permissions ?? {}, scope: "turn" }
      : { permissions: {} };
  }
  if (entry.kind === "elicitation") {
    if (!["decline", "cancel"].includes(action)) {
      throw protocolError("INVALID_DECISION", "This elicitation can only be declined or cancelled here.");
    }
    return { action, content: null };
  }
  if (entry.kind === "input") {
    if (action !== "submit") {
      throw protocolError("INVALID_DECISION", "Submit answers to continue this task.");
    }
    return inputAnswers(entry.params, answers);
  }
  throw protocolError("UNSUPPORTED_REQUEST", "This Codex request is not supported.", 409);
}

function safeResponse(entry) {
  if (entry.kind === "command" || entry.kind === "files") return { decision: "decline" };
  if (entry.kind === "permissions") return { permissions: {} };
  if (entry.kind === "elicitation") return { action: "decline", content: null };
  return inputAnswers(entry.params, Object.fromEntries(
    (entry.params.questions ?? []).flatMap((question) =>
      typeof question?.id === "string" ? [[question.id, []]] : []),
  ));
}

function allowedTarget(target) {
  return target?.provider === "codex" && target.topLevel === true && target.threadSource === "user";
}

export function createMultiMonitorServerRequestBroker({
  controller,
  resolveTarget,
  maxPending = DEFAULT_MAX_PENDING,
  now = Date.now,
  random = () => randomBytes(16).toString("hex"),
  requestTtlMs = DEFAULT_TTL_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const pending = new Map();

  function settle(entry, response) {
    controller.respondServerRequest(entry.rpcId, response);
    clearTimer(entry.timer);
    pending.delete(entry.request.requestId);
  }

  function receive(message) {
    let requestId = "";
    for (let attempt = 0; attempt < 4 && !requestId; attempt += 1) {
      const candidate = random();
      if (typeof candidate === "string" && candidate && !pending.has(candidate)) requestId = candidate;
    }
    if (!requestId) return false;
    const request = publicRequest(message, requestId, now());
    if (!request) return false;
    if (pending.size >= maxPending) {
      const transient = { kind: request.kind, params: message.params, rpcId: message.id };
      controller.respondServerRequest(message.id, safeResponse(transient));
      return true;
    }
    const entry = {
      kind: request.kind,
      params: message.params,
      request,
      rpcId: message.id,
      timer: null,
    };
    entry.timer = setTimer(() => {
      if (pending.get(requestId) !== entry) return;
      try { settle(entry, safeResponse(entry)); } catch { pending.delete(requestId); }
    }, requestTtlMs);
    entry.timer?.unref?.();
    pending.set(requestId, entry);
    return true;
  }

  const stopRequests = controller.onServerRequest?.(receive) ?? (() => {});
  const stopNotifications = controller.onNotification?.((message) => {
    if (message?.method !== "serverRequest/resolved") return;
    for (const entry of pending.values()) {
      if (entry.rpcId === message.params?.requestId
          && entry.request.threadId === message.params?.threadId) {
        clearTimer(entry.timer);
        pending.delete(entry.request.requestId);
      }
    }
  }) ?? (() => {});

  return Object.freeze({
    async list(identity) {
      const target = await resolveTarget(identity);
      if (!allowedTarget(target)) {
        throw protocolError("DIRECT_INPUT_DENIED", "Only top-level user-owned Codex tasks expose requests.", 403);
      }
      return [...pending.values()]
        .filter((entry) => entry.request.threadId === target.threadId)
        .map((entry) => entry.request);
    },
    async respond({ identity, requestId, action, answers }) {
      const target = await resolveTarget(identity);
      if (!allowedTarget(target)) {
        throw protocolError("DIRECT_INPUT_DENIED", "Only top-level user-owned Codex tasks accept decisions.", 403);
      }
      const entry = pending.get(requestId);
      if (!entry || entry.request.threadId !== target.threadId) {
        throw protocolError("REQUEST_UNAVAILABLE", "This Codex request is no longer pending.", 404);
      }
      const response = responseFor(entry, action, answers);
      settle(entry, response);
      return {
        requestId,
        threadId: target.threadId,
        status: "resolved",
        action,
      };
    },
    count() {
      return pending.size;
    },
    close() {
      stopRequests();
      stopNotifications();
      for (const entry of [...pending.values()]) {
        try { settle(entry, safeResponse(entry)); } catch { clearTimer(entry.timer); }
      }
      pending.clear();
    },
  });
}
