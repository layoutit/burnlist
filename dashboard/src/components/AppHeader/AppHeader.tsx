import { Settings } from "lucide-react";

const HEADER_LINKS = [
  { href: "/ovens/new", label: "New Oven", section: "new-oven" },
] as const;

export function AppHeader({ section }: { section: string }) {
  return (
    <header className="dashboard-header">
      <div className="dashboard-header-inner">
        <a aria-label="Burnlist home" className="dashboard-brand" href="/">
          <img alt="" className="dashboard-brand-logo" src="/favicon.svg" />
          <span className="dashboard-brand-name">Burnlist</span>
        </a>
        {section === "differential-testing" && <div className="dashboard-oven-title">Differential Testing</div>}
        {section === "performance-tracing" && <div className="dashboard-oven-title">Performance Tracing</div>}
        {section === "streaming-diff" && <div className="dashboard-oven-title">Streaming Diff</div>}
        <nav aria-label="Primary navigation" className="dashboard-primary-nav">
          {section !== "differential-testing" && section !== "performance-tracing" && section !== "streaming-diff" && HEADER_LINKS.map((link, index) => (
            <span className="dashboard-primary-nav-item" key={link.href}>
              {index > 0 && <span aria-hidden="true" className="dashboard-primary-nav-separator">·</span>}
              <a aria-label={link.label} aria-current={section === link.section ? "page" : undefined} className="dashboard-primary-nav-link" href={link.href} title={link.label}>
                <Settings aria-hidden="true" className="dashboard-primary-nav-icon" />
              </a>
            </span>
          ))}
        </nav>
      </div>
    </header>
  );
}
