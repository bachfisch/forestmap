const SKIP_KEYS = new Set(["geometry", "bbox", "type"]);

export function render({ featureProps, rawValue, results }) {
  const div = document.createElement("div");
  div.className = "chart-table";

  const withData = (results ?? []).filter(r => r.properties && Object.keys(r.properties).length > 0);

  if (withData.length > 1) {
    for (const r of withData) {
      const heading = document.createElement("div");
      heading.className = "feature-table-layer";
      heading.textContent = r.layer.label;
      div.append(heading, buildTable(r.properties));
    }
    return div;
  }

  const props = featureProps ?? (rawValue !== null ? { Wert: rawValue } : null);
  if (!props || Object.keys(props).length === 0) {
    div.innerHTML = `<p class="chart-empty">Keine Attribute an dieser Stelle.</p>`;
    return div;
  }

  div.append(buildTable(props));
  return div;
}

function buildTable(props) {
  const rows = Object.entries(props)
    .filter(([k]) => !SKIP_KEYS.has(k))
    .map(([k, v]) => {
      const val = v === null || v === undefined ? "–" : String(v);
      return `<tr><th>${escHtml(k)}</th><td>${escHtml(val)}</td></tr>`;
    })
    .join("");
  const table = document.createElement("table");
  table.className = "attr-table";
  table.innerHTML = `<tbody>${rows}</tbody>`;
  return table;
}

function escHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
