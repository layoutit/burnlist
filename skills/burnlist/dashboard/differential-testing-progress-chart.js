// Canonical Differential Testing progress chart.
// The Oven maps generic history into the chart input; rendering stays source-identical.

const isDrivingParityPage = true;
let chartTimeRange = null;
const failedChartBaseline = "zero";

function formatClockTime(time, includeSeconds = false) {
  const options = { hour: "2-digit", minute: "2-digit", hour12: false };
  if (includeSeconds) options.second = "2-digit";
  return new Date(time).toLocaleTimeString([], options);
}

function createCompactTimeScale(points, minTime, maxTime) {
  const idleThresholdMs = 30 * 60_000;
  const compactIdleGapMs = 8 * 60_000;
  const anchors = [...new Set([
    minTime,
    ...points.map((point) => Number(point.time)).filter((time) => Number.isFinite(time) && time > minTime && time < maxTime),
    maxTime,
  ])].sort((left, right) => left - right);
  const segments = [];
  let displayEnd = 0;
  for (let index = 1; index < anchors.length; index += 1) {
    const start = anchors[index - 1];
    const end = anchors[index];
    const elapsed = Math.max(0, end - start);
    const displayElapsed = elapsed > idleThresholdMs ? compactIdleGapMs : elapsed;
    segments.push({ start, end, displayStart: displayEnd, displayEnd: displayEnd + displayElapsed });
    displayEnd += displayElapsed;
  }
  const project = (time) => {
    const clamped = Math.max(minTime, Math.min(maxTime, Number(time)));
    const segment = segments.find((candidate) => clamped <= candidate.end) ?? segments.at(-1);
    if (!segment || segment.end <= segment.start) return 0;
    const ratio = (clamped - segment.start) / (segment.end - segment.start);
    return segment.displayStart + (segment.displayEnd - segment.displayStart) * ratio;
  };
  const unproject = (displayTime) => {
    const clamped = Math.max(0, Math.min(displayEnd, Number(displayTime)));
    const segment = segments.find((candidate) => clamped <= candidate.displayEnd) ?? segments.at(-1);
    if (!segment || segment.displayEnd <= segment.displayStart) return minTime;
    const ratio = (clamped - segment.displayStart) / (segment.displayEnd - segment.displayStart);
    return segment.start + (segment.end - segment.start) * ratio;
  };
  const ticks = (count) => {
    if (count <= 1) return [minTime];
    return Array.from(
      { length: count },
      (_, index) => unproject((displayEnd * index) / (count - 1)),
    );
  };
  return { span: Math.max(1, displayEnd), project, ticks, unproject };
}

