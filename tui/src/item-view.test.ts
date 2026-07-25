import { expect, test } from "bun:test";
import { itemDetailLines, itemDetailMaxOffset } from "./item-view";
import type { DetailItem } from "./types";

const item: DetailItem = {
  key: "active:B44",
  id: "B44",
  kind: "active",
  latest: false,
  status: "ACTIVE",
  title: "👩‍💻👩‍💻",
  fields: {},
  detail: "tail",
};

test("item detail wrapping preserves grapheme clusters", () => {
  const lines = itemDetailLines(item, 2).map((line) => line.text);
  expect(lines).toContain("👩‍💻");
  expect(lines).not.toContain("👩‍");
  expect(lines).not.toContain("💻");
});

test("item detail offset has a finite viewport tail", () => {
  const long = { ...item, detail: Array.from({ length: 30 }, (_, index) => `line-${index}`).join("\n") };
  const offset = itemDetailMaxOffset(long, 20, 8);
  expect(offset).toBeGreaterThan(0);
  expect(offset).toBeLessThan(itemDetailLines(long, 16).length);
});
