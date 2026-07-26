import { Fragment, useLayoutEffect, useRef, useState } from "react";
import "./AsciiBlock.css";

type AsciiBlockProps = {
  text: string;
  colors?: string[][] | null;
  label?: string;
  cols?: number;
  rows?: number;
};

type ColorRun = { color: string; text: string };

// A monospace cell at font-size 1 is about 0.6 wide; glyphcss cells are 1 wide x 2 tall,
// so a 256x128 frame is square on screen. Render at a fixed base size and SCALE it to the
// tile, rather than shrinking the font - the text stays real, selectable text, and the
// block ends up exactly the same size as the images it sits beside.
const BASE_FONT = 10;
const CHAR_WIDTH = BASE_FONT * 0.6;
const LINE_HEIGHT = BASE_FONT;

function colorRuns(line: string, colors: string[] | undefined): ColorRun[] {
  const runs: ColorRun[] = [];
  for (const [index, character] of Array.from(line).entries()) {
    const color = colors?.[index] ?? "inherit";
    const previous = runs.at(-1);
    if (previous?.color === color) previous.text += character;
    else runs.push({ color, text: character });
  }
  return runs;
}

export function AsciiBlock({ text, colors = null, label, cols, rows }: AsciiBlockProps) {
  const lines = text.split("\n");
  const columnCount = cols ?? Math.max(...lines.map((line) => line.length), 1);
  const rowCount = rows ?? lines.length;
  const naturalWidth = columnCount * CHAR_WIDTH;
  const naturalHeight = rowCount * LINE_HEIGHT;
  const frameRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLPreElement>(null);
  const [scale, setScale] = useState(() => Math.min(1, 208 / naturalWidth, 208 / naturalHeight));

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const content = textRef.current;
    if (!frame || !content) return;
    const resize = () => {
      const contentWidth = Math.max(naturalWidth, content.scrollWidth);
      const contentHeight = Math.max(naturalHeight, content.scrollHeight);
      setScale(Math.min(1, frame.clientWidth / contentWidth, frame.clientHeight / contentHeight));
    };
    resize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(resize);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [naturalHeight, naturalWidth, text]);

  return <figure className="ascii-block" data-cols={columnCount} data-rows={rowCount}>
    <figcaption className="ascii-block__label">{label}</figcaption>
    <div className="ascii-block__frame" ref={frameRef}>
      <pre
        className="ascii-block__text"
        aria-label={label}
        ref={textRef}
        style={{ fontSize: `${BASE_FONT}px`, lineHeight: `${LINE_HEIGHT}px`, transform: `scale(${scale})`, width: naturalWidth, height: naturalHeight }}
      >{colors === null ? text : lines.map((line, lineIndex) => <Fragment key={lineIndex}>
        {colorRuns(line, colors[lineIndex]).map((run, runIndex) => <span key={runIndex} style={{ color: run.color }}>{run.text}</span>)}
        {lineIndex < lines.length - 1 ? "\n" : null}
      </Fragment>)}</pre>
    </div>
  </figure>;
}
