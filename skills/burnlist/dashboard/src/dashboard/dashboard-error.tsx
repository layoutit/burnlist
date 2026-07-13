import { AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function DashboardError({ message }: { message: string }) {
  return (
    <Card className="dashboard-error">
      <CardContent className="dashboard-error-content">
        <AlertTriangle className="dashboard-error-icon" />
        <p className="dashboard-error-message">{message}</p>
      </CardContent>
    </Card>
  );
}
