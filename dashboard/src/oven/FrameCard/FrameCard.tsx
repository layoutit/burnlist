import type { VisualParityDifference, VisualParityImage } from "@lib";
import { delta, percent } from "../utils/visual-parity-format";
import { ImageTriptych } from "../ImageTriptych";

type FrameCardProps = {
  status: string;
  frame: number;
  difference: VisualParityDifference;
  images: VisualParityImage[];
  label: string;
};

export function FrameCard({ status, frame, difference, images, label }: FrameCardProps) {
  return <article className={`visual-parity-frame ${status}`}><header><strong>Frame {frame}</strong><span>{status} · {percent(difference.ratio)} · mean {delta(difference.meanAbsoluteDelta)} · max {difference.maximumAbsoluteDelta}</span></header><ImageTriptych images={images} label={label} frame={frame} /></article>;
}
