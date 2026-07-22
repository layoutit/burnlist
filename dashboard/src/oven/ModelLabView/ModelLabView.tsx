import { useEffect, useMemo, useRef, useState } from "react";

type RuntimeConstruction = {
  assetBuildCount: number;
  geometryBuildCount: number;
  materialBuildCount: number;
  sourceParseCount: number;
  topologyBuildCount: number;
};

type ModelAnimation = {
  id: string;
  slotId: number;
  symbol: string;
  firstFrameIndex: number;
  firstFrameId: string;
  frameCount: number;
};

type ComparisonImage = {
  url: string;
  sha256: string;
  width: number;
  height: number;
};

type ModelLabComparison = {
  schema: "burnlist-model-lab-comparison@1";
  frameId: string;
  referenceLabel: "Native";
  candidateLabel: "Model Lab";
  channelThreshold: number;
  pass: boolean;
  reportSha256: string;
  angles: Array<{
    angle: 0 | 45 | 180;
    native: ComparisonImage;
    candidate: ComparisonImage;
    diff: ComparisonImage;
    metrics: {
      meanAbsDelta: number;
      rmsDelta: number;
      maxAbsDelta: number;
      changedPixelRatio: number;
      pass: boolean;
    };
  }>;
};

export type ModelLabPayload = {
  schema: "burnlist-model-lab-data@1";
  generatedAt: string;
  project: { id: string; label: string };
  surface: { title: string; url: string };
  model: {
    id: string;
    actor: {
      id: string;
      name: string;
      country: string;
      shirtNumber: number;
      sourceTeamSlot: "A" | "B";
    };
    animations: ModelAnimation[];
    frameIndex: number;
    frameId: string;
    frameCount: number;
    polygonCount: number;
    leafCount: number;
    leafTag: "s";
    topologyMode: "stable-frame-set";
    lodCount: 1;
    droppedSourcePolygonCount: number;
    topologyHash: string;
    frameSetHash: string;
    runtimeConstruction: RuntimeConstruction;
  };
  evidence: {
    manifestSha256: string;
    renderPublicationSha256: string;
    prepareInputsSha256: string;
  };
  comparison?: ModelLabComparison;
};

type RuntimeStats = {
  ready: boolean;
  modelId: string;
  frameIndex: number;
  frameId: string;
  frameCount: number;
  leafCount: number;
  visibleLeafCount: number;
  renderedLeafCount: number;
  stableRootIdentity: boolean;
  stableLeafIdentityCount: number;
  connectedLeafCount: number;
  childListMutationCount: number;
  droppedSourcePolygonCount: number;
  leafTags: string[];
  runtimeConstruction: RuntimeConstruction;
};

type RuntimeMessage = {
  schema: "polycss-model-lab-state@1";
  status: "ready" | "error";
  stats?: RuntimeStats;
  error?: string;
};

const MODEL_LAB_COMMAND_SCHEMA = "polycss-model-lab-command@1";

