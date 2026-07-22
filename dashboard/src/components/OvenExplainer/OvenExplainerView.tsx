import type { ComponentProps } from "react";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@layout";
import { OvenRuntime } from "@/oven/runtime/OvenRuntime";
import { CopyButton } from "../CopyButton";
import "./OvenExplainer.css";

type OvenCatalogEntry = {
  id: string;
  name: string;
  version: string;
  contract: string;
  inputContract: string;
  renderContract: string;
  description: string;
  builtIn: boolean;
  origin: "official" | "vendored" | "custom";
  repoKey: string | null;
  dataInput: "json-payload" | "producer-managed";
  label: string;
  href: string;
  agentInstructions: string;
};

type OvenIr = ComponentProps<typeof OvenRuntime>["ir"];

export function OvenExplainerView({ entry, ir, sample }: { entry: OvenCatalogEntry; ir: OvenIr; sample: unknown | null }) {
  const originLabel = entry.origin[0].toUpperCase() + entry.origin.slice(1);
  const liveHref = entry.repoKey ? `/r/${encodeURIComponent(entry.repoKey)}/o/${encodeURIComponent(entry.id)}` : null;
  return (
    <section className="dashboard-index oven-explainer">
      <header className="oven-explainer-heading">
        <h1 className="dashboard-index-title">{entry.name}</h1>
        <p className="dashboard-index-summary">{entry.label}</p>
        <div className="oven-explainer-badges">
          <Badge variant="outline">Input: {entry.inputContract}</Badge>
          <Badge variant="outline">Render: {entry.renderContract}</Badge>
          <Badge variant={entry.origin === "official" ? "default" : "secondary"}>{originLabel}</Badge>
          {entry.origin !== "official" && entry.repoKey ? <Badge variant="ghost">{entry.repoKey}</Badge> : null}
        </div>
        <p className="oven-explainer-note">
          This is the Oven explainer. {liveHref
            ? <a href={liveHref}>Open the repository live view.</a>
            : "Choose a repository to open its live bound view."}
        </p>
      </header>

      <Card className="oven-explainer-card">
        <CardHeader>
          <CardTitle><h2>Docs</h2></CardTitle>
          <CardDescription>{entry.description}</CardDescription>
        </CardHeader>
        <CardContent className="oven-explainer-card-content">
          <div className="oven-explainer-data-shape">
            <h3>What it shows / data shape</h3>
            <p>Producer data satisfies <code>{entry.inputContract}</code>; the declarative view renders <code>{entry.renderContract}</code>.</p>
          </div>
          <div className="oven-explainer-agent-block">
            <div className="oven-explainer-agent-heading">
              <h3>Tell your agent</h3>
              <CopyButton text={entry.agentInstructions} />
            </div>
            <pre><code>{entry.agentInstructions}</code></pre>
          </div>
        </CardContent>
      </Card>

      <Card className="oven-explainer-card oven-explainer-demo">
        <CardHeader>
          <CardTitle><h2>Demo (sample data)</h2></CardTitle>
          <CardDescription>A static preview that never requests or changes live Oven data.</CardDescription>
        </CardHeader>
        <CardContent>
          {sample !== null ? (
            <div aria-label="Oven sample-data demo" className="oven-explainer-demo-runtime">
              <OvenRuntime ir={{ ...ir, refreshSeconds: undefined }} payload={sample} />
            </div>
          ) : <p className="oven-explainer-docs-only">This Oven needs live data, so no sample data demo is available.</p>}
        </CardContent>
      </Card>
    </section>
  );
}
