import {
  type FormEvent,
  useEffect,
  useState,
} from "react";
import {
  ArrowLeft,
  Play,
  Save,
} from "lucide-react";
import { Button } from "@layout";
import { effectiveOvensForRepo } from "@lib/oven-identity.mjs";
import type { OvenSummary, RepoSummary } from "@lib/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@layout";

const fieldClass = "form-control";

function slug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function PageHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="page-heading">
      <Button asChild size="sm" variant="ghost">
        <a href="/">
          <ArrowLeft />
          Burnlists
        </a>
      </Button>
      <div>
        <h1 className="page-title">{title}</h1>
        <p className="page-description">
          {description}
        </p>
      </div>
    </div>
  );
}

export function NewOvenPage() {
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idEdited, setIdEdited] = useState(false);
  const [instructions, setInstructions] = useState(
    "## Purpose\n\nDescribe what this Oven measures or completes."
      + "\n\n## State Contract\n\nDescribe the canonical Markdown or report state."
      + "\n\n## Run Inputs\n\nDescribe the inputs a Burn needs."
      + "\n\n## Evidence\n\nDescribe what proves the outcome.",
  );
  const [writeToken, setWriteToken] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/ovens")
      .then((response) => response.json())
      .then((payload) => setWriteToken(payload.writeToken || ""))
      .catch(() => setError("Could not initialize Oven saving."));
  }, []);

  const saveOven = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setStatus("Saving Oven...");
    try {
      const response = await fetch("/api/ovens", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-burnlist-token": writeToken,
        },
        body: JSON.stringify({ id, name, instructions }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Could not save Oven.");
      }
      setStatus("Saved " + payload.oven.name + " at " + payload.oven.path);
    } catch (cause) {
      setStatus("");
      setError(cause instanceof Error ? cause.message : "Could not save Oven.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="oven-form" onSubmit={saveOven}>
      <PageHeader
        description="A declarative Burn recipe defined by Markdown instructions."
        title="New Oven"
      />
      <Card className="oven-form-card">
        <CardHeader>
          <CardTitle className="card-title-compact">Oven instructions</CardTitle>
          <CardDescription>
            Define the outcome, canonical state, run inputs, and evidence rules in Markdown.
          </CardDescription>
        </CardHeader>
        <CardContent className="oven-form-content">
          <label className="form-field">
            Oven name
            <input
              className={fieldClass}
              maxLength={80}
              onChange={(event) => {
                setName(event.target.value);
                if (!idEdited) setId(slug(event.target.value));
              }}
              placeholder="Release Readiness"
              required
              value={name}
            />
          </label>
          <label className="form-field">
            Oven id
            <input
              className={fieldClass}
              maxLength={48}
              onChange={(event) => {
                setIdEdited(true);
                setId(slug(event.target.value));
              }}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              placeholder="release-readiness"
              required
              value={id}
            />
          </label>
          <label className="form-field">
            Markdown instructions
            <textarea
              className={`${fieldClass} form-control-tall form-control-mono`}
              maxLength={65536}
              onChange={(event) => setInstructions(event.target.value)}
              required
              value={instructions}
            />
          </label>
        </CardContent>
      </Card>
      {(error || status) && (
        <p
          aria-live="polite"
          className={`form-notice ${error ? "is-error" : "is-success"}`}
        >
          {error || status}
        </p>
      )}
      <div className="form-actions">
        <Button asChild variant="outline">
          <a href="/">Cancel</a>
        </Button>
        <Button disabled={saving} type="submit">
          <Save />
          {saving ? "Saving…" : "Save Oven"}
        </Button>
      </div>
    </form>
  );
}

