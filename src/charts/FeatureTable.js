const SKIP_KEYS = new Set(["geometry", "bbox", "type"]);

export function render({ featureProps, rawValue }) {
  const div = document.createElement("div");
  div.className = "chart-table";

  const props = featureProps ?? (rawValue !== null ? { Wert: rawValue } : null);

  if (!props || Object.keys(props).length === 0) {
    div.innerHTML = `<p class="chart-empty">Keine Attribute an dieser Stelle.</p>`;
    return div;
  }

  const rows = Object.entries(props)
    .filter(([k]) => !SKIP_KEYS.has(k))
    .map(([k, v]) => {
      const val = v === null || v === undefined ? "–" : String(v);
      return `<tr><th>${escHtml(k)}</th><td>${escHtml(val)}</td></tr>`;
    })
    .join("");

  div.innerHTML = `<table class="attr-table"><tbody>${rows}</tbody></table>`;
  return div;
}

function escHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
