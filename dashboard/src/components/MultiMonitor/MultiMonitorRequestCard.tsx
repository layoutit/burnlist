import { useState } from "react";

export type MultiMonitorPendingRequest = {
  requestId: string;
  kind: "command" | "files" | "permissions" | "input" | "elicitation";
  threadId: string;
  turnId: string;
  itemId: string;
  reason: string;
  detail: string;
  cwd: string;
  serverName: string;
  url: string;
  questions: Array<{
    id: string;
    header: string;
    question: string;
    options: Array<{ label: string; description: string }>;
    secret: boolean;
  }>;
  createdAt: string;
};

function heading(kind: MultiMonitorPendingRequest["kind"]) {
  if (kind === "input") return "Codex needs your input";
  if (kind === "elicitation") return "External input requested";
  return "Approval required";
}

export function MultiMonitorRequestCard({
  busy,
  onResolve,
  request,
}: {
  busy: boolean;
  onResolve: (action: string, answers?: Record<string, string[]>) => void;
  request: MultiMonitorPendingRequest;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const complete = request.questions.every((question) => Boolean(answers[question.id]?.trim()));
  const submitAnswers = () => onResolve(
    "submit",
    Object.fromEntries(request.questions.map((question) => [
      question.id,
      [answers[question.id].trim()],
    ])),
  );

  return <section aria-label={heading(request.kind)} className="codex-request-card">
    <strong>{heading(request.kind)}</strong>
    {request.detail && <p className="codex-request-detail">{request.detail}</p>}
    {request.reason && request.reason !== request.detail
      ? <p className="codex-request-reason">{request.reason}</p>
      : null}
    {request.cwd && <p className="codex-request-context">{request.cwd}</p>}
    {request.url && <a href={request.url} rel="noreferrer" target="_blank">Open requested page</a>}
    {request.kind === "input" && <div className="codex-request-questions">
      {request.questions.map((question) => <label key={question.id}>
        <span>{question.header || question.question}</span>
        {question.options.length
          ? <select
            disabled={busy}
            onChange={(event) => setAnswers((current) => ({
              ...current,
              [question.id]: event.target.value,
            }))}
            value={answers[question.id] ?? ""}
          >
            <option value="">Choose…</option>
            {question.options.map((option) => <option key={option.label} value={option.label}>
              {option.label}
            </option>)}
          </select>
          : <input
            disabled={busy}
            onChange={(event) => setAnswers((current) => ({
              ...current,
              [question.id]: event.target.value,
            }))}
            type={question.secret ? "password" : "text"}
            value={answers[question.id] ?? ""}
          />}
        {question.header && <small>{question.question}</small>}
      </label>)}
    </div>}
    <div className="codex-request-actions">
      {request.kind === "input"
        ? <button disabled={busy || !complete} onClick={submitAnswers} type="button">Submit</button>
        : request.kind === "elicitation"
          ? <>
            <button disabled={busy} onClick={() => onResolve("decline")} type="button">Decline</button>
            <button disabled={busy} onClick={() => onResolve("cancel")} type="button">Cancel task</button>
          </>
          : <>
            <button disabled={busy} onClick={() => onResolve("decline")} type="button">Decline</button>
            <button disabled={busy} onClick={() => onResolve("accept")} type="button">Approve once</button>
          </>}
    </div>
  </section>;
}
