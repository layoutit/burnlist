import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { buildOvenCatalog } from "@lib";
import type { OvenSummary } from "@lib/types";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@layout";
import { DashboardError } from "../DashboardError";
import { EmptyState } from "../EmptyState";
import "./OvenCatalog.css";

type OvenCatalogEntry = {
  id: string;
  name: string;
  version: string;
  contract: string;
  description: string;
  builtIn: boolean;
  repoKey: string | null;
  label: string;
  href: string;
  adoptCommand: string;
  agentInstructions: string;
};

function CopyButton({ text }: { text: string }) {
  const [isCopied, setIsCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const copy = async () => {
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clipboard?.writeText) return;
    try {
      await clipboard.writeText(text);
      setIsCopied(true);
      clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setIsCopied(false), 1500);
    } catch {
      // Clipboard access may be unavailable outside a secure browser context.
    }
  };

  return (
    <button
      aria-label={isCopied ? "Instructions copied" : "Copy instructions"}
      className="copy-btn oven-catalog-copy-button"
      onClick={() => void copy()}
      title={isCopied ? "Copied" : "Copy instructions"}
      type="button"
    >
      {isCopied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      <span>{isCopied ? "Copied" : "Copy"}</span>
    </button>
  );
}

export function OvenCatalog() {
  const [catalog, setCatalog] = useState<OvenCatalogEntry[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setCatalog(null);
      setError("");
      try {
        const response = await fetch("/api/ovens", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(`Could not load Ovens (${response.status}).`);
        const payload = await response.json() as { ovens?: OvenSummary[] };
        if (controller.signal.aborted) return;
        setCatalog(buildOvenCatalog(payload.ovens) as OvenCatalogEntry[]);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Could not load Ovens.");
      }
    };
    void load();
    return () => controller.abort();
  }, []);

  if (error) return <DashboardError message={error} />;
  if (!catalog) return <EmptyState detail="Reading the available Oven definitions." title="Loading Ovens" />;

  return (
    <section className="dashboard-index oven-catalog">
      <div className="oven-catalog-heading">
        <h1 className="dashboard-index-title">Ovens</h1>
        <p className="dashboard-index-summary">{catalog.length} {catalog.length === 1 ? "Oven" : "Ovens"}</p>
      </div>
      <div className="oven-catalog-list">
        {catalog.map((entry) => (
          <Card className="oven-catalog-card" key={`${entry.repoKey ?? "built-in"}:${entry.id}`}>
            <CardHeader className="oven-catalog-card-header">
              <CardTitle><h2 className="oven-catalog-name">{entry.name}</h2></CardTitle>
              <CardDescription className="oven-catalog-label">{entry.label}</CardDescription>
            </CardHeader>
            <CardContent className="oven-catalog-card-content">
              <div className="oven-catalog-badges">
                <Badge variant="outline">Contract: {entry.contract}</Badge>
                <Badge variant={entry.builtIn ? "default" : "secondary"}>{entry.builtIn ? "Built-in" : "Custom"}</Badge>
                {!entry.builtIn && entry.repoKey ? <Badge variant="ghost">{entry.repoKey}</Badge> : null}
              </div>
              <p className="oven-catalog-description">{entry.description}</p>
              <a className="oven-catalog-explainer-link" href={entry.href}>Open Oven explainer</a>
              <div className="oven-catalog-agent-block">
                <div className="oven-catalog-agent-heading">
                  <h3>Tell your agent</h3>
                  <CopyButton text={entry.agentInstructions} />
                </div>
                <pre><code>{entry.agentInstructions}</code></pre>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
