import {
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Activity,
  ArrowLeft,
  ChartBar,
  ChartLine,
  ChartPie,
  Eye,
  Gauge,
  GitCompareArrows,
  LayoutGrid,
  Pencil,
  Play,
  Plus,
  Save,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type OvenSummary = {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
};

type RepoSummary = { name: string; root: string };

type DetailSection = {
  id: string;
  title: string;
  description: string;
  widget: DetailType;
  source: string;
  format: "plain";
  column: number;
  row: number;
  columnSpan: number;
  rowSpan: number;
};

type OvenDetail = {
  version: 1;
  columns: number;
  rows: number;
  rowHeight: number;
  cells: DetailSection[];
};

type GridPoint = { row: number; column: number };
type GridRect = {
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
};
type DraftArea = GridRect & {
  description: string;
  widget: DetailType;
};

const DETAIL_TYPES = [
  { value: "metric", label: "Metric", Icon: Gauge },
  { value: "progress", label: "Progress", Icon: Activity },
  { value: "line-chart", label: "Line chart", Icon: ChartLine },
  { value: "bar-chart", label: "Bar chart", Icon: ChartBar },
  { value: "pie-chart", label: "Pie chart", Icon: ChartPie },
  { value: "table", label: "Table", Icon: Table2 },
  { value: "comparison", label: "Comparison", Icon: GitCompareArrows },
] as const;

type DetailType = (typeof DETAIL_TYPES)[number]["value"];
const NEW_OVEN_ROW_HEIGHT = 50;

const fieldClass = [
  "w-full rounded-md border border-white/10 bg-black/25 px-3 py-2",
  "text-sm text-foreground outline-none transition",
  "focus:border-primary/60 focus:ring-2 focus:ring-primary/15",
].join(" ");

const compactFieldClass = [
  "min-w-0 rounded border border-white/15 bg-black/45 px-2 py-1.5",
  "text-xs text-foreground outline-none",
  "focus:border-amber-300/70 focus:ring-2 focus:ring-amber-300/15",
].join(" ");

function slug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function bounds(start: GridPoint, end: GridPoint): GridRect {
  return {
    column: Math.min(start.column, end.column),
    row: Math.min(start.row, end.row),
    columnSpan: Math.abs(start.column - end.column) + 1,
    rowSpan: Math.abs(start.row - end.row) + 1,
  };
}

function overlaps(left: GridRect, right: GridRect) {
  return (
    left.column < right.column + right.columnSpan
    && left.column + left.columnSpan > right.column
    && left.row < right.row + right.rowSpan
    && left.row + left.rowSpan > right.row
  );
}

function gridAreaStyle(rect: GridRect) {
  return {
    gridColumn: String(rect.column) + " / span " + String(rect.columnSpan),
    gridRow: String(rect.row) + " / span " + String(rect.rowSpan),
  };
}

function detailTypeDefinition(value: DetailType) {
  return DETAIL_TYPES.find((detailType) => detailType.value === value)
    || DETAIL_TYPES[0];
}

function deriveSectionTitle(description: string, widget: DetailType) {
  const firstLine = description
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
  return (firstLine || detailTypeDefinition(widget).label).slice(0, 80);
}

function DetailTypePicker({
  value,
  onChange,
}: {
  value: DetailType;
  onChange: (value: DetailType) => void;
}) {
  return (
    <div
      aria-label="Metric chart type"
      className="flex flex-wrap gap-1"
      role="group"
    >
      {DETAIL_TYPES.map(({ value: option, label, Icon }) => {
        const selected = option === value;
        return (
          <button
            aria-label={label}
            aria-pressed={selected}
            className={[
              "grid size-8 place-items-center rounded border transition",
              selected
                ? "border-amber-300 bg-amber-300 text-black"
                : "border-white/15 bg-black/35 text-muted-foreground hover:border-amber-300/60 hover:text-foreground",
            ].join(" ")}
            key={option}
            onClick={() => onChange(option)}
            title={label}
            type="button"
          >
            <Icon aria-hidden="true" className="size-4" />
          </button>
        );
      })}
    </div>
  );
}

function PageHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-4">
      <Button asChild size="sm" variant="ghost">
        <a href="/">
          <ArrowLeft />
          Burnlists
        </a>
      </Button>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}

