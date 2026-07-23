import { detailItems, visualParityPayload } from "./detail-items";
import { compactTime, fitText, palette, visibleWindow } from "./theme";
import { TableCell, TableLine } from "./table-view";
import type { BurnlistSummary, DetailItem, OvenDataSnapshot, OvenSummary, ProgressSnapshot } from "./types";

function OvenHeader({ active, lenses }: { active: OvenSummary | null; lenses: OvenSummary[] }) {
  return <box height={3} flexDirection="column" paddingLeft={1}>
    <box height={1} flexDirection="row" alignItems="center" gap={2}>
      <text fg={palette.foreground}>{active?.name ?? "Oven"}</text><text fg={palette.dim}>{active?.contract ?? "No Oven selected"}</text>
    </box>
    <box height={1} flexDirection="row" gap={2}>
      {lenses.map((oven) => <text key={`${oven.repoKey ?? "built-in"}:${oven.id}`} fg={oven.id === active?.id ? palette.blue : palette.dim}>{oven.id === active?.id ? `[${oven.name}]` : oven.name}</text>)}
      {lenses.length > 1 ? <text fg={palette.dim}>[/] switch</text> : null}
    </box>
  </box>;
}

function ItemRows({ items, selected, height }: { items: DetailItem[]; selected: number; height: number }) {
  const window = visibleWindow(items, selected, Math.max(2, height - 1));
  if (!items.length) return <text fg={palette.dim}>No navigable items are available.</text>;
  return <box flexGrow={1} flexDirection="column" minHeight={0} overflow="hidden">
    <TableLine header>
      <TableCell width={9} color={palette.dim}>STATE</TableCell>
      <TableCell width={9} color={palette.dim}>ID</TableCell>
      <TableCell grow={1} color={palette.dim}>ITEM</TableCell>
      <TableCell width={8} color={palette.dim}>UPDATED</TableCell>
    </TableLine>
    {window.items.map((item, offset) => {
      const index = window.start + offset;
      const active = index === selected;
      const statusTone = item.status === "ACTIVE" || item.status === "PASS" ? palette.green : item.status === "FAIL" ? palette.red : palette.blue;
      return <TableLine key={item.key} selected={active}>
        <TableCell width={9} color={statusTone}>{item.status}</TableCell>
        <TableCell width={9} color={palette.soft}>{item.id}</TableCell>
        <TableCell grow={1} color={active ? palette.foreground : palette.muted}>{fitText(item.title, 44).trimEnd()}</TableCell>
        <TableCell width={8} color={item.latest ? palette.amber : palette.dim}>{item.latest ? "LATEST" : item.completedAt ? compactTime(item.completedAt) : ""}</TableCell>
      </TableLine>;
    })}
  </box>;
}

function ChecklistOven({ progress, items, selected, height }: { progress: ProgressSnapshot | null; items: DetailItem[]; selected: number; height: number }) {
  if (!progress) return <box paddingTop={2}><text fg={palette.dim}>Checklist data is unavailable.</text></box>;
  return <box flexDirection="column" flexGrow={1}>
    <box height={2} flexDirection="row" alignItems="center" paddingLeft={1} gap={2}>
      <text fg={palette.green}>{`${progress.percent}%`}</text>
      <text fg={palette.muted}>{`${progress.done} done · ${progress.remaining} remaining`}</text>
      {progress.warnings?.length ? <text fg={palette.amber}>{`${progress.warnings.length} warnings`}</text> : null}
    </box>
    <box height={2} paddingLeft={1} flexDirection="row" alignItems="center" gap={2}><text fg={palette.foreground}>Items</text><text fg={palette.dim}>↑/↓ inspect</text></box>
    <ItemRows items={items} selected={selected} height={Math.max(1, height - 4)} />
  </box>;
}

function VisualParityOven({ data, items, selected, height }: { data: OvenDataSnapshot | null; items: DetailItem[]; selected: number; height: number }) {
  const payload = visualParityPayload(data);
  if (!payload) return <box paddingTop={2}><text fg={palette.dim}>Visual Parity data is unavailable.</text></box>;
  const domain = payload.domains.find((entry) => entry.qualification === "target") ?? payload.domains[0]!;
  const rows = payload.comparisons.map((comparison) => comparison.domains[domain.id]).filter(Boolean);
  const passed = rows.filter((entry) => entry.status === "pass").length;
  const qualified = payload.comparisons.every((comparison) => comparison.status === "pass");
  return <box flexDirection="column" flexGrow={1}>
    <box height={2} flexDirection="row" alignItems="center" paddingLeft={1} gap={2}><text fg={qualified ? palette.green : palette.red}>{qualified ? "QUALIFIED" : "OPEN"}</text><text fg={palette.muted}>{domain.label}</text><text fg={palette.dim}>{`${passed}/${rows.length} frames pass`}</text></box>
    <box height={2} paddingLeft={1} flexDirection="row" alignItems="center" gap={2}><text fg={palette.foreground}>Frames</text><text fg={palette.dim}>↑/↓ compare</text></box>
    <ItemRows items={items} selected={selected} height={Math.max(1, height - 4)} />
  </box>;
}

function GenericOven({ active, burnlist, data }: { active: OvenSummary | null; burnlist: BurnlistSummary | null; data: OvenDataSnapshot | null }) {
  const payload = data?.payload;
  const keys = payload && typeof payload === "object" ? Object.keys(payload).slice(0, 8) : [];
  return <box flexDirection="column" paddingTop={2} gap={1}><text fg={palette.foreground}>{active?.description ?? "No renderer is registered for this Oven."}</text><text fg={palette.muted}>{burnlist?.progressLabel ?? ""}</text>{keys.length ? <text fg={palette.dim}>{`Payload: ${keys.join(" · ")}`}</text> : null}</box>;
}

export function OvenPane({ active, lenses, progress, data, burnlist, height, itemIndex }: {
  active: OvenSummary | null;
  lenses: OvenSummary[];
  progress: ProgressSnapshot | null;
  data: OvenDataSnapshot | null;
  burnlist: BurnlistSummary | null;
  height: number;
  itemIndex: number;
}) {
  const items = detailItems(active, progress, data);
  const selected = Math.max(0, Math.min(itemIndex, Math.max(0, items.length - 1)));
  const bodyHeight = Math.max(1, height - 3);
  return <box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
    <OvenHeader active={active} lenses={lenses} />
    {active?.contract === "checklist-progress@1"
      ? <ChecklistOven progress={progress} items={items} selected={selected} height={bodyHeight} />
      : active?.id === "visual-parity"
        ? <VisualParityOven data={data} items={items} selected={selected} height={bodyHeight} />
        : <GenericOven active={active} burnlist={burnlist} data={data} />}
  </box>;
}
