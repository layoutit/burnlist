import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@layout";
import { FileDiff } from "../FileDiff";
import type { StreamingDiffCard } from "@lib";
import { timestamp } from "../streaming-diff-time";

export function DiffCard({ card }: { card: StreamingDiffCard }) {
  const partial = card.status === "partial";
  return <Card className="streaming-diff-card">
    <CardHeader className="streaming-diff-card-header">
      <div>
        <CardTitle>{card.toolUseId}</CardTitle>
        <CardDescription><time dateTime={card.ts}>{timestamp(card.ts)}</time> · {card.revId}</CardDescription>
      </div>
      <Badge variant={partial ? "destructive" : "default"}>{card.status}</Badge>
    </CardHeader>
    <CardContent className="streaming-diff-card-content">
      {partial && <p className="streaming-diff-partial">{card.partialReason ?? "This revision is partial."}</p>}
      {card.files.length ? card.files.map((file) => <FileDiff file={file} key={file.path} />) : <p className="streaming-diff-file-meta">No file content was captured.</p>}
    </CardContent>
  </Card>;
}
