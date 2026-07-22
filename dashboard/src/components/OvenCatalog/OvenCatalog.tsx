import { useEffect, useState } from "react";
import { buildLocalOvenInventory, buildOfficialOvenCatalog } from "@lib";
import type { OfficialOvenCatalogEntry, OfficialOvenCatalogResponse, OvenSummary } from "@lib";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@layout";
import { DashboardError } from "../DashboardError";
import { CopyButton } from "../CopyButton";
import { EmptyState } from "../EmptyState";
import "./OvenCatalog.css";

type OfficialEntry = OfficialOvenCatalogEntry & {
  origin: "official";
  repoKey: null;
  label: string;
  href: string;
  maturityLabel: string;
  agentInstructions: string;
};

type LocalEntry = OvenSummary & {
  origin: "vendored" | "custom";
  label: string;
  href: string;
  agentInstructions: string;
};

type CatalogState = {
  catalogRevision: string;
  official: OfficialEntry[];
  local: LocalEntry[];
  inventoryError: string;
};

function AgentBlock({ text }: { text: string }) {
  return (
    <div className="oven-catalog-agent-block">
      <div className="oven-catalog-agent-heading">
        <h3>Tell your agent</h3>
        <CopyButton text={text} />
      </div>
      <pre><code>{text}</code></pre>
    </div>
  );
}

export function OvenCatalogView({ catalogRevision, official, local, inventoryError = "" }: CatalogState) {
  return (
    <section className="dashboard-index oven-catalog">
      <div className="oven-catalog-heading">
        <h1 className="dashboard-index-title">Official Oven catalog</h1>
        <p className="dashboard-index-summary">
          {official.length} official {official.length === 1 ? "entry" : "entries"} · revision {catalogRevision.slice(0, 12)}
        </p>
      </div>

      <section className="oven-catalog-section" aria-labelledby="official-ovens-heading">
        <div className="oven-catalog-section-heading">
          <h2 id="official-ovens-heading">Official Ovens</h2>
          <p>Only these validated declarative packages are official catalog members.</p>
        </div>
        <div className="oven-catalog-list">
          {official.map((entry) => (
            <Card className="oven-catalog-card" key={entry.id}>
              <CardHeader className="oven-catalog-card-header">
                <CardTitle><h3 className="oven-catalog-name">{entry.name}</h3></CardTitle>
                <CardDescription className="oven-catalog-label">{entry.label}</CardDescription>
              </CardHeader>
              <CardContent className="oven-catalog-card-content">
                <div className="oven-catalog-badges">
                  <Badge>Official</Badge>
                  <Badge variant="outline">Input: {entry.inputContract}</Badge>
                  <Badge variant="outline">Render: {entry.renderContract}</Badge>
                  <Badge variant="secondary">{entry.maturityLabel}</Badge>
                </div>
                <p className="oven-catalog-description">{entry.description}</p>
                <dl className="oven-catalog-meta">
                  <div><dt>Producer</dt><dd>{entry.producer}</dd></div>
                  <div><dt>Route</dt><dd>{entry.routeKind}</dd></div>
                  <div><dt>Runtime</dt><dd>{entry.runtimeCompatibility}</dd></div>
                </dl>
                <a className="oven-catalog-explainer-link" href={entry.href}>Open Oven explainer</a>
                <AgentBlock text={entry.agentInstructions} />
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="oven-catalog-section" aria-labelledby="local-ovens-heading">
        <div className="oven-catalog-section-heading">
          <h2 id="local-ovens-heading">Repository inventory</h2>
          <p>Vendored and custom Ovens are available locally but are not official catalog entries.</p>
        </div>
        {inventoryError ? <DashboardError message={inventoryError} /> : null}
        {!inventoryError && local.length === 0
          ? <p className="oven-catalog-empty">No vendored or custom Ovens are available in the observed repositories.</p>
          : null}
        <div className="oven-catalog-list">
          {local.map((entry) => (
            <Card className="oven-catalog-card" key={`${entry.origin}:${entry.repoKey}:${entry.id}`}>
              <CardHeader className="oven-catalog-card-header">
                <CardTitle><h3 className="oven-catalog-name">{entry.name}</h3></CardTitle>
                <CardDescription className="oven-catalog-label">{entry.label}</CardDescription>
              </CardHeader>
              <CardContent className="oven-catalog-card-content">
                <div className="oven-catalog-badges">
                  <Badge variant="secondary">{entry.origin === "vendored" ? "Vendored" : "Custom"}</Badge>
                  <Badge variant="outline">Contract: {entry.contract}</Badge>
                  {entry.repoKey ? <Badge variant="ghost">{entry.repoKey}</Badge> : null}
                </div>
                <p className="oven-catalog-description">{entry.description}</p>
                <a className="oven-catalog-explainer-link" href={entry.href}>Open local Oven explainer</a>
                <AgentBlock text={entry.agentInstructions} />
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </section>
  );
}

export function OvenCatalog() {
  const [state, setState] = useState<CatalogState | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setState(null);
      setError("");
      try {
        const [catalogResponse, inventoryResponse] = await Promise.all([
          fetch("/api/oven-catalog", { cache: "no-store", signal: controller.signal }),
          fetch("/api/ovens", { cache: "no-store", signal: controller.signal }),
        ]);
        if (!catalogResponse.ok) throw new Error(`Could not load the official Oven catalog (${catalogResponse.status}).`);
        const catalog = await catalogResponse.json() as OfficialOvenCatalogResponse;
        let local: LocalEntry[] = [];
        let inventoryError = "";
        if (inventoryResponse.ok) {
          const inventory = await inventoryResponse.json() as { ovens?: OvenSummary[] };
          local = buildLocalOvenInventory(inventory.ovens) as LocalEntry[];
        } else {
          inventoryError = `Could not load repository Oven inventory (${inventoryResponse.status}).`;
        }
        if (controller.signal.aborted) return;
        setState({
          catalogRevision: catalog.catalogRevision,
          official: buildOfficialOvenCatalog(catalog.entries) as OfficialEntry[],
          local,
          inventoryError,
        });
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Could not load the official Oven catalog.");
      }
    };
    void load();
    return () => controller.abort();
  }, []);

  if (error) return <DashboardError message={error} />;
  if (!state) return <EmptyState detail="Reading the official catalog and repository inventory." title="Loading Ovens" />;
  return <OvenCatalogView {...state} />;
}
