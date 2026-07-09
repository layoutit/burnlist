(() => {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const NEW_OVEN_ROW_HEIGHT = 50;
  const chartTypes = [
    { id: "metric", label: "Metric" },
    { id: "progress", label: "Progress" },
    { id: "line-chart", label: "Line chart" },
    { id: "bar-chart", label: "Bar chart" },
    { id: "pie-chart", label: "Pie chart" },
    { id: "table", label: "Table" },
  ];

  function chartTypeLabel(type) {
    return chartTypes.find((entry) => entry.id === type)?.label || "Chart";
  }

  function derivedTitle(description, type) {
    const firstLine = String(description).split(/\r?\n/u).map((line) => line.trim()).find(Boolean);
    return (firstLine || chartTypeLabel(type)).slice(0, 80);
  }

  function svgNode(name, attributes = {}) {
    const node = document.createElementNS(SVG_NS, name);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
    return node;
  }

  function chartTypeIcon(type) {
    const svg = svgNode("svg", {
      class: "grid-chart-icon",
      viewBox: "0 0 24 24",
      width: 20,
      height: 20,
      fill: "none",
      stroke: "currentColor",
      "stroke-width": 1.75,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      focusable: "false",
    });
    const title = svgNode("title");
    title.textContent = chartTypeLabel(type);
    svg.append(title);
    const shapes = {
      metric: [
        ["rect", { x: 3, y: 4, width: 18, height: 16, rx: 2 }],
        ["path", { d: "M7 9h10M7 13h6M7 17h8" }],
      ],
      progress: [
        ["path", { d: "M5 7h14M5 12h14M5 17h14" }],
        ["path", { d: "M5 7h9M5 12h12M5 17h6", "stroke-width": 3 }],
      ],
      "line-chart": [
        ["path", { d: "M4 19h16M5 16l4-5 4 3 6-8" }],
        ["circle", { cx: 9, cy: 11, r: 1 }],
        ["circle", { cx: 13, cy: 14, r: 1 }],
        ["circle", { cx: 19, cy: 6, r: 1 }],
      ],
      "bar-chart": [
        ["path", { d: "M4 20h16" }],
        ["rect", { x: 5, y: 12, width: 3, height: 8, rx: 0.5 }],
        ["rect", { x: 10.5, y: 8, width: 3, height: 12, rx: 0.5 }],
        ["rect", { x: 16, y: 4, width: 3, height: 16, rx: 0.5 }],
      ],
      "pie-chart": [
        ["circle", { cx: 12, cy: 12, r: 8 }],
        ["path", { d: "M12 4v8h8" }],
      ],
      table: [
        ["rect", { x: 3, y: 5, width: 18, height: 14, rx: 1 }],
        ["path", { d: "M3 10h18M3 14.5h18M9 5v14M15 5v14" }],
      ],
    };
    (shapes[type] || shapes.metric).forEach(([name, attributes]) => svg.append(svgNode(name, attributes)));
    return svg;
  }

  function setMessage(output, text, error = false) {
    output.textContent = text;
    output.classList.toggle("error", error);
  }

  function slug(value) {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
  }

  function normalizeDimensionControls(form) {
    const definition = form.querySelector(".oven-definition-card");
    const markdownField = form.querySelector("#oven-definition")?.closest(".field");
    if (!definition || !markdownField) return;

    if (!document.querySelector("#oven-fields-row-layout")) {
      const style = document.createElement("style");
      style.id = "oven-fields-row-layout";
      style.textContent = ".burnlist-fallback .oven-fields-row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}"
        + "@media(max-width:900px){.burnlist-fallback .oven-fields-row{grid-template-columns:repeat(2,minmax(0,1fr))}}"
        + "@media(max-width:600px){.burnlist-fallback .oven-fields-row{grid-template-columns:1fr}}";
      document.head.append(style);
    }

    [
      ["#grid-columns", "Columns"],
      ["#grid-rows", "Rows"],
    ].forEach(([selector, labelText]) => {
      const input = form.querySelector(selector);
      const label = input?.closest("label");
      if (!input || !label) return;
      const caption = document.createElement("span");
      caption.textContent = labelText;
      label.className = "field";
      label.replaceChildren(caption, input);
      definition.insertBefore(label, markdownField);
    });

    let fieldsRow = definition.querySelector(".oven-fields-row");
    if (!fieldsRow) {
      fieldsRow = document.createElement("div");
      fieldsRow.className = "oven-fields-row";
      definition.insertBefore(fieldsRow, markdownField);
    }
    ["#oven-name", "#oven-id", "#grid-columns", "#grid-rows"].forEach((selector) => {
      const label = form.querySelector(selector)?.closest("label");
      if (label) fieldsRow.append(label);
    });

    [...definition.children]
      .filter((child) => child.classList.contains("hint"))
      .forEach((hint) => hint.remove());

    form.querySelector("#grid-row-height")?.closest("label")?.remove();
    const legacyControls = form.querySelector(".builder-controls");
    legacyControls?.remove();
    form.querySelector(".oven-builder > .builder-hint")?.remove();
  }

  function initializeOvenBuilder() {
    const form = document.querySelector("#oven-form");
    if (!form) return;
    normalizeDimensionControls(form);
    const state = {
      columns: 12,
      rows: 16,
      rowHeight: NEW_OVEN_ROW_HEIGHT,
      cells: [],
    };
    const grid = document.querySelector("#oven-grid");
    const output = document.querySelector("#oven-status");
    const nameInput = document.querySelector("#oven-name");
    const idInput = document.querySelector("#oven-id");
    let idEdited = false;
    let drag = null;
    let draft = null;
    let nextCellId = 1;
    let writeToken = "";
    const areaModes = new Map();

    function selectionBounds(start, end) {
      if (!start || !end) return null;
      const column = Math.min(start.column, end.column);
      const row = Math.min(start.row, end.row);
      return {
        column,
        row,
        columnSpan: Math.abs(start.column - end.column) + 1,
        rowSpan: Math.abs(start.row - end.row) + 1,
      };
    }

    function overlaps(left, right) {
      return left.column < right.column + right.columnSpan
        && left.column + left.columnSpan > right.column
        && left.row < right.row + right.rowSpan
        && left.row + left.rowSpan > right.row;
    }

    function pointFromPointer(event) {
      const rect = grid.getBoundingClientRect();
      const contentLeft = rect.left + grid.clientLeft;
      const contentTop = rect.top + grid.clientTop;
      const width = Math.max(1, grid.clientWidth);
      const height = Math.max(1, grid.clientHeight);
      const x = Math.min(Math.max(event.clientX - contentLeft, 0), width - 0.001);
      const y = Math.min(Math.max(event.clientY - contentTop, 0), height - 0.001);
      return {
        column: Math.min(state.columns, Math.floor((x / width) * state.columns) + 1),
        row: Math.min(state.rows, Math.floor((y / height) * state.rows) + 1),
      };
    }

    function place(element, area) {
      element.style.gridColumn = `${area.column} / span ${area.columnSpan}`;
      element.style.gridRow = `${area.row} / span ${area.rowSpan}`;
    }

    function chartTypePicker(selected, onSelect, label) {
      const picker = document.createElement("div");
      picker.className = "grid-chart-picker";
      picker.setAttribute("role", "group");
      picker.setAttribute("aria-label", label);
      const buttons = [];
      const select = (type) => {
        buttons.forEach((button) => {
          const active = button.dataset.chartType === type;
          button.classList.toggle("is-selected", active);
          button.setAttribute("aria-pressed", String(active));
        });
        onSelect(type);
      };
      chartTypes.forEach((type) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "grid-chart-type";
        button.dataset.chartType = type.id;
        button.title = type.label;
        button.setAttribute("aria-label", type.label);
        button.setAttribute("aria-pressed", String(type.id === selected));
        button.classList.toggle("is-selected", type.id === selected);
        button.append(chartTypeIcon(type.id));
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          select(type.id);
        });
        buttons.push(button);
        picker.append(button);
      });
      return picker;
    }

    function metricDescription(value, onInput, draftField = false) {
      const label = document.createElement("label");
      label.className = "grid-metric-description";
      const caption = document.createElement("span");
      caption.className = "grid-metric-label";
      caption.textContent = "Describe the metric";
      const textarea = document.createElement("textarea");
      textarea.className = "grid-area-description";
      textarea.maxLength = 2000;
      textarea.placeholder = "Describe the metric";
      textarea.setAttribute("aria-label", "Describe the metric");
      if (draftField) textarea.dataset.draftDescription = "";
      textarea.value = value;
      textarea.addEventListener("input", () => onInput(textarea.value));
      label.append(caption, textarea);
      return label;
    }

    function actionButton(label, className, action) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = className;
      button.textContent = label;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        action();
      });
      return button;
    }

    function renderSelector(area, phase) {
      const selector = document.createElement("section");
      selector.className = `grid-selector ${phase === "draft" ? "is-draft" : "is-selecting"}`;
      selector.dataset.phase = phase;
      selector.style.zIndex = "3";
      selector.style.pointerEvents = phase === "draft" ? "auto" : "none";
      place(selector, area);
      if (phase === "selecting") {
        selector.setAttribute("aria-hidden", "true");
        return selector;
      }

      selector.setAttribute("aria-label", "Draft detail section");
      const editor = document.createElement("div");
      editor.className = "grid-area-editor draft-area-editor";
      const picker = chartTypePicker(draft.widget, (type) => {
        draft.widget = type;
        draft.title = derivedTitle(draft.description, type);
      }, "Draft chart type");
      const description = metricDescription(draft.description, (value) => {
        draft.description = value;
        draft.title = derivedTitle(value, draft.widget);
      }, true);
      const actions = document.createElement("div");
      actions.className = "grid-area-actions";
      actions.append(
        actionButton("Add", "grid-area-action add", () => {
          const descriptionValue = draft.description.trim();
          if (!descriptionValue) {
            setMessage(output, "Describe the metric before adding it.", true);
            return;
          }
          const id = `panel-${nextCellId++}`;
          state.cells.push({
            id,
            title: derivedTitle(descriptionValue, draft.widget),
            widget: draft.widget,
            description: descriptionValue,
            source: "",
            format: "plain",
            column: draft.column,
            row: draft.row,
            columnSpan: draft.columnSpan,
            rowSpan: draft.rowSpan,
          });
          areaModes.set(id, "edit");
          draft = null;
          setMessage(output, "");
          renderGrid();
          requestAnimationFrame(() => {
            grid.querySelector(`[data-area-id="${id}"] .grid-area-description`)?.focus();
          });
        }),
        actionButton("Cancel", "grid-area-action cancel", () => {
          draft = null;
          setMessage(output, "");
          renderGrid();
        }),
      );
      editor.append(picker, description, actions);
      selector.append(editor);
      return selector;
    }

    function renderSavedArea(area) {
      const block = document.createElement("section");
      const mode = areaModes.get(area.id) || "preview";
      block.className = `grid-panel saved-grid-area is-${mode}`;
      block.dataset.areaId = area.id;
      block.style.zIndex = "2";
      block.style.pointerEvents = "auto";
      place(block, area);

      const toolbar = document.createElement("div");
      toolbar.className = "grid-area-toolbar";
      toolbar.append(
        actionButton("Edit", "grid-area-action edit", () => {
          areaModes.set(area.id, "edit");
          renderGrid();
          requestAnimationFrame(() => {
            grid.querySelector(`[data-area-id="${area.id}"] .grid-area-description`)?.focus();
          });
        }),
        actionButton("Preview", "grid-area-action preview", () => {
          areaModes.set(area.id, "preview");
          renderGrid();
        }),
        actionButton("Delete", "grid-area-action delete", () => {
          state.cells = state.cells.filter((entry) => entry.id !== area.id);
          areaModes.delete(area.id);
          setMessage(output, "");
          renderGrid();
        }),
      );
      block.append(toolbar);

      if (mode === "edit") {
        const editor = document.createElement("div");
        editor.className = "grid-area-editor saved-area-editor";
        const picker = chartTypePicker(area.widget, (type) => {
          area.widget = type;
          area.title = derivedTitle(area.description, type);
        }, `${area.title} chart type`);
        const description = metricDescription(area.description, (value) => {
          area.description = value;
          area.title = derivedTitle(value, area.widget);
        });
        editor.append(picker, description);
        block.append(editor);
      } else {
        const preview = document.createElement("div");
        preview.className = "grid-area-preview";
        const icon = document.createElement("span");
        icon.className = "grid-area-preview-icon";
        icon.title = chartTypeLabel(area.widget);
        icon.setAttribute("aria-label", chartTypeLabel(area.widget));
        icon.append(chartTypeIcon(area.widget));
        const description = document.createElement("p");
        description.className = "grid-area-preview-description";
        description.textContent = area.description;
        preview.append(icon, description);
        block.append(preview);
      }
      return block;
    }

    function finishSelection(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      drag.end = pointFromPointer(event);
      const selected = selectionBounds(drag.start, drag.end);
      const pointerId = drag.pointerId;
      drag = null;
      if (grid.hasPointerCapture?.(pointerId)) grid.releasePointerCapture(pointerId);
      if (!selected) return renderGrid();
      if (selected.columnSpan === 1 && selected.rowSpan === 1) {
        setMessage(output, "Drag across at least two grid cells to create a detail section.", true);
        return renderGrid();
      }
      if (state.cells.some((cell) => overlaps(cell, selected))) {
        setMessage(output, "That section overlaps an existing detail section.", true);
        return renderGrid();
      }
      draft = {
        ...selected,
        title: "Metric",
        widget: "metric",
        description: "",
        source: "",
      };
      setMessage(output, "");
      renderGrid();
      requestAnimationFrame(() => grid.querySelector("[data-draft-description]")?.focus());
    }

    function cancelSelection(event) {
      if (!drag || (event.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
      const pointerId = drag.pointerId;
      drag = null;
      if (grid.hasPointerCapture?.(pointerId)) grid.releasePointerCapture(pointerId);
      renderGrid();
    }

    function renderGrid() {
      grid.replaceChildren();
      grid.style.gridTemplateColumns = `repeat(${state.columns}, minmax(0, 1fr))`;
      grid.style.gridTemplateRows = `repeat(${state.rows}, ${state.rowHeight}px)`;
      grid.style.height = "auto";
      grid.style.minHeight = "0";
      for (let row = 1; row <= state.rows; row += 1) {
        for (let column = 1; column <= state.columns; column += 1) {
          const cell = document.createElement("i");
          cell.className = "grid-cell base-grid-cell";
          cell.dataset.row = String(row);
          cell.dataset.column = String(column);
          cell.setAttribute("aria-hidden", "true");
          cell.style.pointerEvents = "none";
          cell.style.gridColumn = String(column);
          cell.style.gridRow = String(row);
          grid.append(cell);
        }
      }
      const selection = drag && selectionBounds(drag.start, drag.end);
      if (selection) grid.append(renderSelector(selection, "selecting"));
      if (draft) grid.append(renderSelector(draft, "draft"));
      state.cells.forEach((area) => grid.append(renderSavedArea(area)));
    }

    function applyDimensions() {
      const columnsInput = document.querySelector("#grid-columns");
      const rowsInput = document.querySelector("#grid-rows");
      const columns = Math.max(2, Math.min(24, Number(columnsInput.value) || 12));
      const rows = Math.max(2, Math.min(32, Number(rowsInput.value) || 16));
      const placedAreas = draft ? [...state.cells, draft] : state.cells;
      if (placedAreas.some((cell) => cell.column + cell.columnSpan - 1 > columns || cell.row + cell.rowSpan - 1 > rows)) {
        setMessage(output, "Cancel or delete detail sections outside the new bounds before shrinking the skeleton.", true);
        columnsInput.value = String(state.columns);
        rowsInput.value = String(state.rows);
        return;
      }
      state.columns = columns;
      state.rows = rows;
      renderGrid();
    }

    nameInput.addEventListener("input", () => {
      if (!idEdited) idInput.value = slug(nameInput.value);
    });
    idInput.addEventListener("input", () => {
      idEdited = true;
      idInput.value = slug(idInput.value);
    });
    document.querySelectorAll("#grid-columns, #grid-rows").forEach((input) => {
      input.addEventListener("change", applyDimensions);
    });
    grid.addEventListener("pointerdown", (event) => {
      if (draft || !event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
      if (event.target.closest(".saved-grid-area, .grid-selector, input, select, textarea, button, a")) return;
      event.preventDefault();
      const point = pointFromPointer(event);
      drag = { pointerId: event.pointerId, start: point, end: point };
      try {
        grid.setPointerCapture(event.pointerId);
      } catch {}
      setMessage(output, "");
      grid.querySelector(".grid-selector")?.remove();
      grid.append(renderSelector(selectionBounds(drag.start, drag.end), "selecting"));
    });
    grid.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      drag.end = pointFromPointer(event);
      const selector = grid.querySelector(".grid-selector.is-selecting");
      if (selector) place(selector, selectionBounds(drag.start, drag.end));
    });
    grid.addEventListener("pointerup", finishSelection);
    grid.addEventListener("pointercancel", cancelSelection);
    grid.addEventListener("lostpointercapture", cancelSelection);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (draft) {
        setMessage(output, "Add or cancel the draft detail section before saving the oven.", true);
        return;
      }
      if (!state.cells.length) {
        setMessage(output, "Add at least one detail section.", true);
        return;
      }
      if (state.cells.some((cell) => !cell.description.trim())) {
        setMessage(output, "Every detail section needs a metric description.", true);
        return;
      }
      const save = document.querySelector("#save-oven");
      save.disabled = true;
      setMessage(output, "Saving oven...");
      try {
        const response = await fetch("/api/ovens", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-burnlist-token": writeToken,
          },
          body: JSON.stringify({
            id: idInput.value,
            name: nameInput.value,
            instructions: document.querySelector("#oven-definition").value,
            detail: {
              version: 1,
              columns: state.columns,
              rows: state.rows,
              rowHeight: state.rowHeight,
              cells: state.cells,
            },
          }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Could not save oven.");
        setMessage(output, `Saved ${payload.oven.name} at ${payload.oven.path}`);
      } catch (error) {
        setMessage(output, error.message || "Could not save oven.", true);
      } finally {
        save.disabled = false;
      }
    });
    fetch("/api/ovens")
      .then((response) => response.json())
      .then((payload) => {
        writeToken = payload.writeToken || "";
      })
      .catch(() => setMessage(output, "Could not initialize oven saving.", true));
    renderGrid();
  }

  function initializeRunForm() {
    const form = document.querySelector("#run-form");
    if (!form) return;
    const ovenSelect = document.querySelector("#run-oven");
    const repoSelect = document.querySelector("#run-repo");
    const output = document.querySelector("#run-status");
    let writeToken = "";
    Promise.all([
      fetch("/api/ovens").then((response) => response.json()),
      fetch("/api/repos").then((response) => response.json()),
    ]).then(([ovensPayload, reposPayload]) => {
      writeToken = ovensPayload.writeToken || "";
      (ovensPayload.ovens || []).forEach((oven) => {
        const option = document.createElement("option");
        option.value = oven.id;
        option.textContent = `${oven.name} · ${oven.builtIn ? "default" : "custom"}`;
        ovenSelect.append(option);
      });
      (reposPayload.repos || []).forEach((repo) => {
        const option = document.createElement("option");
        option.value = repo.root;
        option.textContent = repo.name;
        repoSelect.append(option);
      });
      if ([...ovenSelect.options].some((option) => option.value === "checklist")) {
        ovenSelect.value = "checklist";
      }
      if (!repoSelect.options.length) {
        setMessage(output, "No repositories with Burnlist state are currently discoverable.", true);
      }
    }).catch(() => setMessage(output, "Could not load ovens or repositories.", true));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const create = document.querySelector("#create-run");
      create.disabled = true;
      setMessage(output, "Creating run manifest...");
      try {
        const response = await fetch("/api/runs", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-burnlist-token": writeToken,
          },
          body: JSON.stringify({
            ovenId: ovenSelect.value,
            repoRoot: repoSelect.value,
            title: document.querySelector("#run-title").value,
            objective: document.querySelector("#run-objective").value,
          }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Could not create run.");
        setMessage(output, `Created ${payload.run.id} at ${payload.run.path}. Codex execution has not started.`);
      } catch (error) {
        setMessage(output, error.message || "Could not create run.", true);
      } finally {
        create.disabled = false;
      }
    });
  }

  initializeOvenBuilder();
  initializeRunForm();
})();
