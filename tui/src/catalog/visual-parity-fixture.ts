import { adaptVisualParity } from "../../../dashboard/src/lib/visual-parity-oven-adapter";

export const visualParityPng = { current: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP4z8DwH4QZYAwAR8oH+WdZbrcAAAAASUVORK5CYII=", reference: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAADklEQVR4nGNg+A+FMAYAQ84H+fei4u8AAAAASUVORK5CYII=", difference: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEElEQVR4nGNgYPj/H4KhDAA/0gf5tBJPzQAAAABJRU5ErkJggg==" } as const;
const images = (frame: number) => [{ label: `Current F${frame}`, src: visualParityPng.current, width: 2, height: 2 }, { label: `Reference F${frame}`, src: visualParityPng.reference, width: 2, height: 2 }, { label: `Difference F${frame}`, src: visualParityPng.difference, width: 2, height: 2 }];
const difference = (ratio: number, meanAbsoluteDelta: number, maximumAbsoluteDelta: number) => ({ changedPixels: 1, totalPixels: 50, ratio, meanAbsoluteDelta, maximumAbsoluteDelta });
const raw = {
  schema: "burnlist-visual-parity-data@1", differentialTesting: { scenarioCatalog: { selectedScenarioId: "fixture", scenarios: [] } },
  domains: [{ id: "desktop", label: "desktop", isolation: "render-pass", qualification: "target", tolerance: { rationale: "Desktop is the release target." } }, { id: "mobile", label: "mobile", isolation: "render-pass", qualification: "context", tolerance: { rationale: "Mobile remains diagnostic." } }],
  comparisons: [
    { id: "desktop-7", label: "Homepage", frame: 7, status: "pass", domains: { desktop: { label: "Homepage", status: "pass", reference: images(7)[0], candidate: images(7)[1], diff: images(7)[2], difference: difference(0.02, 0.125, 8) }, mobile: { label: "Mobile homepage", status: "fail", reference: images(8)[0], candidate: images(8)[1], diff: images(8)[2], difference: difference(0.11, 1.25, 20) } } },
    { id: "desktop-8", label: "Homepage", frame: 8, status: "pass", domains: { desktop: { label: "Homepage", status: "pass", reference: images(7)[0], candidate: images(7)[1], diff: images(7)[2], difference: difference(0.02, 0.125, 8) }, mobile: { label: "Mobile homepage", status: "pass", reference: images(8)[0], candidate: images(8)[1], diff: images(8)[2], difference: difference(0.11, 1.25, 20) } } },
    { id: "desktop-9", label: "Homepage", frame: 9, status: "pass", domains: { desktop: { label: "Homepage", status: "pass", reference: images(7)[0], candidate: images(7)[1], diff: images(7)[2], difference: difference(0.02, 0.125, 8) }, mobile: { label: "Mobile homepage", status: "pass", reference: images(8)[0], candidate: images(8)[1], diff: images(8)[2], difference: difference(0.11, 1.25, 20) } } },
  ],
} as const;
export const visualParityFixture = { id: "visual-parity", title: "Visual Parity media", detail: "IR-bound image comparison", checkpoints: ["desktop", "mobile"] as const, raw, payload: adaptVisualParity(raw as never) as any } as const;
