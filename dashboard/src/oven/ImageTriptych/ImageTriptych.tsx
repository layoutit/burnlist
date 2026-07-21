import type { VisualParityImage } from "@lib";

type ImageTriptychProps = {
  images: VisualParityImage[];
  label: string;
  frame: number;
};

export function ImageTriptych({ images, label, frame }: ImageTriptychProps) {
  return <div className="visual-parity-shots">{images.map((image) => <figure key={image.label}><figcaption>{image.label}</figcaption><img alt={`${label} ${image.label.toLowerCase()} frame ${frame}`} height={image.height} src={image.src ?? undefined} width={image.width} /></figure>)}</div>;
}
