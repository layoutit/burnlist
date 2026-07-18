import type { ReactNode } from "react";
import { count, formatLogRelativeMinutes, percent } from "../../../../ovens/differential-testing/renderer/differential-testing-render.js";
import { LogTable } from "../LogTable";

const LOG_COLUMNS = ["Age", "Frame", "Result", "Delta", "Done"];
const LOG_ROW_LIMIT = 8;

export type DifferentialLogEntry = {
  timestamp: string;
  frame?: number | string | null;
  frames?: number | string | null;
  frameDelta?: number | string | null;
};

type DifferentialLogCell = { className: string; content: ReactNode };

export type DifferentialLogRows = {
  columns: string[];
  rows: { key: string; className: string; cells: DifferentialLogCell[] }[];
  placeholderCount: number;
};

function deltaContent(marker: string, resultText: string): ReactNode {
  return <span className="log-delta-content"><span className="log-delta-indicator">{marker}</span><span>{resultText}</span></span>;
}

export function buildDifferentialLogRows(entries: DifferentialLogEntry[], now = Date.now()): DifferentialLogRows {
  const visibleEntries = entries.slice(0, LOG_ROW_LIMIT);
  const rows = visibleEntries.map((entry, index) => {
    const frameDelta = entry.frameDelta === null || !Number.isFinite(Number(entry.frameDelta)) ? null : Number(entry.frameDelta);
    const stateClass = frameDelta > 0 ? "improved" : frameDelta < 0 ? "worsened" : "unchanged";
    const deltaPercent = frameDelta === null || !Number(entry.frames) ? null : Math.abs(frameDelta) / Number(entry.frames) * 100;
    const marker = stateClass === "improved" ? "▲" : stateClass === "worsened" ? "▼" : "⦁";
    const deltaText = deltaPercent === null ? "—" : percent(deltaPercent);
    const resultText = frameDelta === null ? "—" : count(Math.abs(frameDelta));
    const result = marker !== "⦁" ? deltaContent(marker, resultText) : resultText;
    const frame = !Number.isSafeInteger(Number(entry.frame)) ? "—" : count(entry.frame);
    const done = !Number.isSafeInteger(Number(entry.frame)) || !Number(entry.frames)
      ? "—"
      : `${Math.round(Math.max(0, Math.min(1, Number(entry.frame) / Number(entry.frames))) * 100)}%`;

    return {
      key: `${entry.timestamp ?? "entry"}-${index}`,
      className: `log-row ${stateClass} no-detail log-table-row`,
      cells: [
        { className: "log-table-cell age", content: formatLogRelativeMinutes(entry.timestamp, now) },
        { className: `log-table-cell failed ${stateClass}`, content: frame },
        { className: `log-table-cell result ${stateClass}`, content: result },
        { className: `log-table-cell delta ${stateClass}`, content: deltaText },
        { className: "log-table-cell done", content: done },
      ],
    };
  });

  return {
    columns: [...LOG_COLUMNS],
    rows,
    placeholderCount: Math.max(0, LOG_ROW_LIMIT - visibleEntries.length),
  };
}

export type DifferentialLogTableProps = {
  entries: DifferentialLogEntry[];
  now?: number;
};

export function DifferentialLogTable({ entries, now }: DifferentialLogTableProps) {
  return <LogTable {...buildDifferentialLogRows(entries, now)} />;
}
