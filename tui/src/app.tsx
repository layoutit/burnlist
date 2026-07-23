import { useKeyboard } from "@opentui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compileGlyph, type GlyphScreen } from "../../src/glyph/glyph-compile.mjs";
import burnlistSource from "../screens/burnlist.glyph" with { type: "text" };
import homeSource from "../screens/home.glyph" with { type: "text" };
import itemSource from "../screens/item.glyph" with { type: "text" };
import ovenSource from "../screens/oven.glyph" with { type: "text" };
import ovensSource from "../screens/ovens.glyph" with { type: "text" };
import { createDataClient } from "./data-client";
import { detailItems, visualParityPayload } from "./detail-items";
import { observeDashboardEvents, type StreamStatus } from "./event-stream";
import { orderedBurnlists } from "./landing-groups";
import { associatedOven, genericOvens, ovenLenses } from "./oven-fit";
import { ScreenRuntime } from "./screen-runtime";
import type { BurnlistSummary, LandingSnapshot, OvenDataSnapshot, OvenPackageDetail, OvenSummary, ProgressSnapshot } from "./types";

const emptyLanding: LandingSnapshot = { projects: [], burnlists: [], ovens: [], generatedAt: "" };

function screen(source: string, file: string): GlyphScreen {
  const compiled = compileGlyph(source, { file });
  if (!compiled.ok) throw new Error(compiled.diagnostics.map((entry) => `${entry.code}: ${entry.message}`).join("\n"));
  return compiled.ir;
}

const screens = {
  home: screen(homeSource, "home.glyph"),
  ovens: screen(ovensSource, "ovens.glyph"),
  oven: screen(ovenSource, "oven.glyph"),
  burnlist: screen(burnlistSource, "burnlist.glyph"),
  item: screen(itemSource, "item.glyph"),
};
type View = keyof typeof screens;

