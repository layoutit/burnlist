import { useMemo, useState } from "react";
import { ListChecks } from "lucide-react";
import { AppHeader, BurnlistTable, ChecklistOvenView, CustomOvenView, DashboardError, DifferentialTestingOvenPage, EmptyState, FILTERS, Filters, ModelLabPage, NewOvenPage, PerformanceTracingOvenPage, ProjectGroup, RunBurnPage, StreamingDiff, VisualParityPage } from "@components";
import { useDashboardData } from "@hooks";
import { currentSection, filterFromUrl, selectedBurnlist } from "@lib";
import type { Filter } from "@lib";

export function App() {
  const section = currentSection();
  const selected = useMemo(selectedBurnlist, [window.location.pathname, window.location.search]);
  const [filter, setFilter] = useState(() => filterFromUrl(FILTERS));
  const dashboardSection = section === "streaming-diff" ? "burnlists" : section;
  const { projects, progress, error, loading } = useDashboardData({ section: dashboardSection, selected });
  const visibleBurnlistCount = projects.reduce((total, project) => total + project.entries.filter((entry) => filter === "all" || entry.status === filter).length, 0);
  const visibleProjectCount = projects.filter((project) => project.entries.some((entry) => filter === "all" || entry.status === filter)).length;

  const updateFilter = (nextFilter: Filter) => {
    const url = new URL(window.location.href);
    if (nextFilter === "all") url.searchParams.delete("filter");
    else url.searchParams.set("filter", nextFilter);
    url.searchParams.delete("page");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    setFilter(nextFilter);
  };

  const fullLayout = ["differential-testing", "model-lab", "performance-tracing", "streaming-diff", "visual-parity", "custom-oven"].includes(section) || selected;

  return (
    <div className="dashboard-app">
      <AppHeader detail={progress} section={section} />
      <main className="dashboard-main" data-layout={fullLayout ? "full" : "index"} data-section={section}>
        {section === "differential-testing" ? <DifferentialTestingOvenPage /> : section === "model-lab" ? <ModelLabPage /> : section === "performance-tracing" ? <PerformanceTracingOvenPage /> : section === "streaming-diff" ? <StreamingDiff projects={projects} projectsLoading={loading} /> : section === "visual-parity" ? <VisualParityPage /> : section === "custom-oven" ? <CustomOvenView /> : section === "new-oven" ? <NewOvenPage /> : section === "run-burn" ? <RunBurnPage /> : selected ? (
          error ? <DashboardError message={error} /> : loading && !progress ? <EmptyState title="Loading progress" detail="Reading the selected Burnlist." /> : progress ? (
            <ChecklistOvenView data={progress} />
          ) : <EmptyState title="Choose a Burnlist" detail="Select an item from the list to inspect its progress." icon={ListChecks} />
        ) : (
          <section className="dashboard-index">
            <div className="dashboard-index-header">
              <div className="dashboard-index-heading">
                <h1 className="dashboard-index-title">Burnlists</h1>
                <p className="dashboard-index-summary">{visibleBurnlistCount} Burnlists in {visibleProjectCount} {visibleProjectCount === 1 ? "project" : "projects"}</p>
              </div>
              <Filters filter={filter} onFilterChange={updateFilter} />
            </div>
            {error ? <DashboardError message={error} /> : projects.length && visibleBurnlistCount ? (
              <div className="dashboard-project-groups"><BurnlistTable showStatus={filter === "all"}>{projects.map((project) => <ProjectGroup filter={filter} key={project.canonicalRoot} project={project} />)}</BurnlistTable></div>
            ) : projects.length ? <EmptyState title="No Burnlists in this view" detail="Choose another lifecycle filter." /> : <EmptyState title="Nothing here yet" detail="Run `burnlist init` to initialize this repository." />}
          </section>
        )}
      </main>
    </div>
  );
}
