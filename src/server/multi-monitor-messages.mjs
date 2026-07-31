import { createMultiMonitorServerRequestBroker } from "./multi-monitor-server-requests.mjs";
import {
  finishMessageReceipt,
  messageDigest,
  MULTI_MONITOR_MESSAGE_CONTRACT,
  prepareMessageReceipt,
  sameMessageRequest,
} from "./multi-monitor-receipts.mjs";

export { MULTI_MONITOR_MESSAGE_CONTRACT };
export const MULTI_MONITOR_MESSAGE_MAX_CHARS = 12_000;
const requestPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const keyPattern = /^[a-f0-9]{12}$/u;
const MAX_IN_FLIGHT = 64;
const MAX_PER_THREAD = 8;

function protocolError(code, message, status = 400, definite = true) {
  return Object.assign(new Error(message), { code, status, definite });
}

function validatedIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(["logicalRepoKey", "session", "worktreeKey"])) {
    throw protocolError("INVALID_IDENTITY", "A complete Codex task identity is required.");
  }
  if (!keyPattern.test(value.logicalRepoKey ?? "") || !keyPattern.test(value.worktreeKey ?? "")
    || typeof value.session !== "string" || value.session.length > 160
    || !value.session || /[\u0000-\u001f\u007f]/u.test(value.session)) {
    throw protocolError("INVALID_IDENTITY", "Codex task identity is invalid.");
  }
  return value;
}

function validatedRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw protocolError("INVALID_REQUEST", "A message request is required.");
  }
  const keys = Object.keys(value).sort();
  const expected = ["identity", "message", "requestId"];
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    throw protocolError("INVALID_REQUEST", "Message request fields are invalid.");
  }
  const identity = validatedIdentity(value.identity);
  if (!requestPattern.test(value.requestId ?? "")) {
    throw protocolError("INVALID_REQUEST_ID", "Message delivery id must be a UUID.");
  }
  if (typeof value.message !== "string" || !value.message.trim()) {
    throw protocolError("EMPTY_MESSAGE", "Write a message before sending.");
  }
  if ([...value.message].length > MULTI_MONITOR_MESSAGE_MAX_CHARS) {
    throw protocolError("MESSAGE_TOO_LARGE", `Messages are limited to ${MULTI_MONITOR_MESSAGE_MAX_CHARS} characters.`);
  }
  return { identity, message: value.message, requestId: value.requestId.toLowerCase() };
}

function validatedResponse(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw protocolError("INVALID_REQUEST", "A Codex request decision is required.");
  }
  const allowed = new Set(["action", "answers", "identity", "requestId"]);
  if (Object.keys(value).some((key) => !allowed.has(key))
      || typeof value.requestId !== "string" || !/^[a-f0-9]{32}$/u.test(value.requestId)
      || typeof value.action !== "string" || value.action.length > 24) {
    throw protocolError("INVALID_REQUEST", "Codex request decision fields are invalid.");
  }
  return {
    identity: validatedIdentity(value.identity),
    requestId: value.requestId,
    action: value.action,
    answers: value.answers,
  };
}

function activeTurn(thread) {
  if (thread?.status?.type !== "active" || !Array.isArray(thread.turns)) return null;
  return [...thread.turns].reverse().find((turn) => turn?.status === "inProgress" && typeof turn.id === "string") ?? null;
}