export function renderDifferentialTestingProgressChart(svg, history, { mode = "failed", timeScale = "compact" } = {}) {
  if (!svg || typeof svg.replaceChildren !== "function") return;
  const measuredWidth = Math.round(svg.getBoundingClientRect().width || svg.parentElement?.getBoundingClientRect().width || svg.clientWidth || 640);
  const width = Math.max(360, measuredWidth);
  const measuredHeight = Math.round(svg.getBoundingClientRect().height || svg.clientHeight || parseFloat(getComputedStyle(svg).height) || 200);
  const height = Math.max(160, measuredHeight);
  svg.setAttribute("viewBox", "0 0 " + width + " " + height);
  const pad = {
    left: svg.id === "progress-chart" ? 3 : 0,
    right: 0,
    top: svg.id === "progress-chart" ? 0 : 18,
    bottom: svg.id === "progress-chart" ? (isDrivingParityPage ? 0 : 28) : 24,
  };
  const axisLabelWidth = 44;
  const yAxisInsidePlot = isDrivingParityPage;
  const seriesPad = { left: yAxisInsidePlot ? 0 : axisLabelWidth, right: 0 };
  const tickPad = { left: seriesPad.left, right: seriesPad.right };
  const innerWidth = width - seriesPad.left - seriesPad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const verticalLineBottom = height - (isDrivingParityPage ? 22 : pad.bottom);
  const points = history
    .map((point) => {
      const drivingParityTime = Date.parse(point.drivingParityGeneratedAt);
      return {
        time: Date.parse(point.time),
        drivingParityTime: Number.isFinite(drivingParityTime) ? drivingParityTime : null,
        percent: Number(point.percent),
        done: Number(point.done),
        remaining: Number(point.remaining),
        total: Number(point.total),
        drivingParityFailedFieldPercent: Number(point.drivingParityFailedFieldPercent),
        drivingParityFailedFields: Number(point.drivingParityFailedFields),
        drivingParityAllFields: Number(point.drivingParityAllFields),
        drivingParityFrames: Number(point.drivingParityFrames),
        drivingParityFailedStatePointPercent: Number(point.drivingParityFailedStatePointPercent),
        drivingParityStateFailures: Number(point.drivingParityStateFailures),
        drivingParityActiveComparablePoints: Number(point.drivingParityActiveComparablePoints),
        drivingParityEventMarker: String(point.drivingParityEventMarker || ""),
        drivingParityEventTitle: String(point.drivingParityEventTitle || ""),
      };
    })
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.percent))
    .sort((a, b) => a.time - b.time);
  const now = Date.now();
  const rawSeries = points.length ? points : [{ time: now, percent: 0, done: 0, remaining: 0, total: 0 }];
  const rawMinTime = Math.min(...rawSeries.map((point) => point.time));
  const rawMaxTime = Math.max(...rawSeries.map((point) => point.time));
  const isPrimaryProgressChart = svg.id === "progress-chart";
  const effectiveChartMode = isPrimaryProgressChart ? mode : "progress";
  const isDeltaChart = effectiveChartMode === "delta";
  const isFailedChart = effectiveChartMode === "failed" || isDeltaChart;
  const compactTimeScale = isPrimaryProgressChart && timeScale === "compact";
  const useRangeZoom = svg.id === "progress-chart" && !compactTimeScale;
  let minTime = rawMinTime;
  let maxTime = rawMaxTime;
  if (useRangeZoom && chartTimeRange) {
    const rangeStart = Math.max(rawMinTime, Math.min(chartTimeRange.start, chartTimeRange.end));
    const rangeEnd = Math.min(rawMaxTime, Math.max(chartTimeRange.start, chartTimeRange.end));
    if (Number.isFinite(rangeStart) && Number.isFinite(rangeEnd) && rangeEnd - rangeStart > 1000) {
      minTime = rangeStart;
      maxTime = rangeEnd;
    } else {
      chartTimeRange = null;
    }
  }
  const autoTimeDomain = !(useRangeZoom && chartTimeRange);
  const latestDrivingParityFrames = [...points]
    .reverse()
    .map((point) => Number(point.drivingParityFrames))
    .find(Number.isFinite);
  const sameFailedChartBucketPoint = (point) => {
    if (!isFailedChart) return true;
    if (Number.isFinite(latestDrivingParityFrames) && Number(point.drivingParityFrames) !== latestDrivingParityFrames) return false;
    return true;
  };
  const failedFieldRawValueForPoint = (point) => {
    const stateFailures = Number(point.drivingParityStateFailures);
    if (Number.isFinite(stateFailures)) return Math.max(0, stateFailures);
    return Math.max(0, Math.min(100, Number(point.drivingParityFailedFieldPercent)));
  };
  const overallDeviationRatioForPoint = (point) => {
    const failures = Number(point.drivingParityStateFailures);
    const fields = Number(point.drivingParityAllFields);
    const frames = Number(point.drivingParityFrames);
    const comparableSamples = fields * frames;
    return Number.isFinite(failures) && Number.isFinite(comparableSamples) && comparableSamples > 0
      ? failures / comparableSamples
      : NaN;
  };
  const failedFieldValueForPoint = (point) =>
    isDeltaChart && Number.isFinite(Number(point.drivingParityDeltaValue))
      ? Number(point.drivingParityDeltaValue)
      : failedFieldRawValueForPoint(point);
  const failedTotalPercentForPoint = (point) => {
    const percent = Number(point.drivingParityFailedStatePointPercent);
    if (Number.isFinite(percent)) return Math.max(0, Math.min(100, percent));
    const failures = Number(point.drivingParityStateFailures);
    const total = Number(point.drivingParityActiveComparablePoints);
    if (Number.isFinite(failures) && Number.isFinite(total) && total > 0) {
      return Math.max(0, Math.min(100, (failures / total) * 100));
    }
    return NaN;
  };
  const failedChartPoint = (point) => ({
    ...point,
    time: Number.isFinite(point.drivingParityTime) ? point.drivingParityTime : point.time,
  });
  const failedChartPoints = (sourcePoints) => {
    const collapsed = [];
    for (const point of sourcePoints.map(failedChartPoint).sort((a, b) => a.time - b.time)) {
      const previous = collapsed.at(-1);
      if (
        previous &&
        previous.time === point.time &&
        Number(previous.drivingParityFrames) === Number(point.drivingParityFrames) &&
        failedFieldRawValueForPoint(previous) === failedFieldRawValueForPoint(point)
      ) {
        continue;
      }
      collapsed.push(point);
    }
    return collapsed;
  };
  const failedStatePointPoints =
    isFailedChart
      ? failedChartPoints(points.filter((point) => sameFailedChartBucketPoint(point) && Number.isFinite(point.drivingParityStateFailures)))
      : [];
  const failedFieldFallbackPoints =
    isFailedChart && !failedStatePointPoints.length
      ? failedChartPoints(points.filter((point) => sameFailedChartBucketPoint(point) && Number.isFinite(point.drivingParityFailedFieldPercent)))
      : [];
  const withoutBacktrackedFailedSpikes = (sourcePoints) => {
    if (!isFailedChart || sourcePoints.length < 3) return sourcePoints;
    const kept = [];
    let index = 0;
    while (index < sourcePoints.length) {
      const point = sourcePoints[index];
      if (!kept.length) {
        kept.push(point);
        index += 1;
        continue;
      }
      const baseline = failedFieldRawValueForPoint(kept.at(-1));
      const value = failedFieldRawValueForPoint(point);
      if (!Number.isFinite(baseline) || !Number.isFinite(value)) {
        kept.push(point);
        index += 1;
        continue;
      }
      const spikeThreshold = Math.max(200, baseline * 0.002);
      const restoreTolerance = Math.max(50, baseline * 0.001);
      if (value <= baseline + spikeThreshold) {
        kept.push(point);
        index += 1;
        continue;
      }
      let restoredIndex = -1;
      for (let cursor = index + 1; cursor < sourcePoints.length; cursor += 1) {
        const cursorValue = failedFieldRawValueForPoint(sourcePoints[cursor]);
        if (Number.isFinite(cursorValue) && cursorValue <= baseline + restoreTolerance) {
          restoredIndex = cursor;
          break;
        }
      }
      if (restoredIndex === -1) {
        kept.push(point);
        index += 1;
        continue;
      }
      kept.push(sourcePoints[restoredIndex]);
      index = restoredIndex + 1;
    }
    return kept.filter((point, pointIndex, all) => {
      if (pointIndex === 0) return true;
      const previous = all[pointIndex - 1];
      return point.time !== previous.time || failedFieldRawValueForPoint(point) !== failedFieldRawValueForPoint(previous);
      });
  };
  let failedFieldSource = withoutBacktrackedFailedSpikes(
    failedStatePointPoints.length ? failedStatePointPoints : failedFieldFallbackPoints,
  );
  if (isFailedChart && failedFieldSource.length) {
    const baselineIndex = failedFieldSource.findIndex(
      (point) => point.drivingParityEventMarker === "baseline",
    );
    const firstPositiveIndex = failedFieldSource.findIndex(
      (point) => failedFieldRawValueForPoint(point) > 0,
    );
    const chartStartIndex = baselineIndex >= 0 ? baselineIndex : firstPositiveIndex;
    if (chartStartIndex > 0) failedFieldSource = failedFieldSource.slice(chartStartIndex);
  }
  if (isDeltaChart && failedFieldSource.length) {
    let previousDeviationRatio = null;
    failedFieldSource = failedFieldSource.map((point) => {
      const deviationRatio = overallDeviationRatioForPoint(point);
      if (!Number.isFinite(deviationRatio)) return null;
      const signedDelta = Number.isFinite(previousDeviationRatio)
        ? deviationRatio - previousDeviationRatio
        : 0;
      previousDeviationRatio = deviationRatio;
      return {
        ...point,
        drivingParityDeltaValue: deviationRatio,
        drivingParitySignedDelta: signedDelta,
      };
    }).filter(Boolean);
  }
  if (isFailedChart && autoTimeDomain) {
    if (failedFieldSource.length) {
      minTime = failedFieldSource[0].time;
      maxTime = Math.max(minTime + 1, failedFieldSource.at(-1).time);
    }
  }
  const dataMaxTime = maxTime;
  if (isFailedChart && autoTimeDomain && !compactTimeScale) {
    const rightPadMs = Math.max(30_000, Math.min(10 * 60_000, (maxTime - minTime) * 0.015));
    maxTime += rightPadMs;
  }
  const timeSpan = Math.max(1, maxTime - minTime);
  const tickTimeSpan = Math.max(1, dataMaxTime - minTime);
  const rangedSeries = (sourcePoints, fallbackSeries = rawSeries) => {
    if (!sourcePoints.length) return fallbackSeries;
    const inRange = sourcePoints.filter((point) => point.time > minTime && point.time < maxTime);
    const beforeStart = sourcePoints.filter((point) => point.time <= minTime).at(-1) ?? sourcePoints[0];
    const beforeEnd = sourcePoints.filter((point) => point.time <= maxTime).at(-1) ?? beforeStart;
    const series = [{ ...beforeStart, time: minTime }, ...inRange];
    const last = series.at(-1);
    if (!last || last.time < maxTime || beforeEnd.time !== last.time) {
      series.push({ ...beforeEnd, time: maxTime });
    }
    return series.filter((point, index, all) => index === 0 || point.time !== all[index - 1].time);
  };
  const rangeSeries = rangedSeries(points);
  const failedFieldSeries = isFailedChart
    ? rangedSeries(failedFieldSource, [])
    : [];
  const fallback = rangeSeries.length ? rangeSeries : rawSeries;
  const compactTimeline = compactTimeScale
    ? createCompactTimeScale(isFailedChart && failedFieldSeries.length ? failedFieldSeries : fallback, minTime, maxTime)
    : null;
  const displayTimeSpan = compactTimeline ? compactTimeline.span : timeSpan;
  const displayTime = (time) => compactTimeline ? compactTimeline.project(time) : time - minTime;
  const progressValueForPoint = (point) => {
    const percent = Math.max(0, Math.min(100, point.percent));
    return isDrivingParityPage ? 100 - percent : percent;
  };
  const valueForPoint = isFailedChart ? failedFieldValueForPoint : progressValueForPoint;
  const failedVisibleDomainSource = isFailedChart && failedFieldSeries.length
    ? failedFieldSeries.filter((point) => point.time >= minTime && point.time <= maxTime)
    : [];
  const domainSource = isFailedChart && failedVisibleDomainSource.length ? failedVisibleDomainSource : rawSeries;
  const domainValues = domainSource.map(valueForPoint).filter(Number.isFinite);
  const rawValueMin = domainValues.length ? Math.min(...domainValues) : 0;
  const rawValueMax = domainValues.length ? Math.max(...domainValues) : 100;
  let valueMin = 0;
  let valueMax = 100;
  let failedFitStep = 0;
  if (isFailedChart) {
    const spread = Math.max(1, rawValueMax - rawValueMin);
    const niceCeil = (value) => {
      const exponent = Math.floor(Math.log10(Math.max(1, value)));
      const base = 10 ** exponent;
      const scaled = value / base;
      const factor = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
      return factor * base;
    };
    if (isDeltaChart) {
      const maxAbsDelta = Math.max(0.00001, Math.abs(rawValueMin), Math.abs(rawValueMax));
      const deltaLimit = maxAbsDelta * 1.16;
      valueMin = -deltaLimit;
      valueMax = deltaLimit;
    } else if (failedChartBaseline === "zero") {
      valueMin = 0;
      valueMax = rawValueMax + Math.max(1, spread * 0.04, rawValueMax * 0.05);
    } else {
      const step = niceCeil(spread / 3);
      failedFitStep = step;
      const lowerTarget = Math.max(0, rawValueMin - step * 0.5);
      valueMin = Math.max(0, Math.floor(lowerTarget / step) * step);
      valueMax = Math.ceil(rawValueMax / step) * step;
    }
    if (valueMax <= valueMin) valueMax = valueMin + 1;
  }
  let plotValueMin = valueMin;
  let plotValueMax = valueMax;
  const y = (value) => pad.top + innerHeight - (Math.max(0, Math.min(valueMax, value)) / valueMax) * innerHeight;
  if (isFailedChart) {
    y.value = (value) => {
      const clamped = Math.max(plotValueMin, Math.min(plotValueMax, value));
      return pad.top + innerHeight - ((clamped - plotValueMin) / Math.max(Number.EPSILON, plotValueMax - plotValueMin)) * innerHeight;
    };
  }
  const plotY = (value) => isFailedChart ? y.value(value) : y(value);
  const x = (time) => seriesPad.left + (displayTime(time) / displayTimeSpan) * innerWidth;
  const chartSegments = (series) => {
    const segments = [];
    let segment = [];
    for (const point of series) {
      if (isFailedChart && point.drivingParityEventMarker === "baseline" && segment.length) {
        segments.push(segment);
        segment = [];
      }
      segment.push(point);
    }
    if (segment.length) segments.push(segment);
    if (!isFailedChart || segments.length < 2) return segments;
    return segments.filter((candidate, index) =>
      index === segments.length - 1 || candidate.some((point) => failedFieldValueForPoint(point) > 0));
  };
  const chartSegmentPath = (series, valueAccessor = valueForPoint, yAccessor = plotY, xAccessor = x) => {
    const [first, ...rest] = series;
    const commands = ["M " + xAccessor(first.time).toFixed(1) + " " + yAccessor(valueAccessor(first)).toFixed(1)];
    let previous = first;
    for (const point of rest) {
      const pointX = xAccessor(point.time).toFixed(1);
      commands.push("L " + pointX + " " + yAccessor(valueAccessor(previous)).toFixed(1));
      commands.push("L " + pointX + " " + yAccessor(valueAccessor(point)).toFixed(1));
      previous = point;
    }
    return commands.join(" ");
  };
  const chartPath = (series, valueAccessor = valueForPoint, yAccessor = plotY, xAccessor = x) =>
    chartSegments(series).map((segment) => chartSegmentPath(segment, valueAccessor, yAccessor, xAccessor)).join(" ");
  const chartAreaPath = (series, valueAccessor = valueForPoint) => {
    const baselineY = plotY(valueMin).toFixed(1);
    return chartSegments(series).map((segment) => {
      const first = segment[0];
      const lastPoint = segment.at(-1);
      return [
        chartSegmentPath(segment, valueAccessor),
        "L " + x(lastPoint.time).toFixed(1) + " " + baselineY,
        "L " + x(first.time).toFixed(1) + " " + baselineY,
        "Z",
      ].join(" ");
    }).join(" ");
  };
  const chartCeilingAreaPath = (series, valueAccessor = valueForPoint) =>
    chartSegments(series).map((segment) => {
      const first = segment[0];
      const lastPoint = segment.at(-1);
      return [
        chartSegmentPath(segment, valueAccessor),
        "L " + x(lastPoint.time).toFixed(1) + " " + pad.top.toFixed(1),
        "L " + x(first.time).toFixed(1) + " " + pad.top.toFixed(1),
        "Z",
      ].join(" ");
    }).join(" ");
  const progressLineX = (time) => Math.min(width - seriesPad.right - 1, x(time));
  const path = isFailedChart ? "" : chartPath(fallback, progressValueForPoint, plotY, progressLineX);
  const areaPath = isFailedChart ? "" : chartAreaPath(fallback);
  const last = fallback.at(-1);
  const failedFieldTitleForPoint = (point) => {
    const statePointPercent = Number(point.drivingParityFailedStatePointPercent);
    if (Number.isFinite(statePointPercent)) {
      return (
        "Failed state points: " +
        Math.round(Number(point.drivingParityStateFailures || 0)) +
        (Number.isFinite(Number(point.drivingParityFrames)) ? " / " + Math.round(Number(point.drivingParityFrames)) + " frames" : "") +
        " (" +
        statePointPercent.toFixed(1) +
        "% of " +
        Math.round(Number(point.drivingParityActiveComparablePoints || 0)) +
        " active points" +
        "); failed fields: " +
        Math.round(Number(point.drivingParityFailedFields || 0)) +
        "/" +
        Math.round(Number(point.drivingParityAllFields || 0))
      );
    }
    return (
      "Failed fields: " +
      Number(point.drivingParityFailedFieldPercent).toFixed(1) +
      "% (" +
      Math.round(Number(point.drivingParityFailedFields || 0)) +
      "/" +
      Math.round(Number(point.drivingParityAllFields || 0)) +
      ")"
    );
  };
  const formatAxisNumber = (value) => {
    const rounded = Math.round(value);
    const abs = Math.abs(rounded);
    if (abs >= 1_000_000) return (rounded / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace(/\.0$/, "") + "m";
    if (abs >= 100_000) return Math.round(rounded / 1_000) + "k";
    if (abs >= 1_000) return (rounded / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
    return String(rounded);
  };
  const formatDeviationRatio = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    const digits = Math.abs(number) >= 1 ? 4 : 5;
    const text = number.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
    return text === "-0" ? "0" : text;
  };
  const labelValue = (value) => isDeltaChart
    ? formatDeviationRatio(value)
    : isFailedChart
      ? formatAxisNumber(value)
      : Math.round(value) + "%";
  svg.setAttribute(
    "aria-label",
    isDeltaChart ? "Overall failed-sample deviation ratio over time" : isFailedChart ? "Failed state points over time" : isDrivingParityPage ? "Remaining gap over time" : "Completion percentage over time",
  );
  svg.classList.toggle("range-zoomable", useRangeZoom);
  svg.classList.toggle("failed-chart", isFailedChart);
  svg.classList.toggle("delta-chart", isDeltaChart);
  svg.classList.toggle(
    "goal-reached",
    (isFailedChart &&
      !isDeltaChart &&
      failedFieldSeries.length > 0 &&
      failedFieldValueForPoint(failedFieldSeries.at(-1)) <= 0) ||
      (!isFailedChart && progressValueForPoint(last) <= 0),
  );
  svg.dataset.plotLeft = String(seriesPad.left);
  svg.dataset.plotRight = String(width - seriesPad.right);
  svg.dataset.plotTop = String(pad.top);
  svg.dataset.plotBottom = String(height - pad.bottom);
  svg.dataset.domainMin = String(minTime);
  svg.dataset.domainMax = String(maxTime);
  svg.dataset.timeScale = compactTimeline ? "compact" : "all";
  svg.replaceChildren();
  if (!isFailedChart && isDrivingParityPage) {
    const remainingArea = document.createElementNS("http://www.w3.org/2000/svg", "path");
    remainingArea.setAttribute("class", "progress-remaining-area");
    remainingArea.setAttribute("d", areaPath);
    svg.append(remainingArea);
    const completedArea = document.createElementNS("http://www.w3.org/2000/svg", "path");
    completedArea.setAttribute("class", "progress-area");
    completedArea.setAttribute("d", chartCeilingAreaPath(fallback, progressValueForPoint));
    svg.append(completedArea);
  }
  const yTicks = isDeltaChart
    ? [0, 1, 2, 3, 4].map((index) => valueMin + ((valueMax - valueMin) * index) / 4)
    : isFailedChart
    ? [0, 1, 2, 3, 4, 5].map((index) => valueMin + ((valueMax - valueMin) * index) / 5)
    : [0, 25, 50, 75, 100];
  for (const [tickIndex, value] of yTicks.entries()) {
    const tickY = plotY(value);
    const labelY = yAxisInsidePlot
      ? Math.max(pad.top + 8, Math.min(height - pad.bottom - 8, tickY))
      : Math.max(pad.top + 8, Math.min(height - pad.bottom - 8, tickY + 4));
    const hideEdgeDrivingParityTick =
      isDrivingParityPage && isFailedChart && (tickIndex === 0 || tickIndex === yTicks.length - 1);
    if (hideEdgeDrivingParityTick) continue;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("class", "grid-line");
    const rightValueLabelInset = yAxisInsidePlot ? 36 : 0;
    line.setAttribute("x1", String(seriesPad.left));
    line.setAttribute("x2", String(width - seriesPad.right - rightValueLabelInset));
    line.setAttribute("y1", String(tickY));
    line.setAttribute("y2", String(tickY));
    svg.append(line);
    if (!isFailedChart && (value === 0 || (isDrivingParityPage && value === 100))) continue;
    const backdrop = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    backdrop.setAttribute("class", "label-backdrop");
    const valueAxisOnRight = yAxisInsidePlot;
    backdrop.setAttribute("x", String(valueAxisOnRight ? width - axisLabelWidth : 0));
    backdrop.setAttribute("y", String(labelY - 8));
    backdrop.setAttribute("width", String(axisLabelWidth));
    backdrop.setAttribute("height", "16");
    svg.append(backdrop);
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("class", "axis-label y-axis-label");
    text.setAttribute("x", String(valueAxisOnRight ? width - 4 : yAxisInsidePlot ? 4 : seriesPad.left - 8));
    text.setAttribute("y", String(labelY));
    text.setAttribute("text-anchor", valueAxisOnRight || !yAxisInsidePlot ? "end" : "start");
    if (yAxisInsidePlot) text.setAttribute("dominant-baseline", "central");
    text.textContent = labelValue(value);
    svg.append(text);
  }
  const axis = document.createElementNS("http://www.w3.org/2000/svg", "line");
  axis.setAttribute("class", "axis-line");
  axis.setAttribute("x1", String(seriesPad.left));
  axis.setAttribute("x2", String(width - seriesPad.right));
  axis.setAttribute("y1", String(height - pad.bottom));
  axis.setAttribute("y2", String(height - pad.bottom));
  if (!isDrivingParityPage) svg.append(axis);
  if (!isFailedChart) {
    if (!isDrivingParityPage) {
      const area = document.createElementNS("http://www.w3.org/2000/svg", "path");
      area.setAttribute("class", "progress-area");
      area.setAttribute("d", areaPath);
      svg.append(area);
    }
    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    line.setAttribute("class", "progress-line");
    line.setAttribute("d", path);
    svg.append(line);
  }
  let failedFieldLine = null;
  if (failedFieldSeries.length) {
    if (!isDeltaChart) {
      const passedArea = document.createElementNS("http://www.w3.org/2000/svg", "path");
      passedArea.setAttribute("class", "failed-fields-pass-area");
      passedArea.setAttribute("d", chartCeilingAreaPath(failedFieldSeries, failedFieldValueForPoint));
      svg.append(passedArea);
    }
    if (!isDeltaChart) {
      const failedArea = document.createElementNS("http://www.w3.org/2000/svg", "path");
      failedArea.setAttribute("class", "failed-fields-area");
      failedArea.setAttribute("d", chartAreaPath(failedFieldSeries, failedFieldValueForPoint));
      svg.append(failedArea);
    } else {
      const zeroLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
      zeroLine.setAttribute("class", "delta-zero-line");
      zeroLine.setAttribute("x1", String(seriesPad.left));
      zeroLine.setAttribute("x2", String(width - seriesPad.right));
      zeroLine.setAttribute("y1", String(plotY(0)));
      zeroLine.setAttribute("y2", String(plotY(0)));
      svg.append(zeroLine);
    }
    const failedPercentSeries = isDeltaChart
      ? []
      : failedFieldSeries.filter((point) => Number.isFinite(failedTotalPercentForPoint(point)));
    if (failedPercentSeries.length) {
      const percentY = (value) => pad.top + innerHeight - (Math.max(0, Math.min(100, value)) / 100) * innerHeight;
      const percentLine = document.createElementNS("http://www.w3.org/2000/svg", "path");
      percentLine.setAttribute("class", "failed-total-percent-line");
      percentLine.setAttribute("d", chartPath(failedPercentSeries, failedTotalPercentForPoint, percentY));
      const latestPercent = failedTotalPercentForPoint(failedPercentSeries.at(-1));
      const percentTitle = document.createElementNS("http://www.w3.org/2000/svg", "title");
      percentTitle.textContent = "Failed total: " + latestPercent.toFixed(1).replace(".0", "") + "%";
      percentLine.append(percentTitle);
      svg.append(percentLine);
    }
    failedFieldLine = document.createElementNS("http://www.w3.org/2000/svg", "path");
    failedFieldLine.setAttribute("class", "failed-fields-line");
    failedFieldLine.setAttribute("d", chartPath(failedFieldSeries, failedFieldValueForPoint));
    const latestFailed = failedFieldSeries.at(-1);
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    if (isDeltaChart) {
      const deviationRatio = failedFieldValueForPoint(latestFailed);
      const signedDelta = Number(latestFailed.drivingParitySignedDelta || 0);
      title.textContent = "Overall deviation: " + formatDeviationRatio(deviationRatio)
        + " (run change " + (signedDelta > 0 ? "+" : "") + formatDeviationRatio(signedDelta) + ")";
    } else {
      title.textContent = failedFieldTitleForPoint(latestFailed);
    }
    failedFieldLine.append(title);
  }
  const failedRunMarkerLayer = isFailedChart ? document.createElementNS("http://www.w3.org/2000/svg", "g") : null;
  const failedRunTickMarkerLayer = isFailedChart ? document.createElementNS("http://www.w3.org/2000/svg", "g") : null;
  const failedRunPlainMarkerLayer = isFailedChart ? document.createElementNS("http://www.w3.org/2000/svg", "g") : null;
  const failedRunImprovedMarkerLayer = isFailedChart ? document.createElementNS("http://www.w3.org/2000/svg", "g") : null;
  if (failedRunMarkerLayer) failedRunMarkerLayer.setAttribute("class", "failed-run-marker-layer");
  if (failedRunTickMarkerLayer) failedRunTickMarkerLayer.setAttribute("class", "failed-run-marker-tick-layer");
  if (failedRunPlainMarkerLayer) failedRunPlainMarkerLayer.setAttribute("class", "failed-run-marker-plain-layer");
  if (failedRunImprovedMarkerLayer) failedRunImprovedMarkerLayer.setAttribute("class", "failed-run-marker-improved-layer");
  if (isFailedChart && failedFieldSource.length) {
    const visibleRunPoints = failedFieldSource.filter((point) =>
      point.time >= minTime &&
      point.time <= dataMaxTime &&
      Number.isFinite(failedFieldValueForPoint(point)));
    const previousRunValueByPoint = new Map();
    let previousRunPoint = null;
    for (const point of failedFieldSource) {
      if (Number.isFinite(failedFieldValueForPoint(point))) {
        previousRunValueByPoint.set(point, previousRunPoint ? failedFieldValueForPoint(previousRunPoint) : null);
        previousRunPoint = point;
      }
    }
    for (const [runIndex, point] of visibleRunPoints.entries()) {
      const px = x(point.time);
      const py = plotY(failedFieldValueForPoint(point));
      const previousValue = previousRunValueByPoint.get(point);
      const currentValue = failedFieldValueForPoint(point);
      const unchanged = isDeltaChart
        ? Number(point.drivingParitySignedDelta || 0) === 0
        : Number.isFinite(previousValue) && currentValue === previousValue;
      const mutedRunTick = unchanged || point.drivingParityEventMarker === "reverted";
      const baselineRun = runIndex === 0 || point.drivingParityEventMarker === "baseline";
      const edgeRunTick = baselineRun || runIndex === visibleRunPoints.length - 1;
      const markerClass = ["improved", "worsened", "reverted"].includes(point.drivingParityEventMarker)
        ? point.drivingParityEventMarker
        : Number.isFinite(previousValue) && currentValue < previousValue
          ? "improved"
          : Number.isFinite(previousValue) && currentValue > previousValue
            ? "worsened"
            : "";
      const hasRunMarker = !unchanged && !baselineRun && (markerClass === "improved" || markerClass === "worsened");
      let markerCenterY = py;
      let worsened = false;
      let tipY = py;
      let baseY = py;
      if (hasRunMarker) {
        const markerGap = 4;
        const markerMaxHeight = 10;
        const markerTopEdge = 2;
        const markerBottomEdge = verticalLineBottom - 2;
        worsened = markerClass === "worsened";
        const availableSpace = worsened
          ? Math.max(0, markerBottomEdge - py - markerGap)
          : Math.max(0, py - markerGap - markerTopEdge);
        const markerHeight = Math.min(markerMaxHeight, Math.max(5, availableSpace));
        tipY = worsened
          ? Math.min(markerBottomEdge - markerHeight, py + markerGap)
          : Math.max(markerTopEdge + markerHeight, py - markerGap);
        baseY = worsened ? tipY + markerHeight : tipY - markerHeight;
        markerCenterY = (tipY + baseY) / 2;
      }
      if (!edgeRunTick) {
        const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
        tick.setAttribute("class", "failed-run-tick" + (mutedRunTick ? " muted" : ""));
        tick.setAttribute("x1", px.toFixed(1));
        tick.setAttribute("x2", px.toFixed(1));
        tick.setAttribute("y1", markerCenterY.toFixed(1));
        tick.setAttribute("y2", (height - pad.bottom).toFixed(1));
        const tickTitle = document.createElementNS("http://www.w3.org/2000/svg", "title");
        tickTitle.textContent = formatClockTime(point.time) + " · " + (point.drivingParityEventTitle || failedFieldTitleForPoint(point));
        tick.append(tickTitle);
        failedRunTickMarkerLayer?.append(tick);
      }
      if (!hasRunMarker) continue;
      const marker = document.createElementNS("http://www.w3.org/2000/svg", "text");
      marker.setAttribute("class", "failed-run-marker" + (markerClass ? " " + markerClass : ""));
      marker.setAttribute("x", px.toFixed(1));
      marker.setAttribute("y", markerCenterY.toFixed(1));
      marker.textContent = worsened ? "▲" : "▼";
      const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent = formatClockTime(point.time) + " · " + (point.drivingParityEventTitle || failedFieldTitleForPoint(point));
      marker.append(title);
      (markerClass === "improved" ? failedRunImprovedMarkerLayer : failedRunPlainMarkerLayer)?.append(marker);
    }
  }
  if (failedRunTickMarkerLayer?.childElementCount) svg.append(failedRunTickMarkerLayer);
  if (failedFieldLine) svg.append(failedFieldLine);
  if (!isFailedChart && !isDrivingParityPage) for (let index = 1; index < fallback.length; index += 1) {
    const previous = fallback[index - 1];
    const point = fallback[index];
    const completed = Number.isFinite(previous.done) && Number.isFinite(point.done) && point.done > previous.done;
    const burned = Number.isFinite(previous.remaining) && Number.isFinite(point.remaining) && point.remaining < previous.remaining;
    const split =
      Number.isFinite(previous.total) &&
      Number.isFinite(point.total) &&
      point.total > previous.total;
    if (split) {
      const px = x(point.time);
      const py = plotY(progressValueForPoint(point));
      const markerHeight = 8;
      const markerGap = 8;
      const markerBottomEdge = height - 2;
      const availableBelow = Math.max(0, markerBottomEdge - py - markerGap);
      const splitHeight = Math.min(markerHeight, Math.max(5, availableBelow));
      const tipY = Math.min(markerBottomEdge - splitHeight, py + markerGap);
      const baseY = tipY + splitHeight;
      const marker = document.createElementNS("http://www.w3.org/2000/svg", "text");
      marker.setAttribute("class", "split-marker");
      marker.setAttribute("x", px.toFixed(1));
      marker.setAttribute("y", ((tipY + baseY) / 2).toFixed(1));
      marker.textContent = "▲";
      const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent = "Split/add: " + (point.total - previous.total) + " item" + (point.total - previous.total === 1 ? "" : "s");
      marker.append(title);
      svg.append(marker);
    }
    if (!completed) continue;
    const px = x(point.time);
    const py = plotY(progressValueForPoint(point));
    const markerGap = 4;
    const markerMaxHeight = 10;
    const markerTopEdge = 2;
    const availableAbove = Math.max(0, py - markerGap - markerTopEdge);
    const markerHeight = Math.min(markerMaxHeight, Math.max(6, availableAbove));
    const tipY = Math.max(markerTopEdge + markerHeight, py - markerGap);
    const baseY = tipY - markerHeight;
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "text");
    marker.setAttribute("class", "completion-marker");
    marker.setAttribute("x", px.toFixed(1));
    marker.setAttribute("y", ((tipY + baseY) / 2).toFixed(1));
    marker.textContent = "▼";
    svg.append(marker);
  }
  if (!isFailedChart) {
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("class", "progress-dot");
    dot.setAttribute("cx", String(x(last.time)));
    dot.setAttribute("cy", String(plotY(progressValueForPoint(last))));
    dot.setAttribute("r", "4");
    svg.append(dot);
  }
  const tickCount = 6;
  const xTicks = compactTimeline
    ? compactTimeline.ticks(tickCount)
    : Array.from({ length: tickCount }, (_, index) => minTime + (tickTimeSpan * index) / (tickCount - 1));
  for (const [index, time] of xTicks.entries()) {
    const tickPosition = tickPad.left + ((width - tickPad.left - tickPad.right) * index) / (tickCount - 1);
    if (index > 0 && index < xTicks.length - 1) {
      const gridLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
      gridLine.setAttribute("class", "grid-line x-grid-line");
      gridLine.setAttribute("x1", String(tickPosition));
      gridLine.setAttribute("x2", String(tickPosition));
      gridLine.setAttribute("y1", String(pad.top));
      gridLine.setAttribute("y2", String(verticalLineBottom));
      const firstDataLayer = svg.querySelector(".failed-fields-area, .progress-area");
      svg.insertBefore(gridLine, firstDataLayer);
    }
    if (!isDrivingParityPage) {
      const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
      tick.setAttribute("class", "axis-tick");
      tick.setAttribute("x1", String(tickPosition));
      tick.setAttribute("x2", String(tickPosition));
      tick.setAttribute("y1", String(height - pad.bottom));
      tick.setAttribute("y2", String(height - pad.bottom + 5));
      svg.append(tick);
    }
    if (isDrivingParityPage && (index === 0 || index === xTicks.length - 1)) continue;
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("class", "axis-label");
    text.setAttribute("x", String(tickPosition));
    text.setAttribute("y", String(height - 6));
    text.setAttribute("text-anchor", index === 0 ? "start" : index === xTicks.length - 1 ? "end" : "middle");
    text.textContent = formatClockTime(time);
    svg.append(text);
  }
  if ((failedRunPlainMarkerLayer?.childElementCount || 0) + (failedRunImprovedMarkerLayer?.childElementCount || 0) > 0) {
    if (failedRunPlainMarkerLayer?.childElementCount) failedRunMarkerLayer?.append(failedRunPlainMarkerLayer);
    if (failedRunImprovedMarkerLayer?.childElementCount) failedRunMarkerLayer?.append(failedRunImprovedMarkerLayer);
    svg.append(failedRunMarkerLayer);
  }
}

