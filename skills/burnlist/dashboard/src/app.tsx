import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleDotDashed,
  Clock3,
  FileText,
  Flame,
  ListChecks,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { BurnActions, NewOvenPage, RunBurnPage } from "@/burn-ovens";
import { CompareOvenPage } from "@/compare-oven";

type Filter = "active" | "draft" | "ready" | "complete" | "all";

type Burnlist = {
  id: string;
  repo: string;
  title: string;
  planLabel: string;
  status: Exclude<Filter, "all">;
  statusLabel: string;
  total: number;
  done: number;
  remaining: number;
  percent: number;
  errors: number;
  warnings: number;
  updatedAt: string | null;
};

type ChecklistItem = { id: string; title: string; fields: Record<string, string> };
type CompletedItem = { id: string; title: string; completedAt: string; detail: string };
type Warning = { severity: "error" | "warning"; message: string };
type DocumentSection = { title: string; body: string };
type BurnlistDocument = { available: boolean; label: string; path: string; sections: DocumentSection[] };

type ProgressData = {
  title: string;
  repo: string;
  planLabel: string;
  total: number;
  done: number;
  remaining: number;
  percent: number;
  warnings: Warning[];
  goal: BurnlistDocument;
  active: ChecklistItem[];
  completed: CompletedItem[];
};

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "active", label: "Active" },
  { value: "ready", label: "Ready" },
  { value: "draft", label: "Draft" },
  { value: "complete", label: "Done" },
  { value: "all", label: "All" },
];

const PAGE_SIZE = 20;

function currentSection() {
  if (window.location.pathname === "/ovens/new") return "new-oven";
  if (window.location.pathname === "/ovens/compare/view") return "compare-oven";
  if (window.location.pathname === "/runs/new") return "run-burn";
  return "burnlists";
}

function selectedBurnlist() {
  if (currentSection() !== "burnlists") return null;
  const parts = window.location.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  return parts.length === 2 ? { repo: parts[0], id: parts[1] } : null;
}

