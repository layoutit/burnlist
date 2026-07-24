import { GlyphImage } from "./glyph-image";
import { visualParityPayload } from "./detail-items";
import { compactTime, fitText, palette } from "./theme";
import type { DetailItem, OvenDataSnapshot, OvenSummary, ProgressSnapshot } from "./types";

function ChecklistItem({ item, width }: { item: DetailItem; width: number }) {
  const fields = Object.entries(item.fields ?? {});
  return <box flexGrow={1} flexDirection="column" padding={1} gap={1}>
    <box height={2} flexDirection="row" alignItems="center">
      <box width={14}><text fg={item.kind === "active" ? palette.green : palette.blue}>{fitText(item.status, 14).trimEnd()}</text></box>
      <box flexGrow={1}><text fg={palette.foreground}>{fitText(item.id, Math.max(1, width - 8)).trimEnd()}</text></box>
      {item.latest ? <text fg={palette.amber}>LATEST</text> : null}
    </box>
    <text fg={palette.foreground}>{fitText(item.title, Math.max(1, width - 8)).trimEnd()}</text>
    {item.completedAt ? <text fg={palette.dim}>{fitText(`Completed ${compactTime(item.completedAt)} · ${item.completedAt}`, Math.max(1, width - 8)).trimEnd()}</text> : null}
    {fields.length ? <box paddingTop={1}><text fg={palette.dim}>ITEM FIELDS</text></box> : null}
    {fields.map(([label, value]) => <box key={label} flexDirection="column" paddingBottom={1}>
      <text fg={palette.blue}>{fitText(label.toUpperCase(), Math.max(1, width - 8)).trimEnd()}</text>
      <text fg={palette.muted}>{fitText(value, Math.max(24, width - 8)).trimEnd()}</text>
    </box>)}
    {item.detail ? <box flexDirection="column" paddingTop={1}>
      <text fg={palette.dim}>COMPLETION DETAIL</text>
      {item.detail.split(/\r?\n/u).filter(Boolean).slice(0, 8).map((line, index) => <text key={index} fg={palette.muted}>{fitText(line, Math.max(24, width - 8)).trimEnd()}</text>)}
    </box> : null}
    {!fields.length && !item.detail ? <text fg={palette.dim}>No additional item detail was recorded.</text> : null}
  </box>;
}

function VisualFrame({ item, data, domainIndex, width, height }: {
  item: DetailItem;
  data: OvenDataSnapshot | null;
  domainIndex: number;
  width: number;
  height: number;
}) {
  const payload = visualParityPayload(data);
  const comparison = payload?.comparisons[item.comparisonIndex ?? -1];
  const domain = payload?.domains[domainIndex] ?? payload?.domains.find((entry) => entry.qualification === "target") ?? payload?.domains[0];
  const result = comparison && domain ? comparison.domains[domain.id] : null;
  if (!comparison || !domain || !result) return <box padding={2}><text fg={palette.dim}>Frame detail is unavailable.</text></box>;
  const imageWidth = Math.max(8, Math.floor((width - 10) / 3));
  const imageHeight = Math.max(3, height - 13);
  const images = [result.reference, result.candidate, result.diff];
  return <box flexGrow={1} flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1}>
    <box height={2} flexDirection="row" alignItems="center" gap={2}>
      <text fg={result.status === "pass" ? palette.green : palette.red}>{fitText(result.status.toUpperCase(), 8).trimEnd()}</text>
      <text fg={palette.foreground}>{fitText(`${item.id} · ${comparison.label}`, Math.max(1, width - 8)).trimEnd()}</text>
      {item.latest ? <text fg={palette.amber}>LATEST</text> : null}
    </box>
    <box height={3} flexDirection="row" alignItems="center" gap={3}>
      <text fg={palette.blue}>{fitText(`${domain.label} · ${domain.qualification}`, Math.max(1, width - 8)).trimEnd()}</text>
      <text fg={palette.muted}>{fitText(`${result.difference.changedPixels} changed pixels · ${(result.difference.ratio * 100).toFixed(2)}%`, Math.max(1, width - 8)).trimEnd()}</text>
      <text fg={palette.dim}>{fitText(`mean Δ ${result.difference.meanAbsoluteDelta.toFixed(2)} · max Δ ${result.difference.maximumAbsoluteDelta.toFixed(2)}`, Math.max(1, width - 8)).trimEnd()}</text>
    </box>
    <box height={2}><text fg={palette.dim}>{fitText(domain.tolerance?.rationale ?? "Exact zero tolerance.", Math.max(1, width - 8)).trimEnd()}</text></box>
    <box flexGrow={1} flexDirection="row" gap={2}>
      {images.map((image, index) => <box key={index} width={imageWidth} flexDirection="column" alignItems="center">
        <box height={2}><text fg={palette.soft}>{fitText(image.label, imageWidth).trimEnd()}</text></box>
        <box width={imageWidth} height={imageHeight} alignItems="center" justifyContent="center">
          <GlyphImage source={image.src} width={imageWidth} height={imageHeight} />
        </box>
        <text fg={palette.dim}>{fitText(`${image.width}×${image.height}`, imageWidth).trimEnd()}</text>
      </box>)}
    </box>
  </box>;
}

export function ItemDetail({ item, oven, progress, data, domainIndex, width, height }: {
  item: DetailItem | null;
  oven: OvenSummary | null;
  progress: ProgressSnapshot | null;
  data: OvenDataSnapshot | null;
  domainIndex: number;
  width: number;
  height: number;
}) {
  if (!item) return <box padding={2}><text fg={palette.dim}>No item is selected.</text></box>;
  if (item.kind === "visual-frame") return <VisualFrame item={item} data={data} domainIndex={domainIndex} width={width} height={height} />;
  if (oven?.contract === "checklist-progress@1" && progress) return <ChecklistItem item={item} width={width} />;
  return <box padding={2}><text fg={palette.dim}>This Oven has no item renderer.</text></box>;
}
