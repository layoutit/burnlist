import { AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@layout";
import "./DashboardError.css";

export function DashboardError({ message }: { message: string }) {
  return (
    <Card className="dashboard-error" role="alert">
      <CardContent className="dashboard-error-content">
        <AlertTriangle aria-hidden="true" className="dashboard-error-icon" />
        <p className="dashboard-error-message">{message}</p>
      </CardContent>
    </Card>
  );
}