export function App({ serverUrl, shutdown }: { serverUrl: string; shutdown(): void }) {
  const client = useMemo(() => createDataClient(serverUrl), [serverUrl]);
  const [landing, setLanding] = useState(emptyLanding);
  const [progress, setProgress] = useState<ProgressSnapshot | null>(null);
  const [ovenData, setOvenData] = useState<OvenDataSnapshot | null>(null);
  const [ovenDetail, setOvenDetail] = useState<OvenPackageDetail | null>(null);
  const [navigation, setNavigation] = useState<View[]>(["home"]);
  const [selectedBurnlist, setSelectedBurnlist] = useState<BurnlistSummary | null>(null);
  const [activeOven, setActiveOven] = useState<OvenSummary | null>(null);
  const [selections, setSelections] = useState<Record<string, number>>({ burnlists: 0, ovens: 0 });
  const [itemIndex, setItemIndex] = useState(0);
  const [domainIndex, setDomainIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("connecting");
  const view = navigation.at(-1) ?? "home";
  const catalog = useMemo(() => genericOvens(landing.ovens), [landing.ovens]);
  const burnlists = useMemo(() => orderedBurnlists(landing), [landing]);
  const lenses = useMemo(() => selectedBurnlist ? ovenLenses(selectedBurnlist, landing.ovens) : [], [landing.ovens, selectedBurnlist]);
  const items = useMemo(() => detailItems(activeOven, progress, ovenData), [activeOven, ovenData, progress]);
  const safeItemIndex = Math.max(0, Math.min(itemIndex, Math.max(0, items.length - 1)));
  const selectedItem = items[safeItemIndex] ?? null;

  const pushView = useCallback((next: View) => {
    setNavigation((current) => current.at(-1) === next ? current : [...current, next]);
  }, []);
  const back = useCallback(() => setNavigation((current) => current.length > 1 ? current.slice(0, -1) : current), []);

  const loadLanding = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLanding(await client.landing());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [client]);

  const loadBurnlist = useCallback(async (burnlist: BurnlistSummary, oven: OvenSummary | null, resetItem: boolean) => {
    setLoading(true);
    setError(null);
    setActiveOven(oven);
    setOvenDetail(null);
    setProgress(null);
    setOvenData(null);
    if (resetItem) setItemIndex(0);
    try {
      if (oven?.contract === "checklist-progress@1") {
        if (!burnlist.planPath) throw new Error("This Checklist Burnlist has no readable plan path.");
        setProgress(await client.progress(burnlist.planPath));
        setDomainIndex(0);
      } else if (oven) {
        const snapshot = await client.ovenData(oven.id, burnlist.repoKey);
        setOvenData(snapshot);
        const payload = visualParityPayload(snapshot);
        setDomainIndex(Math.max(0, payload?.domains.findIndex((domain) => domain.qualification === "target") ?? 0));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [client]);

  const loadCatalogOven = useCallback(async (oven: OvenSummary) => {
    setLoading(true);
    setError(null);
    setActiveOven(oven);
    setOvenDetail(null);
    try {
      setOvenDetail(await client.oven(oven.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { void loadLanding(); }, [loadLanding]);

  const refresh = useCallback(() => {
    void loadLanding();
    if ((view === "burnlist" || view === "item") && selectedBurnlist) void loadBurnlist(selectedBurnlist, activeOven, false);
    if (view === "oven" && activeOven) void loadCatalogOven(activeOven);
  }, [activeOven, loadBurnlist, loadCatalogOven, loadLanding, selectedBurnlist, view]);
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  useEffect(() => observeDashboardEvents(client.base, {
    onInvalidate: () => refreshRef.current(),
    onStatus: setStreamStatus,
  }), [client.base]);
  useEffect(() => {
    const timer = setInterval(() => refreshRef.current(), 30_000);
    timer.unref?.();
    return () => clearInterval(timer);
  }, []);

  const openBurnlist = useCallback((burnlist: BurnlistSummary) => {
    const oven = associatedOven(burnlist, landing.ovens);
    setSelectedBurnlist(burnlist);
    pushView("burnlist");
    void loadBurnlist(burnlist, oven, true);
  }, [landing.ovens, loadBurnlist, pushView]);

  const openCatalogOven = useCallback((oven: OvenSummary) => {
    pushView("oven");
    void loadCatalogOven(oven);
  }, [loadCatalogOven, pushView]);

  const moveList = useCallback((id: "burnlists" | "ovens", length: number, direction: -1 | 1) => {
    if (!length) return;
    setSelections((current) => {
      const selected = Math.max(0, Math.min(current[id] ?? 0, length - 1));
      return { ...current, [id]: (selected + direction + length) % length };
    });
  }, []);

  const moveItem = useCallback((direction: -1 | 1) => {
    if (!items.length) return;
    setItemIndex((current) => (Math.max(0, Math.min(current, items.length - 1)) + direction + items.length) % items.length);
  }, [items.length]);

  const cycleLens = useCallback((direction: -1 | 1) => {
    if (!selectedBurnlist || lenses.length < 2) return;
    const current = Math.max(0, lenses.findIndex((oven) => oven.id === activeOven?.id));
    void loadBurnlist(selectedBurnlist, lenses[(current + direction + lenses.length) % lenses.length]!, true);
  }, [activeOven?.id, lenses, loadBurnlist, selectedBurnlist]);

  const cycleDomain = useCallback((direction: -1 | 1) => {
    const count = visualParityPayload(ovenData)?.domains.length ?? 0;
    if (count > 1) setDomainIndex((current) => (current + direction + count) % count);
  }, [ovenData]);

  useKeyboard((key) => {
    if (key.name === "q") return back();
    if (key.name === "escape") return navigation.length === 1 ? shutdown() : back();
    if (key.name === "r") return refresh();
    if (key.name === "o") {
      if (view === "oven") return back();
      if (view !== "ovens") pushView("ovens");
      return;
    }
    if (view === "home") {
      if (key.name === "up") return moveList("burnlists", burnlists.length, -1);
      if (key.name === "down") return moveList("burnlists", burnlists.length, 1);
      if (key.name === "return" || key.name === "enter") {
        const burnlist = burnlists[Math.min(selections.burnlists ?? 0, burnlists.length - 1)];
        if (burnlist) openBurnlist(burnlist);
      }
      return;
    }
    if (view === "ovens") {
      if (key.name === "up") return moveList("ovens", catalog.length, -1);
      if (key.name === "down") return moveList("ovens", catalog.length, 1);
      if (key.name === "return" || key.name === "enter") {
        const oven = catalog[Math.min(selections.ovens ?? 0, catalog.length - 1)];
        if (oven) openCatalogOven(oven);
      }
      return;
    }
    if (view === "burnlist") {
      if (key.name === "up") return moveItem(-1);
      if (key.name === "down") return moveItem(1);
      if (key.sequence === "[") return cycleLens(-1);
      if (key.sequence === "]") return cycleLens(1);
      return;
    }
    if (view === "item") {
      if (key.name === "up") return moveItem(-1);
      if (key.name === "down") return moveItem(1);
      if (key.name === "left") return cycleDomain(-1);
      if (key.name === "right") return cycleDomain(1);
    }
  });

  const notice = error ? { message: `Cannot read ${client.base}: ${error}`, tone: "error" as const }
    : loading ? { message: "Refreshing Burnlist data…", tone: "info" as const } : null;

  return <ScreenRuntime
    screen={screens[view]}
    landing={landing}
    progress={progress}
    selectedBurnlist={selectedBurnlist}
    activeOven={activeOven}
    ovenDetail={ovenDetail}
    ovenLenses={lenses}
    ovenData={ovenData}
    selectedItem={selectedItem}
    itemIndex={safeItemIndex}
    domainIndex={domainIndex}
    focusId={view === "ovens" ? "ovens" : view === "home" ? "burnlists" : "items"}
    selections={selections}
    streamStatus={streamStatus}
    notice={notice}
  />;
}
