import type { VisualParityDifference, VisualParityImage } from "@lib";
import { delta, percent } from "../utils/visual-parity-format";
import { AsciiBlock } from "../AsciiBlock";

/** One cell of a frame row. Add a kind here to compose a new renderer into parity. */
export type VisualParityTile =
  | ({ kind?: "image" } & VisualParityImage)
  | { kind: "ascii"; text: string; colors?: string[][] | null; label?: string; cols?: number; rows?: number };

type FrameCardProps = {
  status: string;
  frame: number;
  difference: VisualParityDifference;
  /** Preferred: heterogeneous tiles rendered in order. */
  tiles?: VisualParityTile[];
  /** Legacy image-only rows; treated as image tiles. */
  images?: VisualParityImage[];
  label: string;
};

function Tile({ tile, label, frame }: { tile: VisualParityTile; label: string; frame: number }) {
  if (tile.kind === "ascii") {
    return <AsciiBlock text={tile.text} colors={tile.colors ?? null} label={tile.label} cols={tile.cols} rows={tile.rows} />;
  }
  const image = tile as VisualParityImage;
  return <figure>
    <figcaption>{image.label}</figcaption>
    <img alt={`${label} ${String(image.label).toLowerCase()} frame ${frame}`} height={image.height} src={image.src ?? undefined} width={image.width} />
  </figure>;
}

export function FrameCard({ status, frame, difference, tiles, images, label }: FrameCardProps) {
  const cells: VisualParityTile[] = tiles?.length ? tiles : (images ?? []);
  return <article className={`visual-parity-frame ${status}`}>
    <header><strong>Frame {frame}</strong><span>{status} · {percent(difference.ratio)} · mean {delta(difference.meanAbsoluteDelta)} · max {difference.maximumAbsoluteDelta}</span></header>
    <div className="visual-parity-shots">
      {cells.map((tile, index) => <Tile key={`${index}-${"label" in tile ? tile.label : "tile"}`} tile={tile} label={label} frame={frame} />)}
    </div>
  </article>;
}
