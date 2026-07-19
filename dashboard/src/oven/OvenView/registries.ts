import { createElement, type ComponentType, type ReactNode } from "react";
import { ArrowLeft, ClipboardList, Clock3, Gauge, TimerReset } from "lucide-react";
import { DiffCard } from "../DiffCard";
import { DomainNote } from "../DomainNote";
import { DomainTabs } from "../DomainTabs";
import { FeedList } from "../FeedList";
import { FileDiff } from "../FileDiff";
import { FrameCard } from "../FrameCard";
import { ImageTriptych } from "../ImageTriptych";
import { KpiItem } from "../KpiItem";
import { KpiStrip } from "../KpiStrip";
import { LogTable } from "../LogTable";
import { MetricTiles } from "../MetricTiles";
import { ProgressDonut } from "../ProgressDonut";
import { SectionHeader } from "../SectionHeader";
import { VerdictHeader } from "../VerdictHeader";
import { delta as formatDelta, percent as formatPercent } from "../utils/visual-parity-format";

function number(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(parsed) : "";
}

function ratioToPercent(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed * 100 : undefined;
}

function length(value: unknown): number | undefined {
  return typeof value === "string" || Array.isArray(value) ? value.length : undefined;
}

function parseDate(value: unknown): Date | undefined {
  if (value instanceof Date) return Number.isNaN(value.valueOf()) ? undefined : value;
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date;
}

function timeOnly(value: unknown): string {
  const date = parseDate(value);
  return date ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "";
}

function relativeAge(value: unknown): string {
  const date = parseDate(value);
  if (!date) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - date.valueOf()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

export const componentRegistry: Record<string, ComponentType<any>> = Object.freeze(Object.assign(Object.create(null), {
  KpiStrip,
  KpiItem,
  ProgressDonut,
  SectionHeader,
  LogTable,
  MetricTiles,
  VerdictHeader,
  DomainTabs,
  DomainNote,
  FrameCard,
  ImageTriptych,
  FeedList,
  DiffCard,
  FileDiff,
}));

export const formatRegistry: Record<string, (value: unknown) => unknown> = Object.freeze(Object.assign(Object.create(null), {
  identity: (value) => value,
  plain: (value) => value,
  number,
  percent: (value) => value === null || value === undefined ? "" : formatPercent(value as number),
  delta: (value) => value === null || value === undefined ? "" : formatDelta(value as number),
  "ratio-to-percent": ratioToPercent,
  length,
  "time-only": timeOnly,
  "relative-age": relativeAge,
}));

const kpiIconProps = { "aria-hidden": "true", className: "driving-parity-kpi-gauge driving-parity-kpi-scenario-icon" };

export const iconRegistry: Record<string, ReactNode> = Object.freeze(Object.assign(Object.create(null), {
  ClipboardList: createElement(ClipboardList, kpiIconProps),
  Clock3: createElement(Clock3, kpiIconProps),
  Gauge: createElement(Gauge, kpiIconProps),
  TimerReset: createElement(TimerReset, kpiIconProps),
  ArrowLeft: createElement(ArrowLeft, { "aria-hidden": "true" }),
}));
