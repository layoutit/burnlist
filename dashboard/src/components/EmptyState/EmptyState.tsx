import { CircleDotDashed } from "lucide-react";
import "./EmptyState.css";

export function EmptyState({ title, detail, icon: Icon = CircleDotDashed }: { title: string; detail: string; icon?: typeof CircleDotDashed }) {
  return (
    <div className="dashboard-empty-state">
      <div className="dashboard-empty-state-content">
        <span className="dashboard-empty-state-icon"><Icon className="dashboard-empty-state-icon-svg" aria-hidden="true" /></span>
        <h2 className="dashboard-empty-state-title">{title}</h2>
        <p className="dashboard-empty-state-detail">{detail}</p>
      </div>
    </div>
  );
}
