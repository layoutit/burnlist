import { useMemo, useState } from "react";
import { Clock3, ListChecks } from "lucide-react";
import { AppHeader, ChecklistOvenView, DashboardError, DifferentialTestingPage, EmptyState, FILTERS, Filters, NewOvenPage, ProjectGroup, RunBurnPage, StreamingDiff, VisualParityPage } from "@components";
import { useDashboardData } from "@hooks";
import { currentSection, filterFromUrl, selectedBurnlist } from "@lib";
import type { Filter } from "@lib";

export function App() {
  const section = currentSection();
  const selected = useMemo(selectedBurnlist, [window.location.pathname, window.location.search]);
  const [filter, setFilter] = useState(() => filterFromUrl(FILTERS));
  const dashboardSection = section === "streaming-diff" ? "burnlists" : section;
  const { projects, progress, error, loading } = useDashboardData({ section: dashboardSection, selected });

  const updateFilter = (nextFilter: Filter) => {
    const url = new URL(window.location.href);
    if (nextFilter === "all") url.searchParams.delete("filter");
    else url.searchParams.set("filter", nextFilter);
    url.searchParams.delete("page");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    setFilter(nextFilter);
  };

  return (
    <div className="dashboard-app">
      <AppHeader detail={progress} section={section} />
      <main className="dashboard-main" data-layout={section === "differential-testing" || section === "performance-tracing" || section === "streaming-diff" || section === "visual-parity" || selected ? "full" : "index"} data-section={section}>
        {section === "differential-testing" ? <DifferentialTestingPage /> : section === "performance-tracing" ? <DifferentialTestingPage ovenId="performance-tracing" /> : section === "streaming-diff" ? <StreamingDiff projects={projects} projectsLoading={loading} /> : section === "visual-parity" ? <VisualParityPage /> : section === "new-oven" ? <NewOvenPage /> : section === "run-burn" ? <RunBurnPage /> : selected ? (
          error ? <DashboardError message={error} /> : loading && !progress ? <EmptyState title="Loading progress" detail="Reading the selected Burnlist." /> : progress ? (
            <ChecklistOvenView data={progress} />
          ) : <EmptyState title="Choose a Burnlist" detail="Select an item from the list to inspect its progress." icon={ListChecks} />
        ) : (
          <section className="dashboard-index">
            <div className="dashboard-index-header">
              <h1 className="dashboard-index-title">Ovens</h1>
              <Filters filter={filter} onFilterChange={updateFilter} />
            </div>
            {error ? <DashboardError message={error} /> : projects.length ? (
              <div className="dashboard-project-groups">{projects.map((project) => <ProjectGroup filter={filter} key={project.canonicalRoot} project={project} />)}</div>
            ) : <EmptyState title="Nothing here yet" detail="Run `burnlist init` to initialize this repository." />}
            <p className="dashboard-refresh-note"><Clock3 className="dashboard-refresh-icon" />Refreshes every five seconds.</p>
          </section>
        )}
      </main>
    </div>
  );
}
