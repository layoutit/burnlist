function normalizedLines(value) {
  const text = String(value).replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  if (!text) return [];
  return text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
}

function lcsPrefix(left, leftStart, leftEnd, right, rightStart, rightEnd) {
  const width = rightEnd - rightStart;
  let previous = new Uint32Array(width + 1);
  let current = new Uint32Array(width + 1);
  for (let index = leftStart; index < leftEnd; index += 1) {
    for (let offset = 0; offset < width; offset += 1) {
      current[offset + 1] = left[index] === right[rightStart + offset]
        ? previous[offset] + 1
        : Math.max(previous[offset + 1], current[offset]);
    }
    [previous, current] = [current, previous];
  }
  return previous;
}

function lcsSuffix(left, leftStart, leftEnd, right, rightStart, rightEnd) {
  const width = rightEnd - rightStart;
  let previous = new Uint32Array(width + 1);
  let current = new Uint32Array(width + 1);
  for (let index = leftEnd - 1; index >= leftStart; index -= 1) {
    for (let offset = width - 1; offset >= 0; offset -= 1) {
      current[offset] = left[index] === right[rightStart + offset]
        ? previous[offset + 1] + 1
        : Math.max(previous[offset], current[offset + 1]);
    }
    [previous, current] = [current, previous];
  }
  return previous;
}

function commonLines(left, leftStart, leftEnd, right, rightStart, rightEnd, result) {
  const length = leftEnd - leftStart;
  if (!length || rightEnd === rightStart) return;
  if (length === 1) {
    if (right.slice(rightStart, rightEnd).includes(left[leftStart])) result.push(left[leftStart]);
    return;
  }
  const middle = leftStart + Math.floor(length / 2);
  const prefix = lcsPrefix(left, leftStart, middle, right, rightStart, rightEnd);
  const suffix = lcsSuffix(left, middle, leftEnd, right, rightStart, rightEnd);
  let split = 0;
  for (let offset = 1; offset < prefix.length; offset += 1) {
    if (prefix[offset] + suffix[offset] > prefix[split] + suffix[split]) split = offset;
  }
  commonLines(left, leftStart, middle, right, rightStart, rightStart + split, result);
  commonLines(left, middle, leftEnd, right, rightStart + split, rightEnd, result);
}

function operations(before, after) {
  const common = [];
  commonLines(before, 0, before.length, after, 0, after.length, common);
  const result = [];
  let oldIndex = 0;
  let newIndex = 0;
  for (const line of common) {
    while (before[oldIndex] !== line) result.push({ type: "-", line: before[oldIndex++] });
    while (after[newIndex] !== line) result.push({ type: "+", line: after[newIndex++] });
    result.push({ type: " ", line });
    oldIndex += 1;
    newIndex += 1;
  }
  while (oldIndex < before.length) result.push({ type: "-", line: before[oldIndex++] });
  while (newIndex < after.length) result.push({ type: "+", line: after[newIndex++] });
  return result;
}

function range(start, count) {
  return count === 1 ? String(start) : `${start},${count}`;
}

// Hirschberg LCS produces a minimal line edit script while keeping memory linear.
// The line cap bounds its worst-case work before a hostile text file can monopolize
// synchronous hook execution.
export function unifiedLineDiff(path, beforeText, afterText, { context = 3, maxLines = 4_096 } = {}) {
  const before = normalizedLines(beforeText);
  const after = normalizedLines(afterText);
  if (before.length + after.length > maxLines) throw new RangeError("line diff limit exceeded");
  const changes = operations(before, after);
  const ranges = [];
  for (let index = 0; index < changes.length;) {
    if (changes[index].type === " ") {
      index += 1;
      continue;
    }
    const start = Math.max(0, index - context);
    let end = index + 1;
    while (end < changes.length && changes[end].type !== " ") end += 1;
    end = Math.min(changes.length, end + context);
    const previous = ranges.at(-1);
    if (previous && start <= previous.end) previous.end = end;
    else ranges.push({ start, end });
    index = end;
  }
  const result = [`--- a/${path}`, `+++ b/${path}`];
  for (const section of ranges) {
    const prior = changes.slice(0, section.start);
    const hunk = changes.slice(section.start, section.end);
    const oldBefore = prior.filter((entry) => entry.type !== "+").length;
    const newBefore = prior.filter((entry) => entry.type !== "-").length;
    const oldCount = hunk.filter((entry) => entry.type !== "+").length;
    const newCount = hunk.filter((entry) => entry.type !== "-").length;
    result.push(`@@ -${range(oldCount ? oldBefore + 1 : oldBefore, oldCount)} +${range(newCount ? newBefore + 1 : newBefore, newCount)} @@`);
    result.push(...hunk.map((entry) => `${entry.type}${entry.line}`));
  }
  return result.join("\n");
}