export function createCodexMessageController({ client }) {
  if (!client?.request) throw new Error("A Codex App Server client is required.");
  const threadChains = new Map();
  const threadPending = new Map();
  let pendingCount = 0;

  async function deliver(target, message, requestId) {
    if (client.mode !== "shared") {
      throw protocolError(
        "SHARED_CONTROL_REQUIRED",
        "Restart Codex with the Burnlist bridge before sending messages.",
        409,
      );
    }
    const read = await client.request("thread/read", {
      threadId: target.threadId,
      includeTurns: true,
    });
    const thread = read?.thread;
    const running = activeTurn(thread);
    if (running) {
      const steered = await client.request("turn/steer", {
        threadId: target.threadId,
        expectedTurnId: running.id,
        clientUserMessageId: requestId,
        input: [{ type: "text", text: message }],
      });
      if (steered?.turnId !== running.id) {
        throw protocolError("INVALID_ACK", "Codex returned an invalid steering acknowledgement.", 502, false);
      }
      return { delivery: "steered", turnId: running.id };
    }
    if (thread?.status?.type === "active") {
      throw protocolError("ACTIVE_TURN_UNKNOWN", "Codex reports an active task without an identifiable turn.", 409);
    }
    if (thread?.status?.type === "systemError") {
      throw protocolError("THREAD_SYSTEM_ERROR", "Codex reports a system error for this task.", 409);
    }
    if (thread?.status?.type === "notLoaded") {
      await client.request("thread/resume", { threadId: target.threadId });
    }
    const started = await client.request("turn/start", {
      threadId: target.threadId,
      clientUserMessageId: requestId,
      input: [{ type: "text", text: message }],
    });
    const turn = started?.turn;
    if (typeof turn?.id !== "string" || turn.status !== "inProgress") {
      throw protocolError("INVALID_ACK", "Codex did not acknowledge a running turn.", 502, false);
    }
    return { delivery: "started", turnId: turn.id };
  }

  function enqueue(threadId, operation) {
    if (pendingCount >= MAX_IN_FLIGHT || (threadPending.get(threadId) ?? 0) >= MAX_PER_THREAD) {
      throw protocolError(
        "DELIVERY_BUSY",
        "Too many Codex messages are already being delivered. Try again shortly.",
        429,
      );
    }
    pendingCount += 1;
    threadPending.set(threadId, (threadPending.get(threadId) ?? 0) + 1);
    const prior = threadChains.get(threadId) ?? Promise.resolve();
    const current = prior.catch(() => {}).then(operation);
    threadChains.set(threadId, current);
    void current.finally(() => {
      if (threadChains.get(threadId) === current) threadChains.delete(threadId);
      pendingCount -= 1;
      const remaining = (threadPending.get(threadId) ?? 1) - 1;
      if (remaining > 0) threadPending.set(threadId, remaining);
      else threadPending.delete(threadId);
    }).catch(() => {});
    return current;
  }

  return Object.freeze({
    mode: client.mode,
    onNotification(listener) {
      return client.onNotification?.(listener) ?? (() => {});
    },
    onServerRequest(listener) {
      return client.onServerRequest?.(listener) ?? (() => {});
    },
    respondServerRequest(id, result) {
      return client.respondServerRequest?.(id, result);
    },
    send(target, message, requestId) {
      return enqueue(target.threadId, () => deliver(target, message, requestId));
    },
    close() {
      client.close?.();
    },
  });
}

export function createMultiMonitorMessageProtocol({ controller, resolveTarget }) {
  if (!controller?.send || typeof resolveTarget !== "function") {
    throw new Error("Multi Monitor messaging requires a controller and target resolver.");
  }
  const inFlight = new Map();
  const serverRequests = createMultiMonitorServerRequestBroker({ controller, resolveTarget });

  return Object.freeze({
    status() {
      return {
        contract: MULTI_MONITOR_MESSAGE_CONTRACT,
        mode: controller.mode,
        canSend: controller.mode === "shared",
        canSteerExternal: controller.mode === "shared",
        pendingRequests: serverRequests.count(),
      };
    },
    async send(raw) {
      const request = validatedRequest(raw);
      if (controller.mode !== "shared") {
        throw protocolError(
          "SHARED_CONTROL_REQUIRED",
          "Restart Codex with the Burnlist bridge before sending messages.",
          409,
        );
      }
      const target = await resolveTarget(request.identity);
      if (target.provider !== "codex" || target.topLevel !== true || target.threadSource !== "user") {
        throw protocolError("DIRECT_INPUT_DENIED", "Only top-level user-owned Codex tasks accept messages.", 403);
      }
      if (target.caughtUp !== true) {
        throw protocolError("FEED_NOT_CURRENT", "The task feed is still catching up. Try again after it is current.", 409);
      }
      const prepared = {
        contract: MULTI_MONITOR_MESSAGE_CONTRACT,
        requestId: request.requestId,
        threadId: target.threadId,
        messageDigest: messageDigest(request.message),
        status: "prepared",
        preparedAt: new Date().toISOString(),
      };
      const existing = inFlight.get(request.requestId);
      if (existing) {
        if (!sameMessageRequest(existing.prepared, prepared)) {
          throw protocolError("REQUEST_ID_REUSED", "This delivery id is already bound to another message.", 409);
        }
        return existing.operation;
      }
      const accepted = prepareMessageReceipt(target.repoRoot, prepared);
      if (accepted) return accepted;
      const operation = controller.send(target, request.message, request.requestId).then((result) => finishMessageReceipt(
        target.repoRoot,
        {
          ...prepared,
          ...result,
          mode: controller.mode,
          status: "accepted",
          acceptedAt: new Date().toISOString(),
        },
      )).catch((error) => {
        if (error?.definite === true) {
          finishMessageReceipt(target.repoRoot, {
            ...prepared,
            status: "rejected",
            rejectedAt: new Date().toISOString(),
            rejectionCode: String(error.code ?? "REJECTED").slice(0, 80),
          });
        }
        throw error;
      });
      inFlight.set(request.requestId, { operation, prepared });
      try {
        return await operation;
      } finally {
        inFlight.delete(request.requestId);
      }
    },
    requests(rawIdentity) {
      if (controller.mode !== "shared") return [];
      return serverRequests.list(validatedIdentity(rawIdentity));
    },
    respondRequest(raw) {
      if (controller.mode !== "shared") {
        throw protocolError("SHARED_CONTROL_REQUIRED", "Shared Codex control is not connected.", 409);
      }
      return serverRequests.respond(validatedResponse(raw));
    },
    close() {
      serverRequests.close();
      controller.close?.();
    },
  });
}
