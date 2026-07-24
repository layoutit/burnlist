import { createElement, type ComponentType, type ReactNode } from "react";
import { ArrowLeft, ClipboardList, Clock3, Gauge, TimerReset } from "lucide-react";
import { DiffCard } from "../DiffCard";
import { DiffCardList } from "../DiffCardList";
import { DomainNote } from "../DomainNote";
import { DomainTabs } from "../DomainTabs";
import { FeedList } from "../FeedList";
import { FileDiff } from "../FileDiff";
import { StreamingDiffHeading } from "../StreamingDiffHeading";
import { FrameCard } from "../FrameCard";
import { ImageTriptych } from "../ImageTriptych";
import { KpiItem } from "../KpiItem";
import { KpiStrip } from "../KpiStrip";
import { LogTable } from "../LogTable";
import { MetricTiles } from "../MetricTiles";
import { ProgressDonut } from "../ProgressDonut";
import { SectionHeader } from "../SectionHeader";
import { VerdictHeader } from "../VerdictHeader";
import { Box } from "../Box/Box";
import { ChecklistBurnPanel } from "../ChecklistBurnPanel/ChecklistBurnPanel";
import { ChecklistEventCards } from "../ChecklistEventCards/ChecklistEventCards";
import { ChecklistLedger } from "../ChecklistLedger/ChecklistLedger";
import { ChecklistProgressValue } from "../ChecklistProgressValue/ChecklistProgressValue";
import { BurnDonut } from "../BurnDonut/BurnDonut";
import { DifferentialKpiStrip } from "../DifferentialKpiStrip/DifferentialKpiStrip";
import { DifferentialLogTable } from "../DifferentialLogTable/DifferentialLogTable";
import { DifferentialEmptyState } from "../DifferentialEmptyState/DifferentialEmptyState";
import { DifferentialFrameDeltaChart, DifferentialProgressChart } from "../DifferentialProgressChart";
import { WaffleMetric } from "../WaffleMetric/WaffleMetric";
import { ovenFormatRegistry } from "../../../../src/ovens/oven-value-runtime.mjs";

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
  DiffCardList,
  FileDiff,
  StreamingDiffHeading,
  Box,
  ChecklistBurnPanel,
  ChecklistEventCards,
  ChecklistLedger,
  ChecklistProgressValue,
  BurnDonut,
  DifferentialKpiStrip,
  DifferentialLogTable,
  DifferentialEmptyState,
  DifferentialFrameDeltaChart,
  DifferentialProgressChart,
  WaffleMetric,
}));

export const formatRegistry: Record<string, (value: unknown) => unknown> = Object.freeze(Object.assign(Object.create(null), {
  identity: ovenFormatRegistry.identity,
  plain: ovenFormatRegistry.plain,
  number: ovenFormatRegistry.number,
  percent: ovenFormatRegistry.percent,
  delta: ovenFormatRegistry.delta,
  "ratio-to-percent": ovenFormatRegistry["ratio-to-percent"],
  length: ovenFormatRegistry.length,
  "time-only": ovenFormatRegistry["time-only"],
  "relative-age": ovenFormatRegistry["relative-age"],
  "progress-headline": ovenFormatRegistry["progress-headline"],
  "last-progress-percent": ovenFormatRegistry["last-progress-percent"],
  "last-failed-count": ovenFormatRegistry["last-failed-count"],
  "last-failed-percent": ovenFormatRegistry["last-failed-percent"],
  "last-frame-delta": ovenFormatRegistry["last-frame-delta"],
  "last-delta-percent": ovenFormatRegistry["last-delta-percent"],
  "index-by-id": ovenFormatRegistry["index-by-id"],
  "telemetry-availability": ovenFormatRegistry["telemetry-availability"],
}));

const kpiIconProps = { "aria-hidden": "true", className: "driving-parity-kpi-gauge driving-parity-kpi-scenario-icon" };

export const iconRegistry: Record<string, ReactNode> = Object.freeze(Object.assign(Object.create(null), {
  ClipboardList: createElement(ClipboardList, kpiIconProps),
  Clock3: createElement(Clock3, kpiIconProps),
  Gauge: createElement(Gauge, kpiIconProps),
  TimerReset: createElement(TimerReset, kpiIconProps),
  ArrowLeft: createElement(ArrowLeft, { "aria-hidden": "true" }),
}));
