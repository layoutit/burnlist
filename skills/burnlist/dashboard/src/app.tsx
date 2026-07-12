import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CircleDotDashed,
  Clock3,
  ListChecks,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { NewOvenPage, RunBurnPage } from "@/burn-ovens";
import { ChecklistDashboard, type ChecklistProgressData } from "@/checklist-dashboard";
import { DifferentialTestingPage } from "@/differential-testing";

type Filter = "active" | "draft" | "ready" | "complete" | "all";

type Burnlist = {
  id: string;
  repo: string;
  title: string;
  planLabel: string;
  status: Exclude<Filter, "all">;
  statusLabel: string;
  total: number;
  done: number | null;
  remaining: number | null;
  percent: number | null;
  errors: number;
  warnings: number;
  updatedAt: string | null;
  ovenId: "checklist" | "differential-testing";
  ovenName: string;
  href: string;
  progressLabel: string;
};

type ProgressData = ChecklistProgressData;

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "active", label: "Active" },
  { value: "ready", label: "Ready" },
  { value: "draft", label: "Draft" },
  { value: "complete", label: "Done" },
  { value: "all", label: "All" },
];

const PAGE_SIZE = 20;

const HEADER_LINKS = [
  { href: "/ovens/new", label: "New Oven", section: "new-oven" },
] as const;

function currentSection() {
  if (window.location.pathname === "/ovens/new") return "new-oven";
  if (window.location.pathname === "/ovens/differential-testing/view") return "differential-testing";
  if (window.location.pathname === "/runs/new") return "run-burn";
  return "burnlists";
}

function selectedBurnlist() {
  if (currentSection() !== "burnlists") return null;
  const parts = window.location.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  return parts.length === 2 ? { repo: parts[0], id: parts[1] } : null;
}

function AppHeader({ section }: { section: string }) {
  return (
    <header className="dashboard-header">
      <div className="dashboard-header-inner">
        <a aria-label="Burnlist home" className="dashboard-brand" href="/">
          <img alt="" className="dashboard-brand-logo" src="/favicon.svg" />
          <span className="dashboard-brand-name">Burnlist</span>
        </a>
        <nav aria-label="Primary navigation" className="dashboard-primary-nav">
          {HEADER_LINKS.map((link, index) => (
            <span className="dashboard-primary-nav-item" key={link.href}>
              {index > 0 && <span aria-hidden="true" className="dashboard-primary-nav-separator">·</span>}
              <a
                aria-current={section === link.section ? "page" : undefined}
                className="dashboard-primary-nav-link"
                href={link.href}
              >
                {link.label}
              </a>
            </span>
          ))}
        </nav>
      </div>
    </header>
  );
}

function filterFromUrl(): Filter {
  const value = new URLSearchParams(window.location.search).get("filter") as Filter | null;
  return FILTERS.some((filter) => filter.value === value) ? value! : "active";
}

