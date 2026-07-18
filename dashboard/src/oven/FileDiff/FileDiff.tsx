import { Badge } from "@layout";
import { fileKindChip, isTextFileKind } from "@lib";
import type { StreamingDiffFile } from "@lib";

export function FileDiff({ file }: { file: StreamingDiffFile }) {
  const chip = fileKindChip(file.kind, file.meta);
  if (chip) {
    return <section className="streaming-diff-file">
      <div className="streaming-diff-file-head"><code>{file.path}</code><Badge variant="outline">{chip}</Badge></div>
      {(file.meta?.reason || file.meta?.bytes !== undefined) && <p className="streaming-diff-file-meta">{file.meta?.reason}{file.meta?.reason && file.meta?.bytes !== undefined ? " · " : ""}{file.meta?.bytes !== undefined ? `${file.meta.bytes} bytes` : ""}</p>}
    </section>;
  }
  return <section className="streaming-diff-file">
    <div className="streaming-diff-file-head"><code>{file.path}</code><Badge variant="secondary">{file.kind}</Badge></div>
    {isTextFileKind(file.kind) && file.diff !== undefined ? <pre className="streaming-diff-unified">{file.diff}</pre> : <p className="streaming-diff-file-meta">Diff content is unavailable.</p>}
  </section>;
}
