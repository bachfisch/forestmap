import { chartTheme } from "../chartTheme.js";

const SPECIES_COLORS = {
  Buche:  "#1D9E75",
  Fichte: "#378ADD",
  Eiche:  "#EF9F27",
  Kiefer: "#D85A30",
};

export function render({ results }) {
  const wrapper = document.createElement("div");
  wrapper.className = "chart-bodenfeuchte";

  const points = results
    .filter(r => r.value !== null)
    .map(r => ({
      label: r.layer.label,
      value: r.value,
      color: SPECIES_COLORS[r.layer.label] ?? chartTheme.color.primary,
    }));

  if (!points.length) {
    wrapper.innerHTML = `<p class="chart-empty">Kein Wert an dieser Stelle.</p>`;
    return wrapper;
  }

  const Plot = window.Plot;
  if (!Plot) {
    wrapper.append(fallback(points));
    return wrapper;
  }

  const chart = Plot.plot({
    width: 272,
    height: 140,
    marginBottom: 30,
    marginLeft: 44,
    marginTop: 8,
    marginRight: 12,
    x: { label: null, tickSize: 0 },
    y: { label: "% nFK", grid: true, tickCount: 4, domain: [0, 100] },
    marks: [
      Plot.barY(points, {
        x: "label",
        y: "value",
        fill: d => d.color,
        title: d => `${d.label}: ${d.value?.toFixed(1)} % nFK`,
      }),
      Plot.ruleY([0], { stroke: "var(--border)" }),
    ],
    style: {
      fontFamily: "system-ui, -apple-system, sans-serif",
      fontSize: "10px",
      background: "transparent",
    },
  });

  wrapper.append(chart);
  return wrapper;
}

function fallback(points) {
  const max = 100;
  const rows = points.map(p => `
    <div class="fb-row">
      <span class="fb-label">${p.label}</span>
      <div class="fb-bar-wrap">
        <div class="fb-bar" style="width:${(p.value / max * 100).toFixed(1)}%;background:${p.color}"></div>
        <span class="fb-val">${p.value?.toFixed(1)} %</span>
      </div>
    </div>`).join("");
  const div = document.createElement("div");
  div.className = "fallback-bars";
  div.innerHTML = rows;
  return div;
}
