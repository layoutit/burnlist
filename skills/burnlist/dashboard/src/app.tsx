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
import { cn } from "@/lib/utils";
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
    <header className="sticky top-0 z-50 h-[50px] border-b border-[#262626] bg-[#050505]">
      <div className="flex h-full w-full items-center justify-between gap-3 px-4">
        <a aria-label="Burnlist home" className="flex min-w-0 items-center gap-2" href="/">
          <img alt="" className="size-7 shrink-0" src="/favicon.svg" />
          <span className="hidden font-[var(--dashboard-title-font)] text-sm font-medium text-foreground sm:inline">Burnlist</span>
        </a>
        <nav aria-label="Primary navigation" className="flex h-full items-center gap-2 font-[var(--dashboard-title-font)] text-sm">
          {HEADER_LINKS.map((link, index) => (
            <span className="contents" key={link.href}>
              {index > 0 && <span aria-hidden="true" className="text-white/25">·</span>}
              <a
                aria-current={section === link.section ? "page" : undefined}
                className={cn(
                  "text-muted-foreground opacity-55 transition-colors hover:text-foreground hover:opacity-100",
                  section === link.section && "text-foreground opacity-100",
                )}
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
    <div className="grid min-h-72 place-items-center px-6 text-center">
      <div className="max-w-sm">
        <span className="mx-auto mb-4 grid size-11 place-items-center rounded-xl border border-white/10 bg-white/4 text-muted-foreground">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <h2 className="font-medium">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function Pagination({ page, totalItems, totalPages, onPageChange }: { page: number; totalItems: number; totalPages: number; onPageChange: (page: number) => void }) {
  if (totalPages <= 1) return null;
  const firstItem = (page - 1) * PAGE_SIZE + 1;
  const lastItem = Math.min(page * PAGE_SIZE, totalItems);
  return (
    <nav aria-label="Burnlist table pages" className="flex flex-col gap-3 border-t border-white/8 px-5 py-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <p>Showing {firstItem}–{lastItem} of {totalItems}</p>
      <div className="flex items-center gap-2">
        <Button aria-label="Previous page" disabled={page === 1} onClick={() => onPageChange(page - 1)} size="sm" variant="outline">Previous</Button>
        <span aria-live="polite" className="min-w-24 text-center">Page {page} of {totalPages}</span>
        <Button aria-label="Next page" disabled={page === totalPages} onClick={() => onPageChange(page + 1)} size="sm" variant="outline">Next</Button>
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
    <div className="overflow-hidden rounded-lg bg-[#111111]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="border-b border-white/15 bg-transparent font-[var(--dashboard-title-font)] text-xs font-normal text-muted-foreground">
            <tr>
              <th className="px-5 py-3">Burnlist</th>
              <th className="px-5 py-3">Oven</th>
              <th className="px-5 py-3">Lifecycle</th>
              <th className="px-5 py-3">Progress</th>
              <th className="px-5 py-3">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {pageRows.map((entry) => {
              const href = entry.ovenId === "checklist" ? burnlistHref(entry, filter, currentPage) : entry.href;
              const open = () => { window.location.href = href; };
              return (
                <tr
                  aria-label={`Open ${entry.repo}/${entry.id}`}
                  className="cursor-pointer transition-colors hover:bg-white/3 focus-visible:bg-white/3 focus-visible:outline-none"
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
                  <td className="max-w-md px-5 py-4">
                    <p className="font-medium text-foreground">{entry.repo}/{entry.id}</p>
                    <p className="mt-1 truncate text-sm text-muted-foreground">{entry.title}</p>
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-muted-foreground">{entry.ovenName}</td>
                  <td className={cn("px-5 py-4 font-[var(--dashboard-title-font)] text-sm", entry.status === "active" ? "text-[#61d394]" : entry.status === "complete" ? "text-muted-foreground" : "text-foreground")}>{entry.statusLabel}</td>
                  <td className="w-52 px-5 py-4">
                    <div className="flex justify-between gap-3 text-xs text-muted-foreground"><span>{entry.progressLabel}</span>{entry.percent != null && <span>{entry.percent}%</span>}</div>
                    {entry.percent != null && <Progress className="mt-2 h-1.5" value={entry.percent} />}
                  </td>
                  <td className="timestamp whitespace-nowrap px-5 py-4 text-muted-foreground">{formatTime(entry.updatedAt)}</td>
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
    <div className="min-h-screen">
      <AppHeader section={section} />
      <main className={cn("mx-auto", section === "differential-testing" || selected ? "max-w-none" : "w-full max-w-[1200px] px-4 py-5")}>
        {section === "differential-testing" ? (
          <DifferentialTestingPage />
        ) : section === "new-oven" ? (
          <NewOvenPage />
        ) : section === "run-burn" ? (
          <RunBurnPage />
        ) : selected ? (
          error ? (
            <Card className="border-destructive/35 bg-destructive/10 py-5 text-destructive-foreground"><CardContent className="flex gap-3 px-5"><AlertTriangle className="size-5 shrink-0" /><p className="text-sm">{error}</p></CardContent></Card>
          ) : loading && !progress ? (
            <EmptyState title="Loading progress" detail="Reading the selected Burnlist." />
          ) : progress ? (
            <ChecklistDashboard backHref={listHref(filter, page)} data={progress} />
          ) : (
            <EmptyState title="Choose a Burnlist" detail="Select an item from the list to inspect its progress." icon={ListChecks} />
          )
        ) : (
          <section className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-3 px-1">
                <h1 className="font-[var(--dashboard-title-font)] text-[18px] font-normal">Ovens</h1>
                <div aria-label="Oven lifecycle" className="flex items-center gap-2 font-[var(--dashboard-title-font)] text-xs" role="tablist">
                  {FILTERS.map((entry, index) => (
                    <span className="flex items-center gap-2" key={entry.value}>
                      {index > 0 ? <span aria-hidden="true" className="text-muted-foreground/55">·</span> : null}
                      <button
                        aria-selected={filter === entry.value}
                        className={cn("transition-colors hover:text-foreground", filter === entry.value ? "text-foreground" : "text-muted-foreground")}
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
                <Card className="border-destructive/35 bg-destructive/10 py-5 text-destructive-foreground"><CardContent className="flex gap-3 px-5"><AlertTriangle className="size-5 shrink-0" /><p className="text-sm">{error}</p></CardContent></Card>
              ) : <BurnlistTable burnlists={burnlists} filter={filter} onPageChange={updatePage} page={page} />}
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock3 className="size-3.5" />Refreshes every five seconds.</p>
          </section>
        )}
      </main>
    </div>
  );
}
