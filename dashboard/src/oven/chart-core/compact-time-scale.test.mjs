import assert from "node:assert/strict";
import test from "node:test";
import { compactTimeScale, niceCeiling, stepPath } from "./compact-time-scale.js";

// FROZEN SNAPSHOT — original Checklist compactTimeScale (pre-extraction)
const originalChecklistCompactTimeScale = (() => {
  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function compactTimeScale(points, minimumTime, maximumTime) {
    const idleThreshold = 30 * 60_000;
    const compactIdleGap = 8 * 60_000;
    const anchors = [...new Set([minimumTime, ...points.map((point) => point.time).filter((time) => time > minimumTime && time < maximumTime), maximumTime])].sort((left, right) => left - right);
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

  return compactTimeScale;
})();

// FROZEN SNAPSHOT — DT createCompactTimeScale (reference)
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

// FROZEN SNAPSHOT — original Checklist niceCeiling (pre-extraction)
function originalChecklistNiceCeiling(value) {
  if (!(value > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const factor = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return factor * magnitude;
}

// FROZEN SNAPSHOT — original Checklist stepPath (pre-extraction)
function originalChecklistStepPath(points, x, y, valueForPoint) {
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

function mulberry32(seed) {
  return () => {
    let value = seed += 0x6D2B79F5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}

function randomCase(random, index) {
  const minimumTime = 1_700_000_000_000 + Math.floor(random() * 1_000_000_000);
  const pointCount = 2 + Math.floor(random() * 7);
  const points = [{ time: minimumTime }];
  let currentTime = minimumTime;
  for (let pointIndex = 1; pointIndex < pointCount; pointIndex += 1) {
    const isIdleGap = (index + pointIndex) % 2 === 0;
    const gap = isIdleGap
      ? 30 * 60_000 + 1 + Math.floor(random() * 20 * 60_000)
      : 1_000 + Math.floor(random() * 20 * 60_000);
    currentTime += gap;
    points.push({ time: currentTime });
  }
  return { points, minimumTime, maximumTime: currentTime };
}

function assertScaleMatchesSnapshots(points, minimumTime, maximumTime, label) {
  const shared = compactTimeScale(points, minimumTime, maximumTime);
  const differentialTesting = createCompactTimeScale(points, minimumTime, maximumTime);
  const checklist = originalChecklistCompactTimeScale(points, minimumTime, maximumTime);

  assert.equal(shared.span, differentialTesting.span, `span DT ${label}`);
  assert.equal(shared.span, checklist.span, `span Checklist ${label}`);
  const times = [
    minimumTime,
    maximumTime,
    ...points.map((point) => point.time),
    (minimumTime + maximumTime) / 2,
  ];
  for (const time of times) {
    assert.equal(shared.project(time), differentialTesting.project(time), `project DT ${label}, time ${time}`);
    assert.equal(shared.project(time), checklist.project(time), `project Checklist ${label}, time ${time}`);
  }
  for (const displayTime of [0, shared.span / 2, shared.span]) {
    assert.equal(shared.unproject(displayTime), differentialTesting.unproject(displayTime), `unproject DT ${label}, display ${displayTime}`);
    assert.equal(shared.unproject(displayTime), checklist.unproject(displayTime), `unproject Checklist ${label}, display ${displayTime}`);
  }
  for (const count of [0, 1, 2, 3, 7]) {
    assert.deepEqual(shared.ticks(count), differentialTesting.ticks(count), `ticks DT ${label}, count ${count}`);
  }
}

test("shared compact time scale is exactly equivalent to Checklist and DT snapshots", () => {
  const random = mulberry32(0xC0FFEE);
  for (let caseIndex = 0; caseIndex < 240; caseIndex += 1) {
    const { points, minimumTime, maximumTime } = randomCase(random, caseIndex);
    const shared = compactTimeScale(points, minimumTime, maximumTime);
    const checklist = originalChecklistCompactTimeScale(points, minimumTime, maximumTime);
    const differentialTesting = createCompactTimeScale(points, minimumTime, maximumTime);
    assert.equal(shared.span, checklist.span, `span Checklist case ${caseIndex}`);
    assert.equal(shared.span, differentialTesting.span, `span DT case ${caseIndex}`);
    for (let index = 0; index <= 20; index += 1) {
      const time = minimumTime + (maximumTime - minimumTime) * index / 20;
      assert.equal(shared.project(time), checklist.project(time), `project Checklist case ${caseIndex}, sample ${index}`);
      assert.equal(shared.project(time), differentialTesting.project(time), `project DT case ${caseIndex}, sample ${index}`);
    }
    for (let index = 0; index <= 20; index += 1) {
      const displayTime = shared.span * index / 20;
      assert.equal(shared.unproject(displayTime), checklist.unproject(displayTime), `unproject Checklist case ${caseIndex}, sample ${index}`);
      assert.equal(shared.unproject(displayTime), differentialTesting.unproject(displayTime), `unproject DT case ${caseIndex}, sample ${index}`);
    }
    for (const count of [0, 1, 2, 4, 7, 11]) {
      assert.deepEqual(shared.ticks(count), differentialTesting.ticks(count), `ticks case ${caseIndex}, count ${count}`);
    }
  }
});

test("shared compact time scale preserves DT coercion and edge-case equivalence", () => {
  const minimumTime = 1_700_000_000_000;
  const numericStringTime = minimumTime + 30 * 60_000;
  const maximumTime = minimumTime + 2 * 30 * 60_000;
  assertScaleMatchesSnapshots(
    [
      { time: minimumTime },
      { time: String(numericStringTime) },
      { time: numericStringTime },
      { time: maximumTime },
    ],
    minimumTime,
    maximumTime,
    "numeric-string anchor",
  );

  const exactIdleGap = compactTimeScale(
    [{ time: 0 }, { time: 30 * 60_000 }],
    0,
    30 * 60_000,
  );
  assert.equal(exactIdleGap.span, 30 * 60_000, "exact threshold is not compacted");
  assertScaleMatchesSnapshots([{ time: 0 }, { time: 30 * 60_000 }], 0, 30 * 60_000, "exact idle threshold");

  const justOverIdleGap = compactTimeScale(
    [{ time: 0 }, { time: 30 * 60_000 + 1 }],
    0,
    30 * 60_000 + 1,
  );
  assert.equal(justOverIdleGap.span, 8 * 60_000, "threshold plus one compacts to eight minutes");
  assertScaleMatchesSnapshots([{ time: 0 }, { time: 30 * 60_000 + 1 }], 0, 30 * 60_000 + 1, "just over idle threshold");

  const unsortedMinimumTime = 1_700_000_000_000;
  const unsortedMaximumTime = unsortedMinimumTime + 2 * 30 * 60_000 + 1_000;
  assertScaleMatchesSnapshots(
    [
      { time: unsortedMaximumTime + 1 },
      { time: unsortedMinimumTime + 30 * 60_000 + 1 },
      { time: unsortedMinimumTime + 30 * 60_000 + 1 },
      { time: unsortedMinimumTime - 1 },
      { time: unsortedMaximumTime },
      { time: unsortedMinimumTime },
      { time: unsortedMinimumTime + 1 },
    ],
    unsortedMinimumTime,
    unsortedMaximumTime,
    "duplicate unsorted out-of-range anchors",
  );

  assertScaleMatchesSnapshots(
    [{ time: 5 }, { time: 5 }, { time: 4 }, { time: 6 }],
    5,
    5,
    "degenerate range",
  );
});

test("shared compact time scale has explicit hand-computed outputs", () => {
  const scale = compactTimeScale([{ time: 1_000 }, { time: 3_000 }, { time: 5_000 }], 1_000, 5_000);
  assert.equal(scale.span, 4_000);
  assert.equal(scale.project(2_000), 1_000);
  assert.equal(scale.unproject(2_000), 3_000);
  assert.deepEqual(scale.ticks(3), [1_000, 3_000, 5_000]);
});

test("shared niceCeiling and stepPath preserve Checklist behavior", () => {
  for (const value of [-100, -1, 0, 0.0001, 0.2, 1, 1.1, 2, 2.1, 5, 5.1, 9.99, 10, 100, 999.9, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(niceCeiling(value), originalChecklistNiceCeiling(value), `niceCeiling(${value})`);
  }

  const points = [
    { time: 0, value: 1 },
    { time: 1.234, value: 2.5 },
    { time: 4.5, value: 1 },
  ];
  const x = (point) => point.time * 12.3 + 0.04;
  const y = (value) => 100 - value * 7.1;
  const valueForPoint = (point) => point.value;
  assert.equal(stepPath([], x, y, valueForPoint), "");
  assert.equal(
    stepPath([{ time: 2, value: 3 }], (point) => point.time, (value) => value, valueForPoint),
    "M 2.0 3.0",
  );
  assert.equal(
    stepPath(points, x, y, valueForPoint),
    originalChecklistStepPath(points, x, y, valueForPoint),
  );
});
