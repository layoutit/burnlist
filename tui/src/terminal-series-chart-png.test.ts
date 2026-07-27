import { describe, expect, test } from "bun:test";
import { terminalSeriesModel } from "./terminal-series-chart-model";
import { terminalSeriesPngDataUri } from "./terminal-series-chart-png";

describe("terminal series PNG", () => {
  test("creates a valid, cached PNG from the shared normalized series", () => {
    const model = terminalSeriesModel([
      { label: "a", value: -2, state: "fail" },
      { label: "b", value: 3, state: "pass" },
      { label: "c", value: 1, state: "pass" },
    ]);
    const first = terminalSeriesPngDataUri(model, 30, 4);
    const second = terminalSeriesPngDataUri(model, 30, 4);
    const bytes = Buffer.from(first.split(",")[1]!, "base64");
    expect(first).toBe(second);
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(bytes.readUInt32BE(16)).toBe(180);
    expect(bytes.readUInt32BE(20)).toBe(40);
  });
});