export function RunBurnPage() {
  const [ovens, setOvens] = useState<OvenSummary[]>([]);
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [writeToken, setWriteToken] = useState("");
  const [ovenId, setOvenId] = useState("checklist");
  const [repoRoot, setRepoRoot] = useState("");
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const targetRepoKey = repos.find((repo) => repo.root === repoRoot)?.repoKey ?? null;
  const effectiveOvens = effectiveOvensForRepo(ovens, targetRepoKey) as OvenSummary[];

  useEffect(() => {
    Promise.all([
      fetch("/api/ovens").then((response) => response.json()),
      fetch("/api/repos").then((response) => response.json()),
    ])
      .then(([ovensPayload, reposPayload]) => {
        setOvens(ovensPayload.ovens || []);
        setRepos(reposPayload.repos || []);
        setWriteToken(ovensPayload.writeToken || "");
        const firstRepo = reposPayload.repos?.[0];
        setRepoRoot(firstRepo?.root || "");
        const available = effectiveOvensForRepo(ovensPayload.ovens || [], firstRepo?.repoKey);
        setOvenId(available.some((oven) => oven.id === "checklist") ? "checklist" : available[0]?.id || "");
      })
      .catch(() => setError("Could not load Ovens or repositories."));
  }, []);

  const createRun = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setStatus("Creating run manifest...");
    try {
      const oven = effectiveOvens.find((candidate) => candidate.id === ovenId);
      if (!oven) throw new Error("Select an Oven.");
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-burnlist-token": writeToken,
        },
        body: JSON.stringify({
          ovenId: oven.id,
          repoRoot,
          title,
          objective,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Could not create run.");
      }
      setStatus(
        "Created "
          + payload.run.id
          + " at "
          + payload.run.path
          + ". Codex execution has not started.",
      );
    } catch (cause) {
      setStatus("");
      setError(cause instanceof Error ? cause.message : "Could not create run.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="oven-form" onSubmit={createRun}>
      <PageHeader
        description="Choose an Oven and create an immutable local Run snapshot. The app never executes Oven instructions."
        title="Run Burn"
      />
      <Card className="run-form-card">
        <CardHeader>
          <CardTitle className="card-title-compact">Run request</CardTitle>
          <CardDescription>
            The selected Oven instructions are snapshotted into ignored local state.
          </CardDescription>
        </CardHeader>
        <CardContent className="run-form-content">
          <label className="form-field">
            Oven
            <select
              className={fieldClass}
              onChange={(event) => setOvenId(event.target.value)}
              required
              value={ovenId}
            >
              {effectiveOvens.map((oven) => (
                <option key={oven.id} value={oven.id}>
                  {oven.name} · {oven.origin}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            Repository
            <select
              className={fieldClass}
              onChange={(event) => {
                const root = event.target.value;
                const key = repos.find((repo) => repo.root === root)?.repoKey ?? null;
                const available = effectiveOvensForRepo(ovens, key);
                setRepoRoot(root);
                if (!available.some((oven) => oven.id === ovenId)) setOvenId(available[0]?.id || "");
              }}
              required
              value={repoRoot}
            >
              {repos.map((repo) => (
                <option key={repo.root} value={repo.root}>
                  {repo.name}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            Run title
            <input
              className={fieldClass}
              maxLength={120}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Release readiness pass"
              required
              value={title}
            />
          </label>
          <label className="form-field">
            Objective
            <textarea
              className={`${fieldClass} form-control-tall`}
              maxLength={12000}
              onChange={(event) => setObjective(event.target.value)}
              placeholder="Describe the outcome and any Oven-required inputs. For Differential Testing, include the trusted reference, scenario/replay/profile, alignment and exact contract, and retained session location."
              required
              value={objective}
            />
          </label>
          <p className="form-help">
            This creates the run manifest; it does not start Codex or execute
            commands from the Oven instructions.
          </p>
        </CardContent>
      </Card>
      {(error || status) && (
        <p
          aria-live="polite"
          className={`form-notice run-form-notice ${error ? "is-error" : "is-success"}`}
        >
          {error || status}
        </p>
      )}
      <div className="form-actions run-form-actions">
        <Button asChild variant="outline">
          <a href="/">Cancel</a>
        </Button>
        <Button
          disabled={saving || !repos.length || !effectiveOvens.length}
          type="submit"
        >
          <Play />
          {saving ? "Creating…" : "Run Burn"}
        </Button>
      </div>
    </form>
  );
}