function pageFromUrl() {
  const value = Number(new URLSearchParams(window.location.search).get("page"));
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

function listSearch(filter: Filter, page: number) {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("filter", filter);
  if (page > 1) params.set("page", String(page));
  return params.toString();
}

function listHref(filter: Filter, page: number) {
  const search = listSearch(filter, page);
  return search ? `/?${search}` : "/";
}

function burnlistHref(entry: Burnlist, filter: Filter, page: number) {
  const params = new URLSearchParams({ filter });
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  const path = `/${encodeURIComponent(entry.repo)}/${encodeURIComponent(entry.id)}`;
  return `${path}?${search}`;
}

function formatTime(value: string | null) {
  if (!value) return "No timestamp";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function EmptyState({ title, detail, icon: Icon = CircleDotDashed }: { title: string; detail: string; icon?: typeof CircleDotDashed }) {
  return (
    <div className="dashboard-empty-state">
      <div className="dashboard-empty-state-content">
        <span className="dashboard-empty-state-icon">
          <Icon className="dashboard-empty-state-icon-svg" aria-hidden="true" />
        </span>
        <h2 className="dashboard-empty-state-title">{title}</h2>
        <p className="dashboard-empty-state-detail">{detail}</p>
      </div>
    </div>
  );
}

function Pagination({ page, totalItems, totalPages, onPageChange }: { page: number; totalItems: number; totalPages: number; onPageChange: (page: number) => void }) {
  if (totalPages <= 1) return null;
  const firstItem = (page - 1) * PAGE_SIZE + 1;
  const lastItem = Math.min(page * PAGE_SIZE, totalItems);
  return (
    <nav aria-label="Burnlist table pages" className="dashboard-pagination">
      <p className="dashboard-pagination-summary">Showing {firstItem}–{lastItem} of {totalItems}</p>
      <div className="dashboard-pagination-controls">
        <Button aria-label="Previous page" className="dashboard-pagination-button" disabled={page === 1} onClick={() => onPageChange(page - 1)} size="sm" variant="outline">Previous</Button>
        <span aria-live="polite" className="dashboard-pagination-status">Page {page} of {totalPages}</span>
        <Button aria-label="Next page" className="dashboard-pagination-button" disabled={page === totalPages} onClick={() => onPageChange(page + 1)} size="sm" variant="outline">Next</Button>
      </div>
    </nav>
  );
}

function BurnlistTable({ burnlists, filter, page, onPageChange }: { burnlists: Burnlist[]; filter: Filter; page: number; onPageChange: (page: number) => void }) {
  const rows = burnlists.filter((entry) => filter === "all" || entry.status === filter);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const firstIndex = (currentPage - 1) * PAGE_SIZE;
  const pageRows = rows.slice(firstIndex, firstIndex + PAGE_SIZE);

  useEffect(() => {
    if (page !== currentPage) onPageChange(currentPage);
  }, [currentPage, onPageChange, page]);

  if (!rows.length) return <EmptyState title="Nothing here yet" detail="No Burnlists match this lifecycle view." />;

  return (
    <div className="burnlist-table-card">
      <div className="burnlist-table-scroll">
        <table className="burnlist-table">
          <colgroup>
            <col className="burnlist-table-column-primary" />
            <col className="burnlist-table-column-oven" />
            <col className="burnlist-table-column-status" />
            <col className="burnlist-table-column-progress" />
            <col className="burnlist-table-column-updated" />
          </colgroup>
          <thead className="burnlist-table-head">
            <tr>
              <th className="burnlist-table-heading">Burnlist</th>
              <th className="burnlist-table-heading">Oven</th>
              <th className="burnlist-table-heading">Lifecycle</th>
              <th className="burnlist-table-heading">Progress</th>
              <th className="burnlist-table-heading">Updated</th>
            </tr>
          </thead>
          <tbody className="burnlist-table-body">
            {pageRows.map((entry) => {
              const href = entry.ovenId === "checklist" ? burnlistHref(entry, filter, currentPage) : entry.href;
              const open = () => { window.location.href = href; };
              return (
                <tr
                  aria-label={`Open ${entry.repo}/${entry.id}`}
                  className="burnlist-table-row"
                  data-status={entry.status}
                  key={`${entry.repo}/${entry.id}`}
                  onClick={open}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      open();
                    }
                  }}
                  role="link"
                  tabIndex={0}
                >
                  <td className="burnlist-table-cell burnlist-table-cell-primary">
                    <p className="burnlist-table-repo">{entry.repo}/{entry.id}</p>
                    <p className="burnlist-table-title">{entry.title}</p>
                  </td>
                  <td className="burnlist-table-cell burnlist-table-cell-oven">{entry.ovenName}</td>
                  <td className="burnlist-table-cell burnlist-table-cell-status" data-status={entry.status}>{entry.statusLabel}</td>
                  <td className="burnlist-table-cell burnlist-table-cell-progress">
                    <div className="burnlist-table-progress-meta"><span>{entry.progressLabel}</span>{entry.percent != null && <span>{entry.percent}%</span>}</div>
                    {entry.percent != null && <Progress className="burnlist-table-progress" value={entry.percent} />}
                  </td>
                  <td className="burnlist-table-cell burnlist-table-cell-updated timestamp">{formatTime(entry.updatedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination onPageChange={onPageChange} page={currentPage} totalItems={rows.length} totalPages={totalPages} />
    </div>
  );
}

function DashboardError({ message }: { message: string }) {
  return (
    <Card className="dashboard-error">
      <CardContent className="dashboard-error-content">
        <AlertTriangle className="dashboard-error-icon" />
        <p className="dashboard-error-message">{message}</p>
      </CardContent>
    </Card>
  );
}

export function App() {
  const [burnlists, setBurnlists] = useState<Burnlist[]>([]);
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [filter, setFilter] = useState<Filter>(filterFromUrl);
  const [page, setPage] = useState(pageFromUrl);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const section = currentSection();
  const selected = useMemo(selectedBurnlist, [window.location.pathname]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const indexResponse = await fetch("/api/burnlists", { cache: "no-store" });
        if (!indexResponse.ok) throw new Error("Could not load Burnlists.");
        const indexData = await indexResponse.json();
        if (cancelled) return;
        setBurnlists(indexData.burnlists ?? []);
        if (section === "burnlists" && selected) {
          const params = new URLSearchParams(selected);
          const progressResponse = await fetch(`/api/progress?${params}`, { cache: "no-store" });
          if (!progressResponse.ok) throw new Error((await progressResponse.json()).error ?? "Could not load progress.");
          if (!cancelled) setProgress(await progressResponse.json());
        } else if (!cancelled) {
          setProgress(null);
        }
        if (!cancelled) setError("");
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load dashboard data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [section, selected]);

  const updatePage = (nextPage: number) => {
    const normalizedPage = Math.max(1, Math.floor(nextPage));
    const url = new URL(window.location.href);
    if (normalizedPage === 1) url.searchParams.delete("page");
    else url.searchParams.set("page", String(normalizedPage));
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    setPage(normalizedPage);
  };

  const updateFilter = (value: string) => {
    const nextFilter = value as Filter;
    const url = new URL(window.location.href);
    if (nextFilter === "all") url.searchParams.delete("filter");
    else url.searchParams.set("filter", nextFilter);
    url.searchParams.delete("page");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    setFilter(nextFilter);
    setPage(1);
  };

  return (
    <div className="dashboard-app">
      <AppHeader section={section} />
      <main
        className="dashboard-main"
        data-layout={section === "differential-testing" || selected ? "full" : "index"}
        data-section={section}
      >
        {section === "differential-testing" ? (
          <DifferentialTestingPage />
        ) : section === "new-oven" ? (
          <NewOvenPage />
        ) : section === "run-burn" ? (
          <RunBurnPage />
        ) : selected ? (
          error ? (
            <DashboardError message={error} />
          ) : loading && !progress ? (
            <EmptyState title="Loading progress" detail="Reading the selected Burnlist." />
          ) : progress ? (
            <ChecklistDashboard backHref={listHref(filter, page)} data={progress} />
          ) : (
            <EmptyState title="Choose a Burnlist" detail="Select an item from the list to inspect its progress." icon={ListChecks} />
          )
        ) : (
          <section className="dashboard-index">
              <div className="dashboard-index-header">
                <h1 className="dashboard-index-title">Ovens</h1>
                <div aria-label="Oven lifecycle" className="dashboard-filters" role="tablist">
                  {FILTERS.map((entry, index) => (
                    <span className="dashboard-filter-item" key={entry.value}>
                      {index > 0 ? <span aria-hidden="true" className="dashboard-filter-separator">·</span> : null}
                      <button
                        aria-selected={filter === entry.value}
                        className="dashboard-filter-button"
                        onClick={() => updateFilter(entry.value)}
                        role="tab"
                        type="button"
                      >
                        {entry.label}
                      </button>
                    </span>
                  ))}
                </div>
              </div>
              {error ? (
                <DashboardError message={error} />
              ) : <BurnlistTable burnlists={burnlists} filter={filter} onPageChange={updatePage} page={page} />}
              <p className="dashboard-refresh-note"><Clock3 className="dashboard-refresh-icon" />Refreshes every five seconds.</p>
          </section>
        )}
      </main>
    </div>
  );
}