export function percentileCappedFrameDeltaSeries(residuals, activeStart = 0, percentile = .98) {
  const start = Math.max(0, Math.min(residuals.length, Number.isSafeInteger(activeStart) ? activeStart : 0));
  const values = residuals.map((value, index) => index < start ? 0 : value);
  const magnitudes = values.slice(start).map((value) => Math.abs(value)).sort((left, right) => left - right);
  const normalizedPercentile = Math.max(0, Math.min(1, Number(percentile) || 0));
  const percentileIndex = Math.floor(Math.max(0, magnitudes.length - 1) * normalizedPercentile);
  const limit = Math.max(.00001, magnitudes[percentileIndex] || 0);
  return {
    values,
    limit,
    clippedCount: values.filter((value) => Math.abs(value) > limit).length,
  };
}

export function renderDifferentialTestingFrameDeltaChart(svg, metrics) {
  if (!svg || typeof svg.replaceChildren !== "function") return;
  const residuals = Array.isArray(metrics?.frameSignedResiduals)
    ? metrics.frameSignedResiduals.map((value) => Number(value) || 0)
    : [];
  const measuredWidth = Math.round(svg.getBoundingClientRect().width || svg.parentElement?.getBoundingClientRect().width || svg.clientWidth || 640);
  const width = Math.max(360, measuredWidth);
  const measuredHeight = Math.round(svg.getBoundingClientRect().height || svg.clientHeight || parseFloat(getComputedStyle(svg).height) || 200);
  const height = Math.max(160, measuredHeight);
  svg.setAttribute("viewBox", "0 0 " + width + " " + height);
  const valueLabel = typeof metrics?.valueLabel === "string" && metrics.valueLabel.trim()
    ? metrics.valueLabel.trim()
    : "signed residual";
  svg.setAttribute(
    "aria-label",
    typeof metrics?.ariaLabel === "string" && metrics.ariaLabel.trim()
      ? metrics.ariaLabel.trim()
      : "Largest signed candidate minus reference residual by frame; display capped at the 98th percentile with clipped values marked",
  );
  svg.classList.remove("range-zoomable", "failed-chart", "goal-reached");
  svg.classList.add("delta-chart");
  delete svg.dataset.domainMin;
  delete svg.dataset.domainMax;
  delete svg.dataset.timeScale;
  svg.replaceChildren();
  if (residuals.length < 2) return;

  const frameCount = residuals.length;
  const activeStart = residuals.findIndex((value) => value !== 0);
  const hasMetricFirstFailingFrame = metrics?.firstFailingFrame !== null
    && metrics?.firstFailingFrame !== undefined
    && metrics?.firstFailingFrame !== "";
  const metricFirstFailingFrame = Number(metrics?.firstFailingFrame);
  const firstFailingFrame = hasMetricFirstFailingFrame && Number.isFinite(metricFirstFailingFrame)
    ? Math.max(-1, Math.min(frameCount - 1, Math.round(metricFirstFailingFrame)))
    : activeStart;
  const frameDeltas = percentileCappedFrameDeltaSeries(residuals, Math.max(0, firstFailingFrame));
  const limit = frameDeltas.limit;
  const zeroY = height / 2;
  const x = (index) => index / Math.max(1, frameCount - 1) * width;
  const y = (value) => zeroY - (Math.max(-limit, Math.min(limit, value)) / limit) * (height * 0.44);
  const svgElement = (name, attributes = {}) => {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
  };
  const formatRatio = (value) => {
    const digits = Math.abs(value) >= 1 ? 2 : 3;
    return Number(value).toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  };

  const appendBand = (start, end, failing) => {
    const x1 = x(start);
    const x2 = x(end);
    svg.append(svgElement("rect", {
      class: failing ? "frame-delta-fail-band" : "frame-delta-pass-band",
      x: Math.min(x1, x2).toFixed(1),
      y: 0,
      width: Math.max(1, Math.abs(x2 - x1)).toFixed(1),
      height,
    }));
  };
  if (firstFailingFrame < 0) {
    appendBand(0, frameCount - 1, false);
  } else {
    if (firstFailingFrame > 0) appendBand(0, firstFailingFrame, false);
    appendBand(firstFailingFrame, frameCount - 1, true);
  }

  const horizontalTicks = [-limit, 0, limit];
  for (const value of horizontalTicks) {
    const tickY = y(value);
    if (value !== 0) {
      svg.append(svgElement("line", {
        class: "grid-line",
        x1: 0,
        x2: width - 42,
        y1: tickY.toFixed(1),
        y2: tickY.toFixed(1),
      }));
    }
    const label = svgElement("text", {
      class: "axis-label y-axis-label",
      x: width - 4,
      y: tickY.toFixed(1),
      "text-anchor": "end",
      "dominant-baseline": "central",
    });
    label.textContent = formatRatio(value);
    svg.append(label);
  }

  const rawStep = Math.max(1, frameCount / 10);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10]
    .map((multiplier) => Math.max(1, Math.round(multiplier * magnitude)))
    .find((candidate) => candidate >= rawStep) || Math.max(1, Math.round(10 * magnitude));
  const topAxisLabelY = 13;
  const topAxisGridStartY = 16;
  let labelOrdinal = 0;
  for (let index = step; index < frameCount - 1; index += step) {
    const showLabel = labelOrdinal % 2 === 0;
    const tickX = x(index);
    if (showLabel) {
      svg.append(svgElement("line", {
        class: "grid-line x-grid-line",
        x1: tickX.toFixed(1),
        x2: tickX.toFixed(1),
        y1: topAxisGridStartY,
        y2: height,
      }));
      const label = svgElement("text", {
        class: "axis-label",
        x: tickX.toFixed(1),
        y: topAxisLabelY,
        "text-anchor": "middle",
      });
      label.textContent = String(index);
      svg.append(label);
    }
    labelOrdinal += 1;
  }

  let firstFailingFramePercentLabel = null;
  let firstFailingFrameLabel = null;
  if (firstFailingFrame >= 0 && firstFailingFrame < frameCount) {
    if (firstFailingFrame > 0) {
      firstFailingFramePercentLabel = svgElement("text", {
        class: "axis-label first-failing-frame-percent-label",
        x: Math.max(4, x(firstFailingFrame) - 4).toFixed(1),
        y: Math.max(12, height - 4).toFixed(1),
        "text-anchor": "end",
      });
      firstFailingFramePercentLabel.textContent = Math.round(firstFailingFrame / frameCount * 100) + "%";
    }
    firstFailingFrameLabel = svgElement("text", {
      class: "axis-label first-failing-frame-label",
      x: Math.min(width - 4, x(firstFailingFrame) + 4).toFixed(1),
      y: Math.max(12, height - 4).toFixed(1),
      "text-anchor": "start",
    });
    firstFailingFrameLabel.textContent = String(firstFailingFrame);
  }

  svg.append(svgElement("line", {
    class: "delta-zero-line",
    x1: 0,
    x2: Math.max(0, width - 14).toFixed(1),
    y1: zeroY.toFixed(1),
    y2: zeroY.toFixed(1),
  }));
  const passSegments = [];
  const failSegments = [];
  for (let index = 0; index < frameCount - 1; index += 1) {
    const startValue = frameDeltas.values[index];
    const endValue = frameDeltas.values[index + 1];
    const startX = x(index);
    const endX = x(index + 1);
    const appendSegment = (segments, x1, value1, x2, value2) => {
      segments.push(
        "M" + x1.toFixed(1) + "," + y(value1).toFixed(1)
        + "L" + x2.toFixed(1) + "," + y(value2).toFixed(1),
      );
    };
    const exactMatch = firstFailingFrame < 0 || (index < firstFailingFrame && index + 1 < firstFailingFrame);
    appendSegment(exactMatch ? passSegments : failSegments, startX, startValue, endX, endValue);
  }
  if (passSegments.length) svg.append(svgElement("path", { class: "frame-delta-line-pass", d: passSegments.join(" ") }));
  if (failSegments.length) svg.append(svgElement("path", { class: "frame-delta-line-fail", d: failSegments.join(" ") }));
  frameDeltas.values.forEach((value, index) => {
    if (Math.abs(value) <= limit) return;
    const markerX = x(index);
    const markerY = y(value);
    const marker = svgElement("path", {
      class: "frame-delta-outlier",
      d: value > 0
        ? `M${(markerX - 3).toFixed(1)},${(markerY + 5).toFixed(1)}L${markerX.toFixed(1)},${markerY.toFixed(1)}L${(markerX + 3).toFixed(1)},${(markerY + 5).toFixed(1)}Z`
        : `M${(markerX - 3).toFixed(1)},${(markerY - 5).toFixed(1)}L${markerX.toFixed(1)},${markerY.toFixed(1)}L${(markerX + 3).toFixed(1)},${(markerY - 5).toFixed(1)}Z`,
    });
    const title = svgElement("title");
    title.textContent = `${value > 0 ? "+" : ""}${formatRatio(value)} ${valueLabel}`;
    marker.append(title);
    svg.append(marker);
  });
  if (firstFailingFramePercentLabel) svg.append(firstFailingFramePercentLabel);
  if (firstFailingFrameLabel) svg.append(firstFailingFrameLabel);
}