export function BurnActions() {
  return (
    <div className="flex items-center gap-2">
      <Button asChild size="sm" variant="outline">
        <a href="/ovens/new">
          <Plus />
          New Oven
        </a>
      </Button>
      <Button asChild size="sm">
        <a href="/runs/new">
          <Play />
          Run Burn
        </a>
      </Button>
    </div>
  );
}

function DetailSkeletonBuilder({
  detail,
  onChange,
  onError,
}: {
  detail: OvenDetail;
  onChange: (detail: OvenDetail) => void;
  onError: (message: string) => void;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const gestureRef = useRef<{
    pointerId: number;
    start: GridPoint;
    end: GridPoint;
  } | null>(null);
  const nextCell = useRef(1);
  const [dragArea, setDragArea] = useState<GridRect | null>(null);
  const [draft, setDraft] = useState<DraftArea | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const trackCells = useMemo(
    () => Array.from(
      { length: detail.rows * detail.columns },
      (_, index) => ({
        row: Math.floor(index / detail.columns) + 1,
        column: (index % detail.columns) + 1,
      }),
    ),
    [detail.columns, detail.rows],
  );
  useEffect(() => {
    if (draft) descriptionRef.current?.focus();
  }, [draft]);

  const pointFromPointer = (clientX: number, clientY: number): GridPoint | null => {
    const grid = gridRef.current;
    if (!grid) return null;
    const rect = grid.getBoundingClientRect();
    const width = Math.max(1, grid.clientWidth);
    const height = detail.rows * detail.rowHeight;
    const localX = Math.max(0, Math.min(width - 0.001, clientX - rect.left));
    const localY = Math.max(0, Math.min(height - 0.001, clientY - rect.top));
    return {
      column: Math.floor(localX / (width / detail.columns)) + 1,
      row: Math.floor(localY / detail.rowHeight) + 1,
    };
  };

  const releasePointer = (pointerId: number) => {
    const grid = gridRef.current;
    if (grid?.hasPointerCapture(pointerId)) {
      grid.releasePointerCapture(pointerId);
    }
  };

  const clearGesture = () => {
    const gesture = gestureRef.current;
    if (gesture) releasePointer(gesture.pointerId);
    gestureRef.current = null;
    setDragArea(null);
  };

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (!target.closest("[data-oven-grid-cell]")) return;
    const point = pointFromPointer(event.clientX, event.clientY);
    if (!point) return;
    if (detail.cells.some((cell) => overlaps(cell, {
      ...point,
      columnSpan: 1,
      rowSpan: 1,
    }))) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureRef.current = {
      pointerId: event.pointerId,
      start: point,
      end: point,
    };
    setDraft(null);
    setEditingId(null);
    setDragArea(bounds(point, point));
    onError("");
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const point = pointFromPointer(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    gesture.end = point;
    setDragArea(bounds(gesture.start, point));
  };

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const point = pointFromPointer(event.clientX, event.clientY) || gesture.end;
    const selected = bounds(gesture.start, point);
    clearGesture();

    if (selected.columnSpan === 1 && selected.rowSpan === 1) {
      onError("Drag across at least two cells to add a detail section.");
      return;
    }
    if (detail.cells.some((cell) => overlaps(cell, selected))) {
      onError("That section overlaps an existing detail section.");
      return;
    }

    setDraft({
      ...selected,
      description: "",
      widget: "metric",
    });
    onError("");
  };

  const cancelDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    clearGesture();
  };

  const addDraft = () => {
    if (!draft) return;
    const description = draft.description.trim();
    if (!description) {
      onError("Describe the metric before adding the detail section.");
      descriptionRef.current?.focus();
      return;
    }

    const usedIds = new Set(detail.cells.map((cell) => cell.id));
    let id = "panel-" + String(nextCell.current++);
    while (usedIds.has(id)) id = "panel-" + String(nextCell.current++);
    const cell: DetailSection = {
      id,
      title: deriveSectionTitle(description, draft.widget),
      description,
      widget: draft.widget,
      source: "",
      format: "plain",
      column: draft.column,
      row: draft.row,
      columnSpan: draft.columnSpan,
      rowSpan: draft.rowSpan,
    };
    onChange({ ...detail, cells: [...detail.cells, cell] });
    setDraft(null);
    setEditingId(id);
    onError("");
  };

  const updateCell = (id: string, patch: Partial<DetailSection>) => {
    onChange({
      ...detail,
      cells: detail.cells.map((cell) => (
        cell.id === id ? { ...cell, ...patch } : cell
      )),
    });
  };

  const deleteCell = (id: string) => {
    onChange({
      ...detail,
      cells: detail.cells.filter((cell) => cell.id !== id),
    });
    if (editingId === id) setEditingId(null);
    onError("");
  };

  return (
    <Card className="gap-0 border-0 bg-transparent py-0 shadow-none">
      <CardHeader className="px-0 pt-0 pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <LayoutGrid className="size-4" />
          Detail skeleton
        </CardTitle>
        <CardDescription>
          Build the Oven's detail page template by placing sections directly on the skeleton.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-0 py-0">
          <div
            aria-label="Oven detail page skeleton"
            className={[
              "relative grid select-none overflow-hidden border-t border-l border-white/12",
              "bg-black/25 touch-none",
            ].join(" ")}
            onPointerCancel={cancelDrag}
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={finishDrag}
            ref={gridRef}
            style={{
              gridTemplateColumns: "repeat("
                + String(detail.columns)
                + ", minmax(0, 1fr))",
              gridTemplateRows: "repeat("
                + String(detail.rows)
                + ", "
                + String(detail.rowHeight)
                + "px)",
            }}
          >
            {trackCells.map((point) => (
              <span
                aria-hidden="true"
                className={[
                  "min-w-0 cursor-crosshair border-r border-b border-white/12",
                  "bg-transparent hover:bg-amber-300/15",
                ].join(" ")}
                data-oven-grid-cell=""
                key={String(point.row) + ":" + String(point.column)}
              />
            ))}

            {dragArea && (
              <div
                aria-hidden="true"
                className={[
                  "pointer-events-none absolute inset-px z-10",
                  "border border-amber-300/80 bg-amber-300/25",
                ].join(" ")}
                style={gridAreaStyle(dragArea)}
              />
            )}

            {draft && (
              <section
                aria-label="New detail section"
                className={[
                  "absolute inset-px z-30 overflow-auto border-2 border-amber-300",
                  "bg-card p-2 shadow-xl shadow-black/35",
                ].join(" ")}
                style={gridAreaStyle(draft)}
              >
                <div className="grid min-h-full content-center gap-2">
                  <DetailTypePicker
                    onChange={(widget) => setDraft({ ...draft, widget })}
                    value={draft.widget}
                  />
                  <label>
                    <span className="sr-only">Describe the metric</span>
                    <textarea
                      aria-label="Describe the metric"
                      className={[
                        compactFieldClass,
                        "min-h-20 w-full resize-none",
                      ].join(" ")}
                      maxLength={2000}
                      onChange={(event) => setDraft({
                        ...draft,
                        description: event.target.value,
                      })}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setDraft(null);
                        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                          event.preventDefault();
                          addDraft();
                        }
                      }}
                      placeholder="Describe the metric"
                      ref={descriptionRef}
                      value={draft.description}
                    />
                  </label>
                  <div className="flex justify-end gap-1">
                    <Button
                      onClick={() => setDraft(null)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <X />
                      Cancel
                    </Button>
                    <Button onClick={addDraft} size="sm" type="button">
                      <Plus />
                      Add
                    </Button>
                  </div>
                </div>
              </section>
            )}

            {detail.cells.map((cell) => {
              const editing = editingId === cell.id;
              const selectedType = detailTypeDefinition(cell.widget);
              const SelectedIcon = selectedType.Icon;
              return (
                <section
                  aria-label={cell.title + " detail section"}
                  className={[
                    "group absolute inset-px z-20 overflow-auto border border-white/18",
                    "bg-card/95 outline outline-0 outline-amber-300 transition",
                    "hover:z-40 hover:outline-2 focus-within:z-40 focus-within:outline-2",
                  ].join(" ")}
                  key={cell.id}
                  style={gridAreaStyle(cell)}
                >
                  <div
                    className={[
                      "absolute top-0 right-0 z-10 flex bg-amber-300 text-black",
                      "opacity-0 transition-opacity",
                      "group-hover:opacity-100 group-focus-within:opacity-100",
                    ].join(" ")}
                  >
                    <button
                      aria-label={editing ? "Preview " + cell.title : "Edit " + cell.title}
                      className="grid size-8 place-items-center hover:bg-amber-400"
                      onClick={() => setEditingId(editing ? null : cell.id)}
                      type="button"
                    >
                      {editing ? <Eye className="size-4" /> : <Pencil className="size-4" />}
                    </button>
                    <button
                      aria-label={"Delete " + cell.title}
                      className="grid size-8 place-items-center hover:bg-destructive hover:text-white"
                      onClick={() => deleteCell(cell.id)}
                      type="button"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>

                  {editing ? (
                    <div className="grid min-h-full content-center gap-2 p-2 pt-9">
                      <DetailTypePicker
                        onChange={(widget) => updateCell(cell.id, {
                          widget,
                          title: deriveSectionTitle(cell.description, widget),
                        })}
                        value={cell.widget}
                      />
                      <label>
                        <span className="sr-only">Describe the metric</span>
                        <textarea
                          aria-label="Describe the metric"
                          className={[
                            compactFieldClass,
                            "min-h-20 w-full resize-none",
                          ].join(" ")}
                          maxLength={2000}
                          onChange={(event) => {
                            const description = event.target.value;
                            updateCell(cell.id, {
                              description,
                              title: deriveSectionTitle(description, cell.widget),
                            });
                          }}
                          placeholder="Describe the metric"
                          value={cell.description}
                        />
                      </label>
                    </div>
                  ) : (
                    <button
                      className="grid min-h-full w-full place-content-center gap-3 p-3 text-center"
                      onDoubleClick={() => setEditingId(cell.id)}
                      type="button"
                    >
                      <SelectedIcon
                        aria-hidden="true"
                        className="mx-auto size-6 text-amber-300"
                      />
                      <span className="whitespace-pre-wrap text-sm leading-5 text-foreground">
                        {cell.description}
                      </span>
                    </button>
                  )}
                </section>
              );
            })}
          </div>
      </CardContent>
    </Card>
  );
}

