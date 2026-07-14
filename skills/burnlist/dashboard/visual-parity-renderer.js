function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function screenshot(image, role) {
  return `<figure aria-label="${escapeHtml(`${image.label} ${role} screenshot`)}" class="visual-parity-shot" data-side="${escapeHtml(role.toLowerCase())}">
    <div class="visual-parity-image-frame"><img alt="${escapeHtml(`${image.label} ${role} screenshot`)}" decoding="async" height="${Number(image.height) || 1}" loading="lazy" src="${escapeHtml(image.src)}" width="${Number(image.width) || 1}"></div>
  </figure>`;
}

function frameCard(comparison) {
  const difference = comparison.difference;
  const changed = Number(difference.changedPixels).toLocaleString("en-US");
  const percent = (Number(difference.ratio) * 100).toFixed(2).replace(/\.00$/u, "");
  const mean = Number(difference.meanAbsoluteDelta).toFixed(2).replace(/\.00$/u, "");
  const maximum = Number(difference.maximumAbsoluteDelta).toFixed(2).replace(/\.00$/u, "");
  const status = comparison.status === "pass" ? "pass" : "fail";
  return `<section class="hybrid-row ${status} expanded visual-parity-frame-card" data-frame="${comparison.frame}" title="${escapeHtml(comparison.label)}">
    <span class="hybrid-cell hybrid-field"><span class="table-field-label">Frame ${comparison.frame}</span><span class="hybrid-status">${status === "pass" ? "Pass" : "Fail"}</span></span>
    <span class="hybrid-cell hybrid-metric"><span class="hybrid-count">${changed}</span><span class="hybrid-delta ${status === "pass" ? "" : "down"}"><span class="hybrid-delta-value">${percent}%</span></span><span class="hybrid-value-delta">${mean} mean</span><span class="hybrid-value-delta">${maximum} max</span></span>
    <div class="hybrid-chart"><div class="visual-parity-pair">
      ${screenshot(comparison.reference, "Reference")}
      ${screenshot(comparison.candidate, "Candidate")}
      ${screenshot(comparison.diff, "Diff")}
    </div></div>
  </section>`;
}

export function renderVisualParityComparison({ payload }) {
  const comparisons = payload?.visualParity?.comparisons;
  if (!Array.isArray(comparisons)) return '<div class="empty">Visual Parity frame comparisons are unavailable.</div>';
  const captured = comparisons.filter((comparison) => (
    comparison?.reference?.src
    && comparison.candidate?.src
    && comparison.diff?.src
  ));
  if (!captured.length) return '<div class="empty hybrid-empty">No sampled frames to display.</div>';
  return `<div class="hybrid-list visual-parity-frame-list">${captured.map(frameCard).join("")}</div>`;
}