function shortHash(value: string) {
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function zeroRuntimeConstruction(value: RuntimeConstruction | undefined) {
  return Boolean(value) && Object.values(value!).every((count) => count === 0);
}

function metric(label: string, value: string, tone = "") {
  return (
    <div className={`model-lab-metric${tone ? ` is-${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function comparisonFigure(label: string, image: ComparisonImage, detail?: string) {
  return (
    <figure className="model-lab-comparison-figure">
      <figcaption>
        <strong>{label}</strong>
        {detail && <span>{detail}</span>}
      </figcaption>
      <img src={image.url} width={image.width} height={image.height} alt={label} title={image.sha256} />
    </figure>
  );
}

export function ModelLabView({ payload }: { payload: ModelLabPayload }) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const [runtime, setRuntime] = useState<RuntimeMessage | null>(null);
  const surfaceUrl = useMemo(() => {
    const url = new URL(payload.surface.url);
    url.searchParams.set("embedded", "1");
    url.searchParams.set("model", payload.model.id);
    url.searchParams.set("frame", String(payload.model.frameIndex));
    return url.href;
  }, [payload.surface.url, payload.model.id, payload.model.frameIndex]);

  useEffect(() => {
    setRuntime(null);
    const expectedOrigin = new URL(surfaceUrl).origin;
    const receive = (event: MessageEvent<RuntimeMessage>) => {
      if (event.source !== iframe.current?.contentWindow || event.origin !== expectedOrigin) return;
      if (event.data?.schema !== "polycss-model-lab-state@1") return;
      setRuntime(event.data);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [surfaceUrl]);

  const live = runtime?.stats;
  const leafCount = live?.leafCount ?? payload.model.leafCount;
  const stableLeaves = live?.stableLeafIdentityCount;
  const leafTagsAreS = live ? live.leafTags.length === leafCount && live.leafTags.every((tag) => tag === "s") : true;
  const runtimeZero = zeroRuntimeConstruction(live?.runtimeConstruction ?? payload.model.runtimeConstruction);
  const liveReady = runtime?.status === "ready" && live?.ready === true;
  const frameIndex = live?.frameIndex ?? payload.model.frameIndex;
  const frameId = live?.frameId ?? payload.model.frameId;
  const activeAnimation = payload.model.animations.find(({ firstFrameIndex, frameCount }) => (
    frameIndex >= firstFrameIndex && frameIndex < firstFrameIndex + frameCount
  ));
  const selectAnimation = (animationId: string) => {
    const animation = payload.model.animations.find(({ id }) => id === animationId);
    if (!animation || !iframe.current?.contentWindow) return;
    iframe.current.contentWindow.postMessage({
      schema: MODEL_LAB_COMMAND_SCHEMA,
      command: "set-frame",
      frameIndex: animation.firstFrameIndex,
    }, new URL(surfaceUrl).origin);
  };

  return (
    <section className="model-lab-oven" data-live={liveReady ? "ready" : runtime?.status ?? "loading"}>
      <header className="model-lab-oven-toolbar">
        <h1>{payload.project.label} · {payload.model.id}</h1>
        <p aria-label="Model contract">
          <span className={liveReady ? "is-pass" : ""}>{liveReady ? "Live DOM" : "Connecting"}</span>
          <span aria-hidden="true">·</span>
          <span>one frameset</span>
          <span aria-hidden="true">·</span>
          <span>no LOD</span>
          <span aria-hidden="true">·</span>
          <span><code>&lt;s&gt;</code> × {leafCount}</span>
        </p>
      </header>

      <div className="model-lab-oven-layout">
        <section className="model-lab-oven-stage" aria-label="Live prepared model">
          <iframe
            key={payload.evidence.renderPublicationSha256}
            ref={iframe}
            allow="fullscreen"
            src={surfaceUrl}
            title={payload.surface.title}
          />
          {runtime?.status === "error" && (
            <div className="model-lab-oven-overlay is-error">{runtime.error ?? "The live Model Lab surface failed."}</div>
          )}
        </section>

        <aside className="model-lab-oven-rail" aria-label="Model Lab evidence">
          <section className="model-lab-oven-card">
            <h2>Player animation</h2>
            <label className="model-lab-animation-select">
              <span>Source animation</span>
              <select
                aria-label="Source animation"
                value={activeAnimation?.id ?? ""}
                disabled={!liveReady}
                onChange={(event) => selectAnimation(event.currentTarget.value)}
              >
                {payload.model.animations.map((animation) => (
                  <option key={animation.id} value={animation.id}>
                    {String(animation.slotId).padStart(3, "0")} · {animation.symbol} · {animation.frameCount}f
                  </option>
                ))}
              </select>
            </label>
            <p className="model-lab-animation-frame">
              {activeAnimation ? `${activeAnimation.firstFrameId} · starts at ${activeAnimation.firstFrameIndex}` : "Unknown prepared animation"}
            </p>
          </section>

          <section className="model-lab-oven-card">
            <h2>Live DOM</h2>
            <div className="model-lab-metrics">
              {metric("frame", `${frameIndex} / ${payload.model.frameCount - 1}`)}
              {metric("visible", live ? `${live.visibleLeafCount}/${leafCount}` : "waiting")}
              {metric("rendered", live ? `${live.renderedLeafCount}/${leafCount}` : "waiting")}
              {metric("stable", stableLeaves === undefined ? "waiting" : `${stableLeaves}/${leafCount}`, stableLeaves === leafCount ? "pass" : stableLeaves === undefined ? "" : "fail")}
              {metric("child mutations", live ? String(live.childListMutationCount) : "waiting", live?.childListMutationCount === 0 ? "pass" : live ? "fail" : "")}
              {metric("leaf tags", leafTagsAreS ? `<s> × ${leafCount}` : "mismatch", leafTagsAreS ? "pass" : "fail")}
            </div>
          </section>

          <section className="model-lab-oven-card">
            <h2>Prepared contract</h2>
            <dl>
              <div><dt>Player</dt><dd>{payload.model.actor.country} #{payload.model.actor.shirtNumber} · {payload.model.actor.name}</dd></div>
              <div><dt>Frame id</dt><dd>{frameId}</dd></div>
              <div><dt>Topology</dt><dd>stable frame set</dd></div>
              <div><dt>LOD</dt><dd>1 · disabled</dd></div>
              <div><dt>Dropped source polygons</dt><dd>{payload.model.droppedSourcePolygonCount}</dd></div>
              <div><dt>Runtime construction</dt><dd className={runtimeZero ? "is-pass" : "is-fail"}>{runtimeZero ? "all zero" : "non-zero"}</dd></div>
            </dl>
          </section>

          <section className="model-lab-oven-card">
            <h2>Artifact binding</h2>
            <dl className="model-lab-hashes">
              <div><dt>Manifest</dt><dd title={payload.evidence.manifestSha256}>{shortHash(payload.evidence.manifestSha256)}</dd></div>
              <div><dt>Render</dt><dd title={payload.evidence.renderPublicationSha256}>{shortHash(payload.evidence.renderPublicationSha256)}</dd></div>
              <div><dt>Topology</dt><dd title={payload.model.topologyHash}>{shortHash(payload.model.topologyHash)}</dd></div>
              <div><dt>Frameset</dt><dd title={payload.model.frameSetHash}>{shortHash(payload.model.frameSetHash)}</dd></div>
            </dl>
          </section>
        </aside>

        {payload.comparison && (
          <section className="model-lab-comparison" aria-label="Native and Model Lab image comparison">
            <header>
              <div>
                <h2>Native / Model Lab / Diff</h2>
                <p>{payload.comparison.frameId} · isolated capture · channel Δ &gt; {payload.comparison.channelThreshold}</p>
              </div>
              <strong className={payload.comparison.pass ? "is-pass" : "is-fail"}>
                {payload.comparison.pass ? "MATCH" : "DIFF OPEN"}
              </strong>
            </header>

            <div className="model-lab-comparison-table">
              <div className="model-lab-comparison-columns" aria-hidden="true">
                <span>Angle</span>
                <span>{payload.comparison.referenceLabel}</span>
                <span>{payload.comparison.candidateLabel}</span>
                <span>Diff ×4</span>
              </div>
              {payload.comparison.angles.map((entry) => (
                <article className="model-lab-comparison-row" key={entry.angle}>
                  <h3>{entry.angle}°</h3>
                  {comparisonFigure(`Native ${entry.angle}°`, entry.native)}
                  {comparisonFigure(`Model Lab ${entry.angle}°`, entry.candidate)}
                  {comparisonFigure(
                    `Diff ${entry.angle}°`,
                    entry.diff,
                    `mean ${entry.metrics.meanAbsDelta.toFixed(3)} · changed ${(entry.metrics.changedPixelRatio * 100).toFixed(2)}%`,
                  )}
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
    </section>
  );
}
