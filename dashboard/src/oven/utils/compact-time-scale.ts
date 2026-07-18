function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function niceCeiling(value) {
  if (!(value > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const factor = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return factor * magnitude;
}

export function compactTimeScale(points, minimumTime, maximumTime) {
  const idleThreshold = 30 * 60_000;
  const compactIdleGap = 8 * 60_000;
  const anchors = [...new Set([minimumTime, ...points.map((point) => Number(point.time)).filter((time) => Number.isFinite(time) && time > minimumTime && time < maximumTime), maximumTime])].sort((left, right) => left - right);
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
  const ticks = (count) => {
    if (count <= 1) return [minimumTime];
    return Array.from(
      { length: count },
      (_, index) => unproject((displayEnd * index) / (count - 1)),
    );
  };
  return { span: Math.max(1, displayEnd), project, ticks, unproject };
}

export function stepPath(points, x, y, valueForPoint) {
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
