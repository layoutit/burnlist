import { detailItems, visualParityPayload } from "./detail-items";
import { compactTime, fitText, palette, visibleWindow } from "./theme";
import { useTerminalChrome } from "./terminal-chrome";
import type { BurnlistSummary, DetailItem, OvenDataSnapshot, OvenSummary, ProgressSnapshot } from "./types";

function Stat({ label, value, tone = palette.foreground }: { label: string; value: string; tone?: string }) {
  return <box flexGrow={1} flexDirection="column" paddingLeft={1}><text fg={palette.dim}>{label.toUpperCase()}</text><text fg={tone}>{value}</text></box>;
}

function OvenHeader({ active, lenses }: { active: OvenSummary | null; lenses: OvenSummary[] }) {
  const chrome = useTerminalChrome();
  return <box height={4} flexDirection="column" border={["bottom"]} borderColor={chrome.line}>
    <box height={2} flexDirection="row" alignItems="center" gap={2}>
      <text fg={palette.foreground}>{active?.name ?? "Oven"}</text><text fg={palette.dim}>{active?.contract ?? "No Oven selected"}</text>
    </box>
    <box height={1} flexDirection="row" gap={2}>
      {lenses.map((oven) => <text key={`${oven.repoKey ?? "built-in"}:${oven.id}`} fg={oven.id === active?.id ? palette.blue : palette.dim}>{oven.id === active?.id ? `[${oven.name}]` : oven.name}</text>)}
      {lenses.length > 1 ? <text fg={palette.dim}>[/] switch</text> : null}
    </box>
  </box>;
}

function ItemRows({ items, selected, height }: { items: DetailItem[]; selected: number; height: number }) {
  const chrome = useTerminalChrome();
  const window = visibleWindow(items, selected, Math.max(2, Math.floor(height / 2)));
  if (!items.length) return <text fg={palette.dim}>No navigable items are available.</text>;
  return <box flexGrow={1} flexDirection="column">
    {window.items.map((item, offset) => {
      const index = window.start + offset;
      const active = index === selected;
      const statusTone = item.status === "ACTIVE" || item.status === "PASS" ? palette.green : item.status === "FAIL" ? palette.red : palette.blue;
      return <box key={item.key} height={2} flexDirection="row" border={["bottom"]} borderColor={chrome.faintLine} backgroundColor={active ? chrome.surface : chrome.background}>
        <text fg={active ? palette.blue : chrome.background}>{active ? "▎" : " "}</text>
        <box width={10} paddingLeft={1}><text fg={statusTone}>{fitText(item.status, 8)}</text></box>
        <box width={12}><text fg={palette.soft}>{fitText(item.id, 11)}</text></box>
        <box flexGrow={1}><text fg={active ? palette.foreground : palette.muted}>{fitText(item.title, 44).trimEnd()}</text></box>
        {item.latest ? <box width={10}><text fg={palette.amber}>LATEST</text></box> : item.completedAt ? <box width={10}><text fg={palette.dim}>{compactTime(item.completedAt)}</text></box> : null}
      </box>;
    })}
  </box>;
}

function ChecklistOven({ progress, items, selected, height }: { progress: ProgressSnapshot | null; items: DetailItem[]; selected: number; height: number }) {
  const chrome = useTerminalChrome();
  if (!progress) return <box paddingTop={2}><text fg={palette.dim}>Checklist data is unavailable.</text></box>;
  return <box flexDirection="column" flexGrow={1}>
    <box height={4} flexDirection="row" alignItems="center" border={["bottom"]} borderColor={chrome.faintLine}>
      <Stat label="Progress" value={`${progress.percent}%`} tone={palette.green} /><Stat label="Done" value={String(progress.done)} /><Stat label="Remaining" value={String(progress.remaining)} /><Stat label="Warnings" value={String(progress.warnings?.length ?? 0)} tone={progress.warnings?.length ? palette.amber : palette.muted} />
    </box>
    <box height={3} paddingTop={1} flexDirection="row" gap={2}><text fg={palette.foreground}>Burnlist items</text><text fg={palette.dim}>↑/↓ inspect</text></box>
    <ItemRows items={items} selected={selected} height={height - 11} />
  </box>;
}

function VisualParityOven({ data, items, selected, height }: { data: OvenDataSnapshot | null; items: DetailItem[]; selected: number; height: number }) {
  const chrome = useTerminalChrome();
  const payload = visualParityPayload(data);
  if (!payload) return <box paddingTop={2}><text fg={palette.dim}>Visual Parity data is unavailable.</text></box>;
  const domain = payload.domains.find((entry) => entry.qualification === "target") ?? payload.domains[0]!;
  const rows = payload.comparisons.map((comparison) => comparison.domains[domain.id]).filter(Boolean);
  const passed = rows.filter((entry) => entry.status === "pass").length;
  const qualified = payload.comparisons.every((comparison) => comparison.status === "pass");
  return <box flexDirection="column" flexGrow={1}>
    <box height={3} flexDirection="row" alignItems="center" gap={2} border={["bottom"]} borderColor={chrome.faintLine}><text fg={qualified ? palette.green : palette.red}>{qualified ? "QUALIFIED" : "OPEN"}</text><text fg={palette.muted}>{domain.label}</text><text fg={palette.dim}>{`${passed}/${rows.length} frames pass`}</text></box>
    <box height={3} paddingTop={1} flexDirection="row" gap={2}><text fg={palette.foreground}>Current comparison state</text><text fg={palette.dim}>↑/↓ compare frames</text></box>
    <ItemRows items={items} selected={selected} height={height - 9} />
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
  return <box flexDirection="column" flexGrow={1}><OvenHeader active={active} lenses={lenses} />{active?.contract === "checklist-progress@1" ? <ChecklistOven progress={progress} items={items} selected={selected} height={height} /> : active?.id === "visual-parity" ? <VisualParityOven data={data} items={items} selected={selected} height={height} /> : <GenericOven active={active} burnlist={burnlist} data={data} />}</box>;
}
