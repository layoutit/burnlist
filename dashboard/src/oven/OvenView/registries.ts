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
import { delta as formatDelta, percent as formatPercent } from "../visual-parity-format";

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
  percent: (value) => formatPercent(value as number),
  delta: (value) => formatDelta(value as number),
}));

const kpiIconProps = { "aria-hidden": "true", className: "driving-parity-kpi-gauge driving-parity-kpi-scenario-icon" };

export const iconRegistry: Record<string, ReactNode> = Object.freeze(Object.assign(Object.create(null), {
  ClipboardList: createElement(ClipboardList, kpiIconProps),
  Clock3: createElement(Clock3, kpiIconProps),
  Gauge: createElement(Gauge, kpiIconProps),
  TimerReset: createElement(TimerReset, kpiIconProps),
  ArrowLeft: createElement(ArrowLeft, { "aria-hidden": "true" }),
}));
