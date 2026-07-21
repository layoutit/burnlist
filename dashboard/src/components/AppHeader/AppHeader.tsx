import { Settings } from "lucide-react";
import { formatTime, type ChecklistProgressData } from "@lib";

const HEADER_LINKS = [
  { href: "/ovens/new", label: "New Oven", section: "new-oven" },
] as const;

const OVEN_SECTIONS = ["differential-testing", "model-lab", "performance-tracing", "streaming-diff", "visual-parity"];

export function AppHeader({ detail, section }: { detail: ChecklistProgressData | null; section: string }) {
  const title = section === "differential-testing" ? "Differential Testing"
    : section === "model-lab" ? "Model Lab"
      : section === "performance-tracing" ? "Performance Tracing"
        : section === "streaming-diff" ? "Streaming Diff"
          : section === "visual-parity" ? "Visual Parity" : detail?.title;
  return (
    <header className="dashboard-header">
      <div className="dashboard-header-inner">
        <a aria-label="Burnlist home" className="dashboard-brand" href="/">
          <img alt="" className="dashboard-brand-logo" src="/favicon.svg" />
          <span className="dashboard-brand-name">Burnlist</span>
        </a>
        {title && <div className="dashboard-oven-title">{title}</div>}
        <nav aria-label="Primary navigation" className="dashboard-primary-nav">
          {detail ? <time className="dashboard-detail-time" dateTime={detail.generatedAt}>{formatTime(detail.generatedAt)}</time> : !OVEN_SECTIONS.includes(section) && HEADER_LINKS.map((link, index) => (
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
