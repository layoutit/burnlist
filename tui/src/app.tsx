import { useKeyboard } from "@opentui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compileGlyph, type GlyphScreen } from "../../src/glyph/glyph-compile.mjs";
import burnlistSource from "../screens/burnlist.glyph" with { type: "text" };
import homeSource from "../screens/home.glyph" with { type: "text" };
import itemSource from "../screens/item.glyph" with { type: "text" };
import ovenSource from "../screens/oven.glyph" with { type: "text" };
import ovensSource from "../screens/ovens.glyph" with { type: "text" };
import { createDataClient, DataClientError } from "./data-client";
import { adaptChecklist } from "../../dashboard/src/lib/checklist-adapter";
import { detailItems, visualParityPayload } from "./detail-items";
import { eventInvalidatesScope, observeDashboardEvents, type OvenEvent, type StreamStatus } from "./event-stream";
import { definitionChangeInvalidates } from "./oven-runtime/definition-adapter";
import { initialLiveSnapshot, isMissingSnapshotStatus, reduceLiveSnapshot, terminalServerQuery, type LiveSnapshot } from "./oven-runtime/live-snapshot";
import { initTerminalRuntime, reduceTerminalRuntime, type TerminalRuntimeAction, type TerminalRuntimeState } from "./oven-runtime/state-runtime";
import { orderedBurnlists } from "./landing-groups";
import { associatedOven, genericOvens, ovenLenses } from "./oven-fit";
import { ScreenRuntime } from "./screen-runtime";
import { admitTerminalOven, type JsonValue, type TerminalOvenIR } from "./oven-runtime/terminal-contract";
import { initStreamingDiffNavigation, reduceStreamingDiffNavigation, type StreamingDiffNavigation } from "./oven-runtime/streaming-diff-navigation";
import { useStreamingDiffSession } from "./use-streaming-diff-session";
import { loadStreamingFeeds, streamingRepositories } from "./streaming-diff-feeds";
import { TERMINAL_IMPLEMENTED_CAPABILITIES } from "./oven-runtime/components";
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
  const [landing, setLanding] = useState(emptyLanding); const [progress, setProgress] = useState<ProgressSnapshot | null>(null);
  const [ovenData, setOvenData] = useState<OvenDataSnapshot | null>(null); const [ovenDetail, setOvenDetail] = useState<OvenPackageDetail | null>(null);
  const [navigation, setNavigation] = useState<View[]>(["home"]); const [selectedBurnlist, setSelectedBurnlist] = useState<BurnlistSummary | null>(null); const [activeOven, setActiveOven] = useState<OvenSummary | null>(null);
  const [selections, setSelections] = useState<Record<string, number>>({ burnlists: 0, ovens: 0 }); const [itemIndex, setItemIndex] = useState(0); const [domainIndex, setDomainIndex] = useState(0);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("connecting");
  const [activeLive, setActiveLive] = useState<LiveSnapshot<true>>(initialLiveSnapshot());
  const [terminalState, setTerminalState] = useState<TerminalRuntimeState | null>(null);
  const [searchControlId, setSearchControlId] = useState<string | null>(null);
  const [streamingNavigation, setStreamingNavigation] = useState<StreamingDiffNavigation | null>(null);
  const [streamingRefresh, setStreamingRefresh] = useState(0);
  const terminalRuntimeRef = useRef<{ scope: string; state: TerminalRuntimeState } | null>(null);
  const terminalQueryRef = useRef("");
  const domainIdRef = useRef<string | null>(null);
  const ovenRequest = useRef<{ generation: number; controller: AbortController | null }>({ generation: 0, controller: null });
  const beginOvenRequest = useCallback(() => {
    ovenRequest.current.controller?.abort();
    const controller = new AbortController(), generation = ovenRequest.current.generation + 1;
    ovenRequest.current = { generation, controller };
    return { signal: controller.signal, owns: () => ovenRequest.current.generation === generation && !controller.signal.aborted };
  }, []);
  const view = navigation.at(-1) ?? "home";
  const catalog = useMemo(() => genericOvens(landing.ovens), [landing.ovens]);
  const burnlists = useMemo(() => orderedBurnlists(landing), [landing]);
  const lenses = useMemo(() => selectedBurnlist ? ovenLenses(selectedBurnlist, landing.ovens) : [], [landing.ovens, selectedBurnlist]);
  const streamingSession = streamingNavigation?.page === "session" ? streamingNavigation.session : null; const activeStreamingData = useMemo(() => { const identity = (ovenData?.payload as { identity?: { logicalRepoKey?: string; worktreeKey?: string; session?: string } } | undefined)?.identity; return streamingSession && identity?.logicalRepoKey === streamingSession.identity.logicalRepoKey && identity.worktreeKey === streamingSession.identity.worktreeKey && identity.session === streamingSession.identity.session ? ovenData : null; }, [ovenData, streamingSession?.href]); const displayData = streamingSession ? activeStreamingData : ovenData;
  const items = useMemo(() => detailItems(activeOven, progress, displayData), [activeOven, displayData, progress]);
  const safeItemIndex = Math.max(0, Math.min(itemIndex, Math.max(0, items.length - 1)));
  const selectedItem = items[safeItemIndex] ?? null;
  const ovenRuntime = useMemo(() => {
    if (!ovenDetail) return null;
    const payload = activeOven?.contract === "checklist-progress@1" && progress ? adaptChecklist({
      ...progress,
      history: progress.history ?? [],
      active: progress.active.map((item) => ({ ...item, fields: item.fields ?? {} })),
      completed: progress.completed.map((item) => ({ ...item, detail: item.detail ?? "" })),
    }) : displayData?.payload;
    if (payload === undefined) return null;
    return admitTerminalOven(ovenDetail.ir as unknown as TerminalOvenIR, { status: "ready", payload: payload as JsonValue }, terminalState ?? undefined, [], TERMINAL_IMPLEMENTED_CAPABILITIES);
  }, [activeOven?.contract, displayData?.payload, ovenDetail, progress, terminalState]);
  const acceptTerminalPayload = useCallback((detail: OvenPackageDetail, payload: JsonValue, scope: string) => {
    const ir = detail.ir as unknown as TerminalOvenIR;
    const prior = terminalRuntimeRef.current;
    const state = prior?.scope === scope ? reduceTerminalRuntime(prior.state, { type: "payloadAccepted", payload }, ir) : initTerminalRuntime(ir, payload);
    terminalRuntimeRef.current = { scope, state };
    setTerminalState(state);
  }, []);
  const dispatchTerminalAction = useCallback((action: TerminalRuntimeAction) => {
    const prior = terminalRuntimeRef.current;
    if (!prior || !ovenDetail) return;
    const state = reduceTerminalRuntime(prior.state, action, ovenDetail.ir as unknown as TerminalOvenIR);
    terminalRuntimeRef.current = { ...prior, state };
    setTerminalState(state);
  }, [ovenDetail]);
  useStreamingDiffSession({ client, active: view === "oven", navigation: streamingNavigation, ovenDetail, nonce: streamingRefresh, accept: acceptTerminalPayload, setData: setOvenData, setNavigation: setStreamingNavigation });
  const pushView = useCallback((next: View) => {
    setNavigation((current) => current.at(-1) === next ? current : [...current, next]);
  }, []);
  const back = useCallback(() => { setSearchControlId(null); setNavigation((current) => current.length > 1 ? current.slice(0, -1) : current); }, []);
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
    const request = beginOvenRequest();
    const sameSelection = selectedBurnlist?.id === burnlist.id && selectedBurnlist.repoKey === burnlist.repoKey
      && activeOven?.id === oven?.id && activeOven?.repoKey === oven?.repoKey;
    setLoading(true);
    setActiveLive((current) => sameSelection ? reduceLiveSnapshot(current, "loading") : reduceLiveSnapshot(initialLiveSnapshot<true>(), "loading"));
    setError(null);
    setActiveOven(oven);
    if (!sameSelection) {
      setOvenDetail(null);
      setProgress(null);
      setOvenData(null);
    }
    if (resetItem) setItemIndex(0);
    try {
      if (oven?.contract === "checklist-progress@1") {
        if (!burnlist.planPath) throw new Error("This Checklist Burnlist has no readable plan path.");
        const [progressResponse, definitionResponse] = await Promise.all([client.progressResult(burnlist.planPath, request.signal), client.ovenResult(oven.id, burnlist.repoKey, request.signal)]);
        if (!request.owns()) return;
        setProgress(progressResponse.data);
        setOvenDetail(definitionResponse.data);
        acceptTerminalPayload(definitionResponse.data, adaptChecklist({ ...progressResponse.data, history: progressResponse.data.history ?? [], active: progressResponse.data.active.map((item) => ({ ...item, fields: item.fields ?? {} })), completed: progressResponse.data.completed.map((item) => ({ ...item, detail: item.detail ?? "" })) }) as JsonValue, JSON.stringify([burnlist.repoKey, oven.id, definitionResponse.data.ovenRevision]));
        if (!sameSelection) setDomainIndex(0);
        setActiveLive((current) => reduceLiveSnapshot(current, progressResponse.outcome === "unchanged" && definitionResponse.outcome === "unchanged" ? "unchanged" : "accepted", true));
      } else if (oven) {
        const currentDefinition = ovenDetail?.id === oven.id ? ovenDetail : null;
        const query = currentDefinition ? terminalServerQuery(currentDefinition.ir as unknown as TerminalOvenIR, terminalRuntimeRef.current?.state ?? null) : undefined;
        terminalQueryRef.current = JSON.stringify([burnlist.repoKey, oven.id, currentDefinition?.repoKey ?? null, query ?? {}]);
        const [snapshotResponse, definitionResponse] = await Promise.all([client.ovenDataResult(oven.id, burnlist.repoKey, request.signal, query), client.ovenResult(oven.id, burnlist.repoKey, request.signal)]);
        if (!request.owns()) return;
        const snapshot = snapshotResponse.data;
        setOvenData(snapshot);
        setOvenDetail(definitionResponse.data);
        acceptTerminalPayload(definitionResponse.data, snapshot.payload as JsonValue, JSON.stringify([burnlist.repoKey, oven.id, definitionResponse.data.ovenRevision]));
        const payload = visualParityPayload(snapshot);
        const retainedDomain = domainIdRef.current;
        const target = Math.max(0, payload?.domains.findIndex((domain) => domain.qualification === "target") ?? 0);
        const nextDomain = retainedDomain ? payload?.domains.findIndex((domain) => domain.id === retainedDomain) ?? -1 : -1;
        const index = nextDomain >= 0 ? nextDomain : target;
        domainIdRef.current = payload?.domains[index]?.id ?? null;
        setDomainIndex(index);
        setActiveLive((current) => reduceLiveSnapshot(current, snapshotResponse.outcome === "unchanged" && definitionResponse.outcome === "unchanged" ? "unchanged" : "accepted", true));
      }
    } catch (cause) {
      if (request.owns()) {
        const message = cause instanceof Error ? cause.message : String(cause);
        const missing = cause instanceof DataClientError && isMissingSnapshotStatus(cause.status);
        if (missing) { setProgress(null); setOvenData(null); setOvenDetail(null); }
        setActiveLive((current) => reduceLiveSnapshot(current, missing ? "missing" : "rejected", null, message));
        setError(message);
      }
    } finally {
      if (request.owns()) setLoading(false);
    }
  }, [acceptTerminalPayload, activeOven?.id, activeOven?.repoKey, beginOvenRequest, client, ovenDetail, selectedBurnlist?.id, selectedBurnlist?.repoKey]);
  const loadCatalogOven = useCallback(async (oven: OvenSummary) => {
    const request = beginOvenRequest();
    const sameSelection = activeOven?.id === oven.id && activeOven?.repoKey === oven.repoKey;
    setLoading(true);
    setActiveLive((current) => sameSelection ? reduceLiveSnapshot(current, "loading") : reduceLiveSnapshot(initialLiveSnapshot<true>(), "loading"));
    setError(null);
    setActiveOven(oven);
    if (!sameSelection) setOvenDetail(null);
    try {
      const detail = await client.ovenResult(oven.id, oven.repoKey, request.signal);
      if (request.owns()) { setOvenDetail(detail.data); setActiveLive((current) => reduceLiveSnapshot(current, detail.outcome, true)); }
    } catch (cause) {
      if (request.owns()) {
        const message = cause instanceof Error ? cause.message : String(cause);
        const missing = cause instanceof DataClientError && isMissingSnapshotStatus(cause.status);
        if (missing) setOvenDetail(null);
        setActiveLive((current) => reduceLiveSnapshot(current, missing ? "missing" : "rejected", null, message));
        setError(message);
      }
    } finally {
      if (request.owns()) setLoading(false);
    }
  }, [activeOven?.id, activeOven?.repoKey, beginOvenRequest, client]);
  useEffect(() => { void loadLanding(); }, [loadLanding]);
  useEffect(() => () => ovenRequest.current.controller?.abort(), []);
  useEffect(() => {
    if (!selectedBurnlist || !activeOven || activeOven.contract === "checklist-progress@1" || !ovenDetail || !terminalState) return;
    const query = terminalServerQuery(ovenDetail.ir as unknown as TerminalOvenIR, terminalState);
    const key = JSON.stringify([selectedBurnlist.repoKey, activeOven.id, ovenDetail.repoKey, query]);
    if (terminalQueryRef.current === key) return;
    terminalQueryRef.current = key;
    void loadBurnlist(selectedBurnlist, activeOven, false);
  }, [activeOven, loadBurnlist, ovenDetail, selectedBurnlist, terminalState]);
  const refreshActive = useCallback(() => {
    if ((view === "burnlist" || view === "item") && selectedBurnlist) void loadBurnlist(selectedBurnlist, activeOven, false);
    if (view === "oven" && activeOven) void loadCatalogOven(activeOven);
  }, [activeOven, loadBurnlist, loadCatalogOven, selectedBurnlist, view]);
  const refresh = useCallback(() => { void loadLanding(); refreshActive(); }, [loadLanding, refreshActive]);
  const refreshActiveRef = useRef(refreshActive);
  useEffect(() => { refreshActiveRef.current = refreshActive; }, [refreshActive]);
  const activeDefinitionRef = useRef<{ ovenId: string; repoKey: string | null; definitionRepoKey: string | null; subjectId: string | null } | null>(null);
  useEffect(() => {
    activeDefinitionRef.current = activeOven ? {
      ovenId: activeOven.id,
      repoKey: selectedBurnlist?.repoKey ?? activeOven.repoKey,
      definitionRepoKey: ovenDetail?.repoKey ?? activeOven.repoKey,
      subjectId: selectedBurnlist?.id ?? null,
    } : null;
  }, [activeOven, ovenDetail?.repoKey, selectedBurnlist?.id, selectedBurnlist?.repoKey]);
  useEffect(() => observeDashboardEvents(client.base, {
    onInvalidate: (event?: OvenEvent) => {
      void loadLanding();
      let activeMatches = eventInvalidatesScope(event, activeDefinitionRef.current);
      if (event?.kind === "definition-changed") {
        const active = activeDefinitionRef.current;
        activeMatches = !!active && definitionChangeInvalidates(active, event);
      }
      if (activeMatches) refreshActiveRef.current();
    },
    onStatus: (status) => {
      setStreamStatus(status);
      if (status === "live") refreshActiveRef.current();
    },
  }), [client.base, loadLanding]);
  useEffect(() => {
    const timer = setInterval(() => void loadLanding(), 30_000);
    timer.unref?.();
    return () => clearInterval(timer);
  }, [loadLanding]);
  const openBurnlist = useCallback((burnlist: BurnlistSummary) => {
    const oven = associatedOven(burnlist, landing.ovens);
    setSelectedBurnlist(burnlist);
    pushView("burnlist");
    void loadBurnlist(burnlist, oven, true);
  }, [landing.ovens, loadBurnlist, pushView]);
  const openCatalogOven = useCallback((oven: OvenSummary) => {
    pushView("oven");
    if (oven.id !== "streaming-diff") { setStreamingNavigation(null); void loadCatalogOven(oven); return; }
    setStreamingNavigation(initStreamingDiffNavigation("oven-list"));
    void Promise.all([loadCatalogOven(oven), loadStreamingFeeds(client, streamingRepositories(landing.projects, oven.repoKey))]).then(([, feeds]) => setStreamingNavigation((state) => state ? reduceStreamingDiffNavigation(state, { type: "feedsLoaded", feeds }) : state)).catch((cause) => setStreamingNavigation((state) => state ? reduceStreamingDiffNavigation(state, { type: "feedsFailed", message: cause instanceof Error ? cause.message : String(cause) }) : state));
  }, [client, landing.projects, loadCatalogOven, pushView]);
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
    if (count > 1) setDomainIndex((current) => {
      const next = (current + direction + count) % count;
      const domain = visualParityPayload(ovenData)?.domains[next]?.id;
      const control = (ovenDetail?.ir as unknown as TerminalOvenIR | undefined)?.controls.find((item) => item.kind === "domain-tabs");
      if (domain && control?.id) dispatchTerminalAction({ type: "domainSelected", id: control.id, value: domain });
      domainIdRef.current = domain ?? null;
      return next;
    });
  }, [dispatchTerminalAction, ovenData, ovenDetail]);
  const pageTerminalCollection = useCallback((direction: -1 | 1) => {
    const ir = ovenDetail?.ir as unknown as TerminalOvenIR | undefined;
    const state = terminalRuntimeRef.current?.state;
    const collection = ir?.collections.find((item) => state?.collections[item.id]?.serverPage && (item.paging === "server" || item.paging === "auto"));
    if (collection) dispatchTerminalAction({ type: direction > 0 ? "pageNext" : "pagePrevious", collectionId: collection.id });
  }, [dispatchTerminalAction, ovenDetail]);
  const terminalControl = useCallback((kind: string) => (ovenDetail?.ir as unknown as TerminalOvenIR | undefined)?.controls.find((item) => item.kind === kind), [ovenDetail]);
  useKeyboard((key) => {
    if (key.name === "q") { if (view === "oven" && streamingNavigation?.page === "session") return setStreamingNavigation((state) => state ? reduceStreamingDiffNavigation(state, { type: "back" }) : state); return back(); }
    if (key.name === "escape") return navigation.length === 1 ? shutdown() : back();
    if (key.name === "r" && view === "oven" && streamingNavigation) {
      const current = streamingNavigation;
      if (current.page === "feeds") void loadStreamingFeeds(client, streamingRepositories(landing.projects, activeOven?.repoKey ?? null)).then((feeds) => setStreamingNavigation((state) => state ? reduceStreamingDiffNavigation(state, { type: "feedsLoaded", feeds }) : state)).catch((cause) => setStreamingNavigation((state) => state ? reduceStreamingDiffNavigation(state, { type: "feedsFailed", message: String(cause) }) : state));
      else if (current.session) setStreamingRefresh((value) => value + 1);
      return;
    }
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
    if (view === "oven" && streamingNavigation) {
      const current = streamingNavigation;
      if (current.page === "feeds") {
        if (key.name === "up" || key.name === "down") return setStreamingNavigation((state) => state ? reduceStreamingDiffNavigation(state, { type: "feedMoved", direction: key.name === "up" ? -1 : 1 }) : state);
        if (key.name === "return" || key.name === "enter") return setStreamingNavigation((state) => state ? reduceStreamingDiffNavigation(state, { type: "feedOpened" }) : state);
        return;
      }
      const card = (displayData?.payload as { cards?: Array<{ revId?: string; files?: unknown[] }> } | undefined)?.cards?.[current.selectedCard];
      const cardCount = (displayData?.payload as { cards?: unknown[] } | undefined)?.cards?.length ?? 0;
      if (key.name === "left" || key.name === "right") return setStreamingNavigation((state) => state ? reduceStreamingDiffNavigation(state, { type: "cardMoved", direction: key.name === "left" ? -1 : 1, cardCount }) : state);
      if (key.name === "up" || key.name === "down") return setStreamingNavigation((state) => state ? reduceStreamingDiffNavigation(state, { type: "fileMoved", direction: key.name === "up" ? -1 : 1, fileCount: card?.files?.length ?? 0 }) : state);
      if (key.name === "return" || key.name === "enter") { const file = card?.files?.[current.selectedFile] as { path?: string } | undefined; if (file?.path && card?.revId) return setStreamingNavigation((state) => state ? reduceStreamingDiffNavigation(state, { type: "fileToggled", key: `${card.revId}:${file.path}` }) : state); }
      return;
    }
    if (view === "burnlist") {
      if (searchControlId) {
        if (key.name === "escape" || key.name === "return" || key.name === "enter") return setSearchControlId(null);
        const value = terminalRuntimeRef.current?.state.controls[searchControlId];
        if (key.name === "backspace") return dispatchTerminalAction({ type: "queryChanged", id: searchControlId, value: typeof value === "string" ? value.slice(0, -1) : "" });
        if (key.name && key.name.length === 1) return dispatchTerminalAction({ type: "queryChanged", id: searchControlId, value: `${typeof value === "string" ? value : ""}${key.name}` });
        return;
      }
      if (key.name === "up") return moveItem(-1);
      if (key.name === "down") return moveItem(1);
      if (key.sequence === "[") return cycleLens(-1);
      if (key.sequence === "]") return cycleLens(1);
      if (key.name === "n") return pageTerminalCollection(1);
      if (key.name === "p") return pageTerminalCollection(-1);
      if (key.name === "z") {
        const ir = ovenDetail?.ir as unknown as TerminalOvenIR | undefined;
        const collection = ir?.collections.find((item) => terminalRuntimeRef.current?.state.collections[item.id]?.serverPage);
        const current = collection && terminalRuntimeRef.current?.state.collections[collection.id];
        const find = (nodes: readonly any[]): any[] => nodes.flatMap((node) => [node, ...find(node.children ?? [])]);
        const pagination = ir && find(ir.root).find((node) => node.kind === "pagination" && node.attributes.collectionFrom === collection?.id);
        const sizes = String(pagination?.attributes.pageSizes ?? "").split(" ").map(Number).filter((size) => Number.isSafeInteger(size) && size > 0);
        if (collection && current && sizes.length) dispatchTerminalAction({ type: "pageSizeChanged", collectionId: collection.id, pageSize: sizes[(sizes.indexOf(current.pageSize) + 1 + sizes.length) % sizes.length]! });
        return;
      }
      if (key.name === "x") { const control = terminalControl("search"); if (control) setSearchControlId(control.id); return; }
      if (key.name === "f" || key.name === "s") {
        const control = terminalControl(key.name === "f" ? "filter-toggle" : "sort-toggle");
        const current = control && terminalRuntimeRef.current?.state.controls[control.id];
        if (control) dispatchTerminalAction({ type: "toggleChanged", id: control.id, active: current !== true });
        return;
      }
      if (key.name === "m") {
        const control = terminalControl("mode-toggle");
        if (control) {
          const walk = (nodes: readonly any[]): any[] => nodes.flatMap((node) => [node, ...walk(node.children ?? [])]);
          const values = walk((ovenDetail?.ir as unknown as TerminalOvenIR).root).flatMap((node) => node.kind === "mode-toggle" && node.attributes.id === control.id ? node.children.map((child: any) => String(child.attributes.value ?? "")) : []);
          const current = String(terminalRuntimeRef.current?.state.controls[control.id] ?? "");
          const next = values[(values.indexOf(current) + 1 + values.length) % values.length];
          if (next) dispatchTerminalAction({ type: "modeSelected", id: control.id, value: next });
        }
        return;
      }
      return;
    }
    if (view === "item") {
      if (key.name === "up") return moveItem(-1);
      if (key.name === "down") return moveItem(1);
      if (key.name === "left") return cycleDomain(-1);
      if (key.name === "right") return cycleDomain(1);
    }
  });
  const notice = error ? { message: `${activeLive.stale ? "Showing the last canonical snapshot. " : ""}Cannot read ${client.base}: ${error}`, tone: "error" as const }
    : loading ? { message: activeLive.stale ? "Showing the last canonical snapshot while data refreshes…" : "Refreshing Burnlist data…", tone: "info" as const } : null;
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
    ovenRuntime={ovenRuntime}
    streamingNavigation={streamingNavigation}
  />;
}