export function NewOvenPage() {
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idEdited, setIdEdited] = useState(false);
  const [instructions, setInstructions] = useState(
    "## Purpose\n\nDescribe what this Oven measures or completes."
      + "\n\n## State Contract\n\nDescribe the canonical Markdown or report state."
      + "\n\n## Run Inputs\n\nDescribe the inputs a Burn needs."
      + "\n\n## Evidence\n\nDescribe what proves the outcome.",
  );
  const [detail, setDetail] = useState<OvenDetail>({
    version: 1,
    columns: 12,
    rows: 16,
    rowHeight: NEW_OVEN_ROW_HEIGHT,
    cells: [],
  });
  const [writeToken, setWriteToken] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/ovens")
      .then((response) => response.json())
      .then((payload) => setWriteToken(payload.writeToken || ""))
      .catch(() => setError("Could not initialize Oven saving."));
  }, []);

  const changeDetailDimensions = (
    key: "columns" | "rows",
    rawValue: string,
  ) => {
    const ranges = {
      columns: [2, 24],
      rows: [2, 32],
    } as const;
    const [minimum, maximum] = ranges[key];
    const parsed = Number(rawValue);
    const value = Math.max(
      minimum,
      Math.min(maximum, Number.isFinite(parsed) ? parsed : detail[key]),
    );
    const next = { ...detail, [key]: value };
    if (next.cells.some((cell) => (
      cell.column + cell.columnSpan - 1 > next.columns
      || cell.row + cell.rowSpan - 1 > next.rows
    ))) {
      setError("Delete areas outside the new bounds before shrinking the grid.");
      return;
    }
    setDetail(next);
    setError("");
  };

  const saveOven = async (event: FormEvent) => {
    event.preventDefault();
    if (!detail.cells.length) {
      setError("Add at least one detail section.");
      return;
    }
    setSaving(true);
    setError("");
    setStatus("Saving Oven...");
    try {
      const response = await fetch("/api/ovens", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-burnlist-token": writeToken,
        },
        body: JSON.stringify({ id, name, instructions, detail }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Could not save Oven.");
      }
      setStatus("Saved " + payload.oven.name + " at " + payload.oven.path);
    } catch (cause) {
      setStatus("");
      setError(cause instanceof Error ? cause.message : "Could not save Oven.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="space-y-5" onSubmit={saveOven}>
      <PageHeader
        description="A declarative Burn recipe: Markdown instructions plus a non-executable detail skeleton."
        title="New Oven"
      />
      <div className="grid gap-5">
        <Card className="border-white/8 bg-card/80 shadow-xl shadow-black/10">
          <CardHeader>
            <CardTitle className="text-base">Oven instructions</CardTitle>
            <CardDescription>
              Define the outcome, canonical state, run inputs, and evidence rules in Markdown.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-4">
              <label className="grid gap-1.5 text-xs text-muted-foreground">
                Oven name
                <input
                  className={fieldClass}
                  maxLength={80}
                  onChange={(event) => {
                    setName(event.target.value);
                    if (!idEdited) setId(slug(event.target.value));
                  }}
                  placeholder="Release Readiness"
                  required
                  value={name}
                />
              </label>
              <label className="grid gap-1.5 text-xs text-muted-foreground">
                Oven id
                <input
                  className={fieldClass}
                  maxLength={48}
                  onChange={(event) => {
                    setIdEdited(true);
                    setId(slug(event.target.value));
                  }}
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  placeholder="release-readiness"
                  required
                  value={id}
                />
              </label>
              <label className="grid gap-1.5 text-xs text-muted-foreground">
                Columns
                <input
                  className={fieldClass}
                  max={24}
                  min={2}
                  onChange={(event) => changeDetailDimensions(
                    "columns",
                    event.target.value,
                  )}
                  type="number"
                  value={detail.columns}
                />
              </label>
              <label className="grid gap-1.5 text-xs text-muted-foreground">
                Rows
                <input
                  className={fieldClass}
                  max={32}
                  min={2}
                  onChange={(event) => changeDetailDimensions(
                    "rows",
                    event.target.value,
                  )}
                  type="number"
                  value={detail.rows}
                />
              </label>
            </div>
            <label className="grid gap-1.5 text-xs text-muted-foreground">
              Markdown instructions
              <textarea
                className={[fieldClass, "min-h-44 resize-y font-mono"].join(" ")}
                maxLength={65536}
                onChange={(event) => setInstructions(event.target.value)}
                required
                value={instructions}
              />
            </label>
          </CardContent>
        </Card>
        <DetailSkeletonBuilder
          detail={detail}
          key={String(detail.columns) + ":" + String(detail.rows)}
          onChange={setDetail}
          onError={setError}
        />
      </div>
      {(error || status) && (
        <p
          aria-live="polite"
          className={[
            "rounded-md border px-4 py-3 text-sm",
            error
              ? "border-destructive/35 bg-destructive/10 text-destructive-foreground"
              : "border-emerald-400/25 bg-emerald-400/8 text-emerald-300",
          ].join(" ")}
        >
          {error || status}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button asChild variant="outline">
          <a href="/">Cancel</a>
        </Button>
        <Button disabled={saving} type="submit">
          <Save />
          {saving ? "Saving…" : "Save Oven"}
        </Button>
      </div>
    </form>
  );
}

export function RunBurnPage() {
  const [ovens, setOvens] = useState<OvenSummary[]>([]);
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [writeToken, setWriteToken] = useState("");
  const [ovenId, setOvenId] = useState("checklist");
  const [repoRoot, setRepoRoot] = useState("");
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/ovens").then((response) => response.json()),
      fetch("/api/repos").then((response) => response.json()),
    ])
      .then(([ovensPayload, reposPayload]) => {
        setOvens(ovensPayload.ovens || []);
        setRepos(reposPayload.repos || []);
        setWriteToken(ovensPayload.writeToken || "");
        setRepoRoot(reposPayload.repos?.[0]?.root || "");
      })
      .catch(() => setError("Could not load Ovens or repositories."));
  }, []);

  const createRun = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setStatus("Creating run manifest...");
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-burnlist-token": writeToken,
        },
        body: JSON.stringify({ ovenId, repoRoot, title, objective }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Could not create run.");
      }
      setStatus(
        "Created "
          + payload.run.id
          + " at "
          + payload.run.path
          + ". Codex execution has not started.",
      );
    } catch (cause) {
      setStatus("");
      setError(cause instanceof Error ? cause.message : "Could not create run.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="space-y-5" onSubmit={createRun}>
      <PageHeader
        description="Choose an Oven and create an immutable local Run snapshot. The app never executes Oven instructions."
        title="Run Burn"
      />
      <Card className="mx-auto max-w-3xl border-white/8 bg-card/80 shadow-xl shadow-black/10">
        <CardHeader>
          <CardTitle className="text-base">Run request</CardTitle>
          <CardDescription>
            The selected Oven instructions and detail skeleton are snapshotted into
            ignored local state.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="grid gap-1.5 text-xs text-muted-foreground">
            Oven
            <select
              className={fieldClass}
              onChange={(event) => setOvenId(event.target.value)}
              required
              value={ovenId}
            >
              {ovens.map((oven) => (
                <option key={oven.id} value={oven.id}>
                  {oven.name} · {oven.builtIn ? "default" : "custom"}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-xs text-muted-foreground">
            Repository
            <select
              className={fieldClass}
              onChange={(event) => setRepoRoot(event.target.value)}
              required
              value={repoRoot}
            >
              {repos.map((repo) => (
                <option key={repo.root} value={repo.root}>
                  {repo.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-xs text-muted-foreground">
            Run title
            <input
              className={fieldClass}
              maxLength={120}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Release readiness pass"
              required
              value={title}
            />
          </label>
          <label className="grid gap-1.5 text-xs text-muted-foreground">
            Objective
            <textarea
              className={[fieldClass, "min-h-44 resize-y"].join(" ")}
              maxLength={12000}
              onChange={(event) => setObjective(event.target.value)}
              placeholder="Describe the outcome and any Oven-required inputs. For Target, include the measurement source, target, active gate, and comparable procedure."
              required
              value={objective}
            />
          </label>
          <p className="text-xs leading-5 text-muted-foreground">
            This creates the run manifest; it does not start Codex or execute
            commands from the Oven instructions.
          </p>
        </CardContent>
      </Card>
      {(error || status) && (
        <p
          aria-live="polite"
          className={[
            "mx-auto max-w-3xl rounded-md border px-4 py-3 text-sm",
            error
              ? "border-destructive/35 bg-destructive/10 text-destructive-foreground"
              : "border-emerald-400/25 bg-emerald-400/8 text-emerald-300",
          ].join(" ")}
        >
          {error || status}
        </p>
      )}
      <div className="mx-auto flex max-w-3xl justify-end gap-2">
        <Button asChild variant="outline">
          <a href="/">Cancel</a>
        </Button>
        <Button
          disabled={saving || !repos.length || !ovens.length}
          type="submit"
        >
          <Play />
          {saving ? "Creating…" : "Run Burn"}
        </Button>
      </div>
    </form>
  );
}