function filterFromUrl(): Filter {
  const value = new URLSearchParams(window.location.search).get("filter") as Filter | null;
  return FILTERS.some((filter) => filter.value === value) ? value! : "all";
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

function badgeVariant(status: Burnlist["status"]) {
  if (status === "active") return "default" as const;
  if (status === "complete") return "secondary" as const;
  return "outline" as const;
}

function Metric({ label, value, icon: Icon }: { label: string; value: string | number; icon: typeof ListChecks }) {
  return (
    <Card className="gap-3 border-white/7 bg-black/15 py-4 shadow-none backdrop-blur-sm">
      <CardContent className="flex items-center justify-between px-4">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
        </div>
        <span className="rounded-lg border border-primary/15 bg-primary/10 p-2 text-primary">
          <Icon className="size-4" aria-hidden="true" />
        </span>
      </CardContent>
    </Card>
  );
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
    <Card className="gap-0 overflow-hidden border-white/8 bg-card/80 py-0 shadow-xl shadow-black/10 backdrop-blur-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-white/8 bg-white/3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            <tr>
              <th className="px-5 py-3">Burnlist</th>
              <th className="px-5 py-3">Lifecycle</th>
              <th className="px-5 py-3">Progress</th>
              <th className="px-5 py-3">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/8">
            {pageRows.map((entry) => {
              const href = burnlistHref(entry, filter, currentPage);
              const open = () => { window.location.href = href; };
              return (
                <tr
                  aria-label={`Open ${entry.repo}/${entry.id}`}
                  className="cursor-pointer transition-colors hover:bg-primary/8 focus-visible:bg-primary/10 focus-visible:outline-none"
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
                  <td className="px-5 py-4"><Badge variant={badgeVariant(entry.status)}>{entry.statusLabel}</Badge></td>
                  <td className="w-52 px-5 py-4">
                    <div className="flex justify-between gap-3 text-xs text-muted-foreground"><span>{entry.done}/{entry.total} done</span><span>{entry.percent}%</span></div>
                    <Progress className="mt-2 h-1.5" value={entry.percent} />
                  </td>
                  <td className="timestamp whitespace-nowrap px-5 py-4 text-muted-foreground">{formatTime(entry.updatedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination onPageChange={onPageChange} page={currentPage} totalItems={rows.length} totalPages={totalPages} />
    </Card>
  );
}

function ChecklistCard({ title, icon: Icon, children }: { title: string; icon: typeof ListChecks; children: React.ReactNode }) {
  return (
    <Card className="gap-0 overflow-hidden border-white/8 bg-black/15 py-0 shadow-none backdrop-blur-sm">
      <CardHeader className="flex-row items-center gap-2 border-b border-white/8 px-5 py-4">
        <span className="grid size-7 place-items-center rounded-md bg-white/5 text-muted-foreground"><Icon className="size-4" /></span>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-5 py-3">{children}</CardContent>
    </Card>
  );
}

function GoalDocument({ document }: { document: BurnlistDocument }) {
  if (!document.available || !document.sections.length) return null;
  return (
    <ChecklistCard icon={FileText} title="Goal and guardrails">
      <p className="mb-4 text-xs text-muted-foreground">{document.path}</p>
      <div className="divide-y divide-white/8">
        {document.sections.map((section) => (
          <section className="py-4 first:pt-0 last:pb-0" key={section.title}>
            <h3 className="text-sm font-medium text-foreground">{section.title}</h3>
            {section.body && <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{section.body}</p>}
          </section>
        ))}
      </div>
    </ChecklistCard>
  );
}

function Detail({ data, filter, loading, page }: { data: ProgressData | null; filter: Filter; loading: boolean; page: number }) {
  if (loading && !data) return <EmptyState title="Loading progress" detail="Reading the selected Burnlist." />;
  if (!data) return <EmptyState title="Choose a Burnlist" detail="Select an item from the list to inspect its progress and checklist." icon={ListChecks} />;
  const backHref = listHref(filter, page);

  return (
    <div className="space-y-5">
      <Button asChild size="sm" variant="ghost"><a href={backHref}><ArrowLeft />All Burnlists</a></Button>
      <Card className="gap-5 border-primary/15 bg-gradient-to-br from-primary/12 via-card to-card py-5 shadow-xl shadow-black/10 backdrop-blur-sm">
        <CardHeader className="gap-4 px-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <CardTitle className="truncate text-xl tracking-tight sm:text-2xl">{data.title}</CardTitle>
              <CardDescription className="mt-2 flex items-center gap-1.5 break-all"><FileText className="size-3.5" />{data.repo}/{data.planLabel}</CardDescription>
            </div>
            <Badge className="px-2.5 py-1 text-sm" variant="outline">{data.percent}% complete</Badge>
          </div>
          <Progress className="h-2.5 bg-primary/15" value={data.percent} />
        </CardHeader>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={CheckCircle2} label="Completed" value={`${data.done}/${data.total}`} />
        <Metric icon={ListChecks} label="Remaining" value={data.remaining} />
        <Metric icon={Flame} label="Progress" value={`${data.percent}%`} />
        <Metric icon={AlertTriangle} label="Signals" value={data.warnings.length} />
      </div>

      {data.warnings.length > 0 && (
        <Card className="gap-0 border-amber-400/20 bg-amber-300/5 py-0 shadow-none">
          <CardHeader className="flex-row items-center gap-2 px-5 py-4 text-amber-200">
            <AlertTriangle className="size-4" />
            <CardTitle className="text-sm">Protocol signals</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 px-5 pb-4">
            {data.warnings.map((warning, index) => (
              <p className={cn("text-sm", warning.severity === "error" ? "text-red-300" : "text-amber-100/80")} key={`${warning.message}-${index}`}>
                <span className="mr-2 font-medium uppercase">{warning.severity}</span>{warning.message}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      <GoalDocument document={data.goal} />

      {data.active.length > 0 && (
        <ChecklistCard icon={ListChecks} title="Active checklist">
          <div className="divide-y divide-white/8">
            {data.active.map((item) => (
              <article className="py-4 first:pt-1 last:pb-1" key={`${item.id}/${item.title}`}>
                <div className="flex gap-3">
                  <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border border-primary/20 bg-primary/10 text-xs font-semibold text-primary">{item.id}</span>
                  <div className="min-w-0">
                    <h3 className="font-medium text-foreground">{item.title}</h3>
                    {Object.entries(item.fields).length > 0 && (
                      <dl className="mt-3 space-y-2 text-sm">
                        {Object.entries(item.fields).map(([label, value]) => (
                          <div key={label}>
                            <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
                            <dd className="mt-0.5 whitespace-pre-wrap break-words text-muted-foreground">{value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </ChecklistCard>
      )}

      <ChecklistCard icon={Clock3} title="Completed detail">
        {data.completed.length ? (
          <div className="divide-y divide-white/8">
            {data.completed.map((item) => (
              <article className="py-5 first:pt-1 last:pb-1" key={`${item.id}/${item.completedAt}`}>
                <div className="flex gap-3">
                  <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-emerald-400/12 text-emerald-300"><CheckCircle2 className="size-3.5" /></span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-foreground"><span className="mr-1 text-muted-foreground">{item.id}</span>{item.title}</h3>
                    <p className="timestamp mt-1 text-muted-foreground">{formatTime(item.completedAt)}</p>
                    {item.detail ? <p className="mt-4 whitespace-pre-wrap break-words rounded-lg border border-white/7 bg-black/15 p-4 font-mono text-xs leading-6 text-muted-foreground">{item.detail}</p> : <p className="mt-3 text-sm text-muted-foreground">No detailed completion record.</p>}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : <EmptyState title="No completions yet" detail="Completed ledger items will appear here." icon={Clock3} />}
      </ChecklistCard>
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
      <main className={cn("mx-auto", section === "compare-oven" ? "max-w-none" : "px-4 py-8 sm:px-6 lg:px-8", section === "new-oven" ? "max-w-none" : section === "compare-oven" ? "" : "max-w-7xl")}>
        {section === "compare-oven" ? (
          <CompareOvenPage />
        ) : section === "new-oven" ? (
          <NewOvenPage />
        ) : section === "run-burn" ? (
          <RunBurnPage />
        ) : selected ? (
          error ? (
            <Card className="border-destructive/35 bg-destructive/10 py-5 text-destructive-foreground"><CardContent className="flex gap-3 px-5"><AlertTriangle className="size-5 shrink-0" /><p className="text-sm">{error}</p></CardContent></Card>
          ) : <Detail data={progress} filter={filter} loading={loading} page={page} />
        ) : (
          <section className="space-y-5">
              <div className="flex items-center gap-3">
                <img className="size-10 shrink-0" src="/favicon.svg" alt="" />
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight">Burnlists</h1>
                  <p className="mt-1 text-sm text-muted-foreground">Let it cook</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Tabs onValueChange={updateFilter} value={filter}>
                  <TabsList className="grid w-full max-w-md grid-cols-5" variant="default">
                    {FILTERS.map((entry) => <TabsTrigger className="px-1 text-xs" key={entry.value} value={entry.value}>{entry.label}</TabsTrigger>)}
                  </TabsList>
                </Tabs>
                <BurnActions />
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
