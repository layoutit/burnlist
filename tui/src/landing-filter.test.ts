import { expect, test } from "bun:test";
import { cycleLandingFilter, filterBurnlists } from "./landing-filter";
import type { BurnlistSummary } from "./types";

const row = (status: string) => ({ status } as BurnlistSummary);

test("landing filters map lifecycle states and cycle in displayed order", () => {
  const rows = [row("active"), row("ready"), row("draft"), row("complete")];
  expect(filterBurnlists(rows, "active")).toEqual([rows[0]]);
  expect(filterBurnlists(rows, "done")).toEqual([rows[3]]);
  expect(filterBurnlists(rows, "all")).toEqual(rows);
  expect(cycleLandingFilter("active", -1)).toBe("all");
  expect(cycleLandingFilter("active", 1)).toBe("ready");
});
