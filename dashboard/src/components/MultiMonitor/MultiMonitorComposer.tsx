import { useEffect, useState } from "react";
import { ArrowUp, Mic, Plus, Settings2 } from "lucide-react";

import type { AgentMonitorIdentity } from "@lib";
import {
  MultiMonitorRequestCard,
  type MultiMonitorPendingRequest,
} from "./MultiMonitorRequestCard";
import "./codex-composer.css";

type DeliveryState = "idle" | "sending" | "sent" | "error";
type StoredDraft = { message: string; requestId: string };

function draftKey(identity: AgentMonitorIdentity) {
  return `burnlist:multi-monitor:draft:${identity.worktreeKey}:${identity.session}`;
}

function readDraft(identity: AgentMonitorIdentity): StoredDraft {
  if (typeof window === "undefined") return { message: "", requestId: "" };
  try {
    const value = JSON.parse(window.localStorage.getItem(draftKey(identity)) ?? "null");
    return typeof value?.message === "string" && typeof value?.requestId === "string"
      ? value
      : { message: "", requestId: "" };
  } catch {
    return { message: "", requestId: "" };
  }
}

function requestId() {
  return window.crypto.randomUUID();
}

function storeDraft(identity: AgentMonitorIdentity, draft: StoredDraft) {
  try {
    if (draft.message) window.localStorage.setItem(draftKey(identity), JSON.stringify(draft));
    else window.localStorage.removeItem(draftKey(identity));
  } catch {
    // A blocked or full storage area must never break the composer.
  }
}

function clearMatchingDraft(identity: AgentMonitorIdentity, sentRequestId: string) {
  try {
    const stored = readDraft(identity);
    if (stored.requestId === sentRequestId) window.localStorage.removeItem(draftKey(identity));
  } catch {
    // The acknowledged delivery is still valid when browser storage is unavailable.
  }
}

export function MultiMonitorComposer({
  canSend = false,
  canSteerExternal = false,
  identity,
  turnOpen = false,
  writeToken,
}: {
  canSend?: boolean;
  canSteerExternal?: boolean;
  identity: AgentMonitorIdentity;
  turnOpen?: boolean;
  writeToken: string;
}) {
  const [draft, setDraft] = useState<StoredDraft>(() => readDraft(identity));
  const [delivery, setDelivery] = useState<DeliveryState>("idle");
  const [feedback, setFeedback] = useState("");
  const [pendingRequest, setPendingRequest] = useState<MultiMonitorPendingRequest | null>(null);
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestError, setRequestError] = useState("");
  const sendable = Boolean(draft.message.trim()) && Boolean(writeToken)
    && canSend && delivery !== "sending";

  useEffect(() => {
    if (!canSend || !writeToken) {
      setPendingRequest(null);
      setRequestError("");
      return undefined;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      const query = new URLSearchParams(identity);
      try {
        const response = await fetch(`/api/multi-monitor/requests?${query}`, {
          cache: "no-store",
          headers: {
            accept: "application/json",
            "x-burnlist-token": writeToken,
          },
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(payload?.requests)) {
          throw new Error(payload?.error ?? "Could not read pending Codex requests.");
        }
        const request = payload.requests.find((value: MultiMonitorPendingRequest) =>
          value?.threadId === identity.session && typeof value?.requestId === "string") ?? null;
        setPendingRequest(request);
        setRequestError("");
      } catch (cause) {
        if (!controller.signal.aborted) {
          setRequestError(cause instanceof Error ? cause.message : "Codex request updates failed.");
        }
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(load, 1_000);
      }
    };
    void load();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [
    canSend,
    identity.logicalRepoKey,
    identity.session,
    identity.worktreeKey,
    writeToken,
  ]);

  const updateDraft = (message: string) => {
    const next = { message, requestId: message ? requestId() : "" };
    setDraft(next);
    setDelivery("idle");
    setFeedback("");
    storeDraft(identity, next);
  };

  const send = async () => {
    if (!sendable) return;
    const current = { ...draft, requestId: draft.requestId || requestId() };
    setDraft(current);
    storeDraft(identity, current);
    setDelivery("sending");
    setFeedback("Sending…");
    try {
      const response = await fetch("/api/multi-monitor/messages", {
        method: "POST",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          "x-burnlist-token": writeToken,
        },
        body: JSON.stringify({
          identity,
          message: current.message,
          requestId: current.requestId,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.receipt?.status !== "accepted"
        || typeof payload.receipt.turnId !== "string"
        || payload.receipt.requestId !== current.requestId
        || payload.receipt.threadId !== identity.session) {
        throw new Error(payload?.error ?? "Codex did not acknowledge the message.");
      }
      clearMatchingDraft(identity, current.requestId);
      setDraft({ message: "", requestId: "" });
      setDelivery("sent");
      setFeedback(payload.receipt.delivery === "steered" ? "Steered" : "Sent");
    } catch (cause) {
      setDelivery("error");
      setFeedback(cause instanceof Error ? cause.message : "Message delivery failed.");
    }
  };

  const resolveRequest = async (action: string, answers?: Record<string, string[]>) => {
    if (!pendingRequest || requestBusy) return;
    setRequestBusy(true);
    setRequestError("");
    try {
      const response = await fetch("/api/multi-monitor/requests", {
        method: "POST",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          "x-burnlist-token": writeToken,
        },
        body: JSON.stringify({
          identity,
          requestId: pendingRequest.requestId,
          action,
          ...(answers ? { answers } : {}),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.receipt?.status !== "resolved"
          || payload.receipt.requestId !== pendingRequest.requestId
          || payload.receipt.threadId !== identity.session) {
        throw new Error(payload?.error ?? "Codex did not accept the decision.");
      }
      setPendingRequest(null);
    } catch (cause) {
      setRequestError(cause instanceof Error ? cause.message : "Codex request handling failed.");
    } finally {
      setRequestBusy(false);
    }
  };

  const status = feedback || (
    !canSend
      ? "Restart Codex to enable sending"
      : turnOpen && !canSteerExternal
        ? "Shared control required"
      : turnOpen ? "Send or steer in Codex" : "Send to Codex"
  );

  return <div
    aria-label={`Message Codex task ${identity.session}`}
    className="codex-composer"
    role="group"
  >
    {pendingRequest && <MultiMonitorRequestCard
      busy={requestBusy}
      key={pendingRequest.requestId}
      onResolve={(action, answers) => void resolveRequest(action, answers)}
      request={pendingRequest}
    />}
    {requestError && <p className="codex-request-error" role="alert">{requestError}</p>}
    <textarea
      aria-label="Message for Codex"
      className="codex-composer-textarea"
      disabled={delivery === "sending"}
      maxLength={12_000}
      onChange={(event) => updateDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
        event.preventDefault();
        void send();
      }}
      placeholder="Send a message to Codex"
      rows={2}
      value={draft.message}
    />
    <div className="codex-composer-footer">
      <span aria-hidden="true" className="codex-composer-control"><Plus /></span>
      <span className="codex-composer-custom"><Settings2 aria-hidden="true" /> Custom</span>
      <span className="codex-composer-spacer" />
      <span
        aria-live="polite"
        className="codex-composer-model"
        data-state={delivery}
        title={status}
      >
        {status}
      </span>
      <Mic aria-hidden="true" className="codex-composer-mic" />
      <button
        aria-label="Send message"
        className="codex-composer-submit"
        disabled={!sendable}
        onClick={() => void send()}
        title={writeToken ? status : "Messaging is connecting"}
        type="button"
      >
        <ArrowUp aria-hidden="true" />
      </button>
    </div>
  </div>;
}
