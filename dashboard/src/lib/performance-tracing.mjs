const metricDefinitions = [
  { id: "startup.ready", label: "startup.ready", metric: "startupReadyMs", budget: "startupReadyMs" },
  { id: "frame.p95", label: "frame.p95", metric: "p95FrameMs", budget: "p95FrameMs" },
  { id: "frame.p99", label: "frame.p99", metric: "p99FrameMs", budget: "p99FrameMs" },
  { id: "frame.max", label: "frame.max", metric: "maxFrameMs", budget: "maxFrameMs" },
  { id: "frame.over33", label: "frame.over33", metric: "over33msRatio", budget: "over33msRatio" },
  { id: "step.p95", label: "step.p95", metric: "p95StepCallMs", budget: "p95StepCallMs" },
];

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function reportHistory(report) {
  const fallback = [{
    runId: report.runId,
    generatedAt: report.generatedAt,
    status: report.status,
    comparisonKey: "current-report",
    metrics: report.metrics ?? {},
    budgets: report.budgets ?? {},
  }];
  if (!Array.isArray(report.history) || !report.history.length) return fallback;
  const current = [...report.history].reverse().find((point) => point.runId === report.runId
    && point.generatedAt === report.generatedAt) ?? report.history.at(-1);
  if (!current?.comparisonKey) return fallback;
  const comparable = report.history.filter((point) => point.comparisonKey === current.comparisonKey);
  return comparable.length ? comparable : fallback;
}

function passCount(point) {
  return metricDefinitions.reduce((total, definition) => {
    const actual = finite(point.metrics?.[definition.metric]);
    const limit = finite(point.budgets?.[definition.budget]);
    return total + (actual !== null && limit !== null && actual <= limit ? 1 : 0);
  }, 0);
}

export function adaptPerformanceTracingReport(report) {
  const history = reportHistory(report);
  const fields = metricDefinitions.map((definition) => {
    const samples = history.map((point, index) => {
      const actual = finite(point.metrics?.[definition.metric]);
      const limit = finite(point.budgets?.[definition.budget]);
      if (actual === null || limit === null) return [index, limit, actual, 3];
      return [index, limit, actual, actual <= limit ? 0 : 1];
    });
    const failedSampleCount = samples.filter((sample) => sample[3] === 1).length;
    const missingSampleCount = samples.filter((sample) => sample[3] !== 0 && sample[3] !== 1).length;
    const deltas = samples
      .map((sample) => sample[1] === null || sample[2] === null ? null : Math.abs(Number(sample[2]) - Number(sample[1])))
      .filter((value) => value !== null);
    return {
      id: definition.id,
      label: definition.label,
      samples,
      sampleLabels: history.map((point) => new Date(point.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })),
      failedSampleCount,
      missingSampleCount,
      trustStatus: missingSampleCount ? "blocked" : "pass",
      maxDelta: deltas.length ? Math.max(...deltas) : null,
      sourceOwner: `performance trace / ${definition.metric}`,
      semantics: { kind: "number", meaning: `${definition.metric} measured against ${definition.budget}` },
    };
  });

  const progress = history.map((point, index) => {
    const frame = passCount(point);
    const previous = index > 0 ? passCount(history[index - 1]) : null;
    return {
      timestamp: point.generatedAt,
      frame,
      frames: metricDefinitions.length,
      frameDelta: previous === null ? null : frame - previous,
    };
  });
  const log = history.map((point, index) => {
    const frame = passCount(point);
    const previous = index > 0 ? passCount(history[index - 1]) : null;
    const frameDelta = previous === null ? null : frame - previous;
    return {
      timestamp: point.generatedAt,
      frame,
      frames: metricDefinitions.length,
      frameDelta,
      firstFailingTick: null,
      result: frameDelta === null ? point.status === "pass" ? "pass" : "blocked" : frameDelta > 0 ? "improved" : frameDelta < 0 ? "worsened" : "unchanged",
    };
  }).reverse();
  const failedFields = fields.filter((field) => field.failedSampleCount > 0).length;
  const blockedFields = fields.filter((field) => field.missingSampleCount > 0).length;
  const frameTimingSeries = Array.isArray(report.runs?.[0]?.frameTiming?.series) ? report.runs[0].frameTiming.series : [];
  const frameLimit = finite(report.budgets?.p95FrameMs);
  const primaryChartSamples = frameTimingSeries.map((sample, index) => {
    const actual = finite(sample.frameMs);
    return [Number(sample.frame ?? index), frameLimit, actual, frameLimit === null || actual === null || actual <= frameLimit ? 0 : 1];
  });

  return {
    subtitle: report.runId ?? "retained performance trace",
    publishedAt: report.generatedAt,
    scenarioCatalog: {
      selectedScenarioId: report.scenario?.id ?? "performance-tracing",
      scenarios: [{ id: report.scenario?.id ?? "performance-tracing" }],
    },
    refresh: null,
    primaryChartTitle: "Frame timing",
    historyTitle: "History log",
    primaryChartField: {
      id: "frame.p95.history",
      label: "frame.timing",
      samples: primaryChartSamples,
    },
    progress,
    log,
    fields,
    summary: {
      fields: { total: fields.length, failed: failedFields, blocked: blockedFields },
      frames: {
        total: history.length,
        failed: history.filter((point) => point.status !== "pass").length,
        blocked: 0,
      },
    },
  };
}
