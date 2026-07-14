function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function niceCeiling(value) {
  if (!(value > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const factor = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return factor * magnitude;
}

function burnAxis(rawMaximum) {
  const maximum = Math.max(1, Math.ceil(rawMaximum));
  if (maximum <= 5) {
    return { maximum, ticks: Array.from({ length: maximum + 1 }, (_, index) => index) };
  }
  const step = niceCeiling(maximum / 4);
  const axisMaximum = Math.ceil(maximum / step) * step;
  return {
    maximum: axisMaximum,
    ticks: Array.from({ length: axisMaximum / step + 1 }, (_, index) => index * step),
  };
}

function normalizedHistory(history) {
  const sorted = (Array.isArray(history) ? history : [])
    .map((point, index) => ({
      time: Date.parse(point?.time),
      done: finiteNumber(point?.done),
      remaining: Math.max(0, finiteNumber(point?.remaining)),
      total: Math.max(0, finiteNumber(point?.total)),
      percent: clamp(finiteNumber(point?.percent), 0, 100),
      index,
    }))
    .filter((point) => Number.isFinite(point.time))
    .sort((left, right) => left.time - right.time || left.index - right.index);
  const collapsed = [];
  for (const point of sorted) {
    if (collapsed.at(-1)?.time === point.time) collapsed[collapsed.length - 1] = point;
    else collapsed.push(point);
  }
  return collapsed;
}

function compactTimeScale(points, minimumTime, maximumTime) {
  const idleThreshold = 30 * 60_000;
  const compactIdleGap = 8 * 60_000;
  const anchors = [...new Set([
    minimumTime,
    ...points.map((point) => point.time).filter((time) => time > minimumTime && time < maximumTime),
    maximumTime,
  ])].sort((left, right) => left - right);
  const segments = [];
  let displayEnd = 0;
  for (let index = 1; index < anchors.length; index += 1) {
    const start = anchors[index - 1];
    const end = anchors[index];
    const elapsed = Math.max(0, end - start);
    const displayElapsed = elapsed > idleThreshold ? compactIdleGap : elapsed;
    segments.push({ start, end, displayStart: displayEnd, displayEnd: displayEnd + displayElapsed });
    displayEnd += displayElapsed;
  }
  const project = (time) => {
    const clamped = clamp(Number(time), minimumTime, maximumTime);
    const segment = segments.find((candidate) => clamped <= candidate.end) ?? segments.at(-1);
    if (!segment || segment.end <= segment.start) return 0;
    const ratio = (clamped - segment.start) / (segment.end - segment.start);
    return segment.displayStart + (segment.displayEnd - segment.displayStart) * ratio;
  };
  const unproject = (displayTime) => {
    const clamped = clamp(Number(displayTime), 0, displayEnd);
    const segment = segments.find((candidate) => clamped <= candidate.displayEnd) ?? segments.at(-1);
    if (!segment || segment.displayEnd <= segment.displayStart) return minimumTime;
    const ratio = (clamped - segment.displayStart) / (segment.displayEnd - segment.displayStart);
    return segment.start + (segment.end - segment.start) * ratio;
  };
  return { span: Math.max(1, displayEnd), project, unproject };
}

function stepPath(points, x, y, valueForPoint) {
  if (!points.length) return "";
  const commands = [`M ${x(points[0]).toFixed(1)} ${y(valueForPoint(points[0])).toFixed(1)}`];
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    const previous = points[index - 1];
    commands.push(`L ${x(point).toFixed(1)} ${y(valueForPoint(previous)).toFixed(1)}`);
    commands.push(`L ${x(point).toFixed(1)} ${y(valueForPoint(point)).toFixed(1)}`);
  }
  return commands.join(" ");
}

export function buildChecklistProgressChart(history, mode = "done", { width = 640, height = 180 } = {}) {
  const safeWidth = Math.max(360, Math.round(width));
  const safeHeight = Math.max(160, Math.round(height));
  const plot = { left: 0, top: 0, right: safeWidth, bottom: safeHeight };
  const points = normalizedHistory(history);
  const fallbackTime = Date.now();
  const series = points.length ? points : [{ time: fallbackTime, done: 0, remaining: 0, total: 0, percent: 0 }];
  const first = series[0];
  const renderSeries = first.done > 0
    ? [{ ...first, done: 0, remaining: first.total, percent: 0, synthetic: true }, ...series]
    : series;
  const minimumTime = series[0].time;
  const maximumTime = series.at(-1).time;
  const timeline = compactTimeScale(series, minimumTime, maximumTime);
  const valueForPoint = mode === "burn" ? (point) => point.remaining : (point) => point.percent;
  const rawMaximum = Math.max(0, ...renderSeries.map(valueForPoint));
  const burnScale = burnAxis(rawMaximum);
  const valueMaximum = mode === "burn" ? burnScale.maximum : 100;
  const x = (point) => plot.left + (timeline.project(point.time) / timeline.span) * (plot.right - plot.left);
  const y = (value) => plot.bottom - (clamp(value, 0, valueMaximum) / valueMaximum) * (plot.bottom - plot.top);
  const path = stepPath(renderSeries, x, y, valueForPoint);
  const baseline = y(0).toFixed(1);
  const firstX = x(renderSeries[0]).toFixed(1);
  const lastX = x(renderSeries.at(-1)).toFixed(1);
  const area = `${path} L ${lastX} ${baseline} L ${firstX} ${baseline} Z`;
  const yTicks = mode === "burn" ? burnScale.ticks : [0, 25, 50, 75, 100];
  const xTicks = Array.from({ length: 6 }, (_, index) => {
    const ratio = index / 5;
    return {
      time: timeline.unproject(timeline.span * ratio),
      x: plot.left + (plot.right - plot.left) * ratio,
      edge: index === 0 ? "start" : index === 5 ? "end" : "middle",
    };
  });
  const markers = [];
  for (let index = 1; index < renderSeries.length; index += 1) {
    const previous = renderSeries[index - 1];
    const point = renderSeries[index];
    const markerX = clamp(x(point), plot.left + 8, plot.right - 8);
    if (point.total > previous.total) {
      markers.push({
        type: "split",
        x: markerX,
        y: Math.min(plot.bottom - 2, y(valueForPoint(point)) + 13),
        title: `Split/add: ${point.total - previous.total} item${point.total - previous.total === 1 ? "" : "s"}`,
      });
    }
    if (point.done > previous.done) {
      markers.push({
        type: "completion",
        x: markerX,
        y: Math.max(plot.top + 6, y(valueForPoint(point)) - 9),
        title: `Completed ${point.done - previous.done} item${point.done - previous.done === 1 ? "" : "s"}`,
      });
    }
  }
  const last = series.at(-1);
  return {
    width: safeWidth,
    height: safeHeight,
    mode,
    timeScale: "compact",
    plot,
    path,
    area,
    yTicks: yTicks.map((value) => ({ value, y: y(value), label: mode === "done" ? `${Math.round(value)}%` : String(Math.round(value)) })),
    xTicks,
    markers,
    points: series.map((point) => ({ ...point, x: x(point), y: y(valueForPoint(point)), value: valueForPoint(point) })),
    last: { ...last, x: x(last), y: y(valueForPoint(last)), value: valueForPoint(last) },
  };
}
