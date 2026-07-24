import { describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { cellWidth, fitLayoutText } from "../oven-runtime/layout/layout-runtime";
import { StructuralOvenViewport } from "../oven-runtime/layout/structural-viewport";
import { CatalogOvenDetail } from "../catalog-view";
import { ItemDetail } from "../item-view";
import { detailItems } from "../detail-items";
import { TerminalList } from "../oven-runtime/components/list-components";
import { TableGroup } from "../table-view";
import stringWidth from "string-width";
import { fitText } from "../theme";
import { fitTerminalText, sanitizeTerminalText, terminalCellWidth } from "../terminal-text";

const hostile = "title\u001b[2J\u001b]8;;https://example.test\u0007link\u001b\\\r\n\t\u202efooter\u009b31m";
const forbidden = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

describe("terminal injection boundary", () => {
  test("renders controls and bidi overrides as visible inert text", () => {
    const safe = sanitizeTerminalText(hostile);
    expect(safe).toContain("␛[2J");
    expect(safe).toContain("␍␊⇥�footer�31m");
    expect(safe).not.toMatch(forbidden);
  });

  test("uses grapheme cell widths and never splits clusters", () => {
    expect(terminalCellWidth("e\u0301")).toBe(1);
    expect(terminalCellWidth("😀")).toBe(2);
    expect(terminalCellWidth("界")).toBe(2);
    for (const glyph of ["☰", "ꥠ", "𝌀"]) { expect(terminalCellWidth(glyph)).toBe(2); expect(fitTerminalText(glyph, 1)).toBe("…"); }
    for (const glyph of ["𠀀", "𰀀"]) { expect(terminalCellWidth(glyph)).toBe(2); expect(fitTerminalText(glyph, 1)).toBe("…"); }
    for (const point of [0x17000, 0x18d00, 0x1aff0, 0x16fe0, 0x1b000]) { const glyph = String.fromCodePoint(point); expect(terminalCellWidth(glyph)).toBe(2); expect(fitTerminalText(glyph, 1)).toBe("…"); }
    expect(terminalCellWidth("·")).toBe(1);
    for (const glyph of ["☺️", "♻️", "1️⃣", "©️", "🈁"]) { expect(terminalCellWidth(glyph)).toBe(2); expect(fitTerminalText(glyph, 1)).toBe("…"); }
    expect(sanitizeTerminalText("\u0301")).toBe("◌\u0301");
    expect(fitTerminalText("e\u0301😀界", 4)).toBe("e\u0301😀…");
    expect(fitTerminalText("😀", 1)).toBe("…");
  });

  test("matches pinned string-width on the differential corpus", () => {
    for (const value of ["·", "☰", "ꥠ", "𝌀", "☺️", "1️⃣", "𠀀", "\u0301", hostile]) expect(terminalCellWidth(value)).toBe(stringWidth(sanitizeTerminalText(value)));
  });

  test("OpenTUI consumes two cells for emoji presentation clusters", async () => {
    for (const glyph of ["☰", "ꥠ", "𝌀", "☺️", "♻️", "1️⃣", "©️", "🈁", "𠀀", "𰀀", String.fromCodePoint(0x17000), String.fromCodePoint(0x18d00), String.fromCodePoint(0x1aff0), String.fromCodePoint(0x16fe0), String.fromCodePoint(0x1b000)]) {
      const setup = await createTestRenderer({ width: 2, height: 1, useThread: false }), root = createRoot(setup.renderer);
      try {
        flushSync(() => root.render(<box width={2} height={1} overflow="hidden"><text>{glyph}X</text></box>));
        await setup.renderOnce();
        expect(setup.captureCharFrame()).not.toContain("X");
      } finally { root.unmount(); setup.renderer.destroy(); }
    }
  });

  test("fuzz fixtures cannot cross a measured component or footer line", () => {
    const corpus = [hostile, "x\ud800y", "a\nq:back", "👩‍💻 combining e\u0301 wide 界", ...Array.from({ length: 32 }, (_, index) => `${String.fromCodePoint(index)}${String.fromCodePoint(0x80 + index)}\u202e${index}😀`)];
    for (const value of corpus) for (let width = 1; width <= 24; width += 1) {
      const normal = fitText(value, width), structural = fitLayoutText(value, width);
      expect(forbidden.test(normal)).toBe(false);
      expect(forbidden.test(structural)).toBe(false);
      expect(terminalCellWidth(normal)).toBeLessThanOrEqual(width);
      expect(cellWidth(structural)).toBeLessThanOrEqual(width);
    }
  });

  test("an off-screen viewport contains hostile payload above its footer", async () => {
    const setup = await createTestRenderer({ width: 20, height: 8, useThread: false });
    const root = createRoot(setup.renderer);
    const payload = `${hostile} payload-sentinel ${"界😀".repeat(12)}`;
    const nodes = [{ kind: "text", attributes: { text: payload }, bindings: {}, children: [], source: { offset: 0, line: 1, column: 1 } }] as never;
    try {
      flushSync(() => root.render(<StructuralOvenViewport nodes={nodes} viewport={{ width: 20, height: 8 }} footer="footer-sentinel" />));
      await setup.renderOnce();
      const lines = setup.captureCharFrame().split("\n");
      expect(lines.slice(0, -2).join("")).not.toMatch(forbidden);
      expect(lines.slice(-2).join("\n")).toContain("footer-sentinel");
      expect(lines.slice(-2).join("\n")).not.toContain("payload-sentinel");
      for (const line of lines) expect(terminalCellWidth(line)).toBeLessThanOrEqual(20);
    } finally { root.unmount(); setup.renderer.destroy(); }
  });

  test("production catalog, detail, and list surfaces contain hostile server metadata", async () => {
    const setup = await createTestRenderer({ width: 64, height: 26, useThread: false });
    const root = createRoot(setup.renderer);
    const bad = `${hostile} payload-sentinel`;
    const oven = { id: bad, name: bad, description: bad, version: bad, contract: bad, builtIn: false, repoKey: null, dataInput: "json-payload", instructions: `# heading\n${bad}`, oven: "", ovenRevision: bad, ir: { schema: "burnlist-oven-ir@1", id: bad, version: bad, contract: bad, theme: "x", root: [] } } as never;
    const item = { key: bad, kind: "active", id: bad, title: bad, status: bad, latest: false, fields: { [bad]: bad }, detail: bad, completedAt: bad } as never;
    try {
      flushSync(() => root.render(<box width={64} height={26} flexDirection="column" overflow="hidden"><box height={12}><CatalogOvenDetail summary={oven} detail={oven} height={12} width={64} /></box><box height={8}><ItemDetail item={item} oven={{ contract: "checklist-progress@1" } as never} progress={{} as never} data={null} domainIndex={0} width={64} height={8} /></box><box height={4}><TerminalList model={{ columns: [{ id: bad, label: bad }], rows: [{ id: bad, cells: { [bad]: bad } }], width: 64, height: 4 }} /></box><box height={2} border={["top"]}><text>footer-sentinel</text></box></box>));
      await setup.renderOnce();
      const lines = setup.captureCharFrame().split("\n");
      expect(lines.join("")).not.toMatch(forbidden);
      expect(lines.slice(-2).join("\n")).toContain("footer-sentinel");
      expect(lines.slice(-2).join("\n")).not.toContain("payload-sentinel");
      for (const line of lines) expect(terminalCellWidth(line)).toBeLessThanOrEqual(64);
    } finally { root.unmount(); setup.renderer.destroy(); }
  });

  test("narrow catalog metadata remains above its footer", async () => {
    const setup = await createTestRenderer({ width: 24, height: 12, useThread: false });
    const root = createRoot(setup.renderer), bad = `${hostile} narrow-sentinel`;
    const oven = { id: bad, name: bad, description: bad, version: bad, contract: bad, builtIn: false, repoKey: null, dataInput: "json-payload", instructions: bad, oven: "", ovenRevision: bad, ir: { schema: "burnlist-oven-ir@1", id: bad, version: bad, contract: bad, theme: "x", root: [] } } as never;
    try {
      flushSync(() => root.render(<box width={24} height={12} flexDirection="column" overflow="hidden"><box height={10} overflow="hidden"><CatalogOvenDetail summary={oven} detail={oven} height={10} width={24} /></box><box height={2} border={["top"]}><text>footer-sentinel</text></box></box>));
      await setup.renderOnce();
      const lines = setup.captureCharFrame().split("\n");
      expect(lines.slice(0, -2).join("")).not.toMatch(forbidden);
      expect(lines.slice(-2).join("\n")).toContain("footer-sentinel");
      expect(lines.slice(-2).join("\n")).not.toContain("narrow-sentinel");
      for (const line of lines) expect(terminalCellWidth(line)).toBeLessThanOrEqual(24);
    } finally { root.unmount(); setup.renderer.destroy(); }
  });

  test("narrow project labels reserve their count suffix", async () => {
    const setup = await createTestRenderer({ width: 24, height: 3, useThread: false }), root = createRoot(setup.renderer);
    try {
      flushSync(() => root.render(<box width={24} height={3} flexDirection="column"><TableGroup name={`${hostile} project-sentinel`} count={12} noun="Burnlist" width={24} /><box height={2} border={["top"]}><text>footer-sentinel</text></box></box>));
      await setup.renderOnce();
      const lines = setup.captureCharFrame().split("\n");
      expect(lines[0]).toContain("12 Burnlists");
      expect(lines[0]).not.toMatch(forbidden);
      expect(lines.slice(-2).join("\n")).toContain("footer-sentinel");
      for (const line of lines) expect(terminalCellWidth(line)).toBeLessThanOrEqual(24);
    } finally { root.unmount(); setup.renderer.destroy(); }
  });

  test("hostile Visual Parity frames are safe at narrow and wide widths", async () => {
    const bad = `${hostile} visual-sentinel`, payload = { schema: "burnlist-visual-parity-data@1", domains: [{ id: bad, label: bad, qualification: "target", tolerance: { rationale: bad } }], comparisons: [{ id: bad, label: bad, frame: 1, status: bad, domains: { [bad]: { label: bad, status: bad, reference: { label: bad, src: null, width: "wide" }, candidate: { label: bad, src: null, height: "tall" }, diff: { label: bad, src: null, width: "bad", height: "bad" }, difference: { changedPixels: bad, ratio: bad, meanAbsoluteDelta: bad, maximumAbsoluteDelta: bad } } } }] } as never;
    for (const width of [24, 64]) {
      const setup = await createTestRenderer({ width, height: 16, useThread: false }), root = createRoot(setup.renderer);
      try {
        flushSync(() => root.render(<box width={width} height={16} flexDirection="column" overflow="hidden"><box height={14} overflow="hidden"><ItemDetail item={{ key: bad, kind: "visual-frame", id: bad, title: bad, status: bad, latest: false, comparisonIndex: 0 }} oven={null} progress={null} data={{ payload } as never} domainIndex={0} width={width} height={14} /></box><box height={2} border={["top"]}><text>footer-sentinel</text></box></box>));
        await setup.renderOnce();
        const lines = setup.captureCharFrame().split("\n");
        expect(lines.slice(0, -2).join("")).not.toMatch(forbidden);
        expect(lines.slice(-2).join("\n")).toContain("footer-sentinel");
        expect(lines.slice(-2).join("\n")).not.toContain("visual-sentinel");
        for (const line of lines) expect(terminalCellWidth(line)).toBeLessThanOrEqual(width);
      } finally { root.unmount(); setup.renderer.destroy(); }
    }
  });

  test("malformed Checklist progress is coerced before ItemDetail renders", async () => {
    const bad = `${hostile} checklist-sentinel`, oven = { contract: "checklist-progress@1" } as never;
    const progress = { active: [{ id: bad, title: [bad], fields: { [bad]: { nested: bad }, array: [bad] } }, null, []], completed: [{ id: bad, title: bad, completedAt: bad, detail: {} }, { id: 7, title: null, completedAt: [], detail: [bad] }, { id: false, title: 3, completedAt: 4, detail: 5 }] } as never;
    const items = detailItems(oven, progress, null), setup = await createTestRenderer({ width: 32, height: 14, useThread: false }), root = createRoot(setup.renderer);
    try {
      flushSync(() => root.render(<box width={32} height={14} flexDirection="column" overflow="hidden"><box height={12} overflow="hidden">{items.map((item) => <ItemDetail key={item.key} item={item} oven={oven} progress={progress} data={null} domainIndex={0} width={32} height={4} />)}</box><box height={2} border={["top"]}><text>footer-sentinel</text></box></box>));
      await setup.renderOnce();
      const lines = setup.captureCharFrame().split("\n");
      expect(lines.slice(0, -2).join("")).not.toMatch(forbidden);
      expect(lines.slice(-2).join("\n")).toContain("footer-sentinel");
      expect(lines.slice(-2).join("\n")).not.toContain("checklist-sentinel");
    } finally { root.unmount(); setup.renderer.destroy(); }
  });
});
