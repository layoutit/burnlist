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
  description: string;
  builtIn: boolean;
  repoKey: string | null;
  label: string;
  href: string;
  adoptCommand: string;
  agentInstructions: string;
};

type OvenIr = ComponentProps<typeof OvenRuntime>["ir"];

export function OvenExplainerView({ entry, ir, sample }: { entry: OvenCatalogEntry; ir: OvenIr; sample: unknown | null }) {
  return (
    <section className="dashboard-index oven-explainer">
      <header className="oven-explainer-heading">
        <h1 className="dashboard-index-title">{entry.name}</h1>
        <p className="dashboard-index-summary">{entry.label}</p>
        <div className="oven-explainer-badges">
          <Badge variant="outline">Contract: {entry.contract}</Badge>
          <Badge variant={entry.builtIn ? "default" : "secondary"}>{entry.builtIn ? "Built-in" : "Custom"}</Badge>
          {!entry.builtIn && entry.repoKey ? <Badge variant="ghost">{entry.repoKey}</Badge> : null}
        </div>
        <p className="oven-explainer-note">This is the Oven explainer. The live bound view lives at the scoped <code>/r/…/o/{entry.id}</code> URL.</p>
      </header>

      <Card className="oven-explainer-card">
        <CardHeader>
          <CardTitle><h2>Docs</h2></CardTitle>
          <CardDescription>{entry.description}</CardDescription>
        </CardHeader>
        <CardContent className="oven-explainer-card-content">
          <div className="oven-explainer-data-shape">
            <h3>What it shows / data shape</h3>
            <p>This Oven renders data that satisfies the <code>{entry.contract}</code> contract.</p>
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
