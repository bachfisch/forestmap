function speciesColor(label) {
  if (/buche/i.test(label))  return "#1D9E75";
  if (/fichte/i.test(label)) return "#378ADD";
  if (/eiche/i.test(label))  return "#EF9F27";
  if (/kiefer/i.test(label)) return "#D85A30";
  return "#888780";
}

const SPECIES_ORDER = ["Buche", "Eiche", "Kiefer", "Fichte"];

function speciesRank(label) {
  const idx = SPECIES_ORDER.findIndex(s => new RegExp(s, "i").test(label));
  return idx === -1 ? 99 : idx;
}

function shortLabel(label) {
  const m = label.match(/^(Buche|Fichte|Eiche|Kiefer)/i);
  return m ? m[1] : label;
}

export function render({ results }) {
  const wrapper = document.createElement("div");
  wrapper.className = "chart-bodenfeuchte";

  const points = results
    .filter(r => r.value !== null)
    .map(r => ({
      label: shortLabel(r.layer.label),
      fullLabel: r.layer.label,
      value: r.value,
      depth: r.properties?.ELEVATION ?? 10,
      time: r.properties?.TIME ?? null,
      color: speciesColor(r.layer.label),
      order: speciesRank(r.layer.label),
    }))
    .sort((a, b) => a.order - b.order);

  if (!points.length) {
    wrapper.innerHTML = `<p class="chart-empty">Kein Wert an dieser Stelle.</p>`;
    return wrapper;
  }

  const Plot = window.Plot;
  if (!Plot) {
    wrapper.append(fallback(points));
    return wrapper;
  }

  // Add a date note from TIME field if available
  if (points[0].time) {
    const note = document.createElement("div");
    note.style.cssText = "font-size:10px;color:var(--text-muted);margin-bottom:4px";
    const d = new Date(points[0].time);
    const fmt = isNaN(d) ? points[0].time : d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
    note.textContent = `Datum: ${fmt} · Tiefe: ${points[0].depth} cm`;
    wrapper.append(note);
  }

  const domain = points.map(p => p.label);

  const chart = Plot.plot({
    width: 272,
    height: 20 + domain.length * 28 + 32,
    marginBottom: 32,
    marginLeft: 52,
    marginTop: 8,
    marginRight: 40,
    x: { label: "% nFK", domain: [0, 100], grid: true, tickCount: 5 },
    y: { label: null, domain },
    marks: [
      Plot.barX(points, {
        x: "value",
        y: "label",
        fill: d => d.color,
        title: d => `${d.fullLabel}: ${d.value.toFixed(1)} % nFK`,
      }),
      Plot.text(points, {
        x: "value",
        y: "label",
        text: d => `${d.value.toFixed(0)}%`,
        dx: 4,
        textAnchor: "start",
        fontSize: 10,
        fill: "var(--text)",
      }),
      Plot.ruleX([30], { stroke: "#EF9F27", strokeDasharray: "4,3", strokeWidth: 1.5 }),
      Plot.ruleX([60], { stroke: "#1D9E75", strokeDasharray: "4,3", strokeWidth: 1.5 }),
      Plot.ruleX([0], { stroke: "var(--border)" }),
    ],
    style: {
      fontFamily: "system-ui, -apple-system, sans-serif",
      fontSize: "10px",
      background: "transparent",
    },
  });

  wrapper.append(chart);

  // Legend for threshold lines
  const legend = document.createElement("div");
  legend.style.cssText = "display:flex;gap:10px;font-size:9px;color:var(--text-muted);margin-top:2px;padding-left:52px";
  legend.innerHTML =
    `<span><span style="display:inline-block;width:16px;height:2px;background:#EF9F27;vertical-align:middle;margin-right:3px"></span>Stress (30%)</span>` +
    `<span><span style="display:inline-block;width:16px;height:2px;background:#1D9E75;vertical-align:middle;margin-right:3px"></span>Optimal (60%)</span>`;
  wrapper.append(legend);

  return wrapper;
}

function fallback(points) {
  const rows = points.map(p => `
    <div class="fb-row">
      <span class="fb-label">${p.label}</span>
      <div class="fb-bar-wrap">
        <div class="fb-bar" style="width:${p.value.toFixed(1)}%;background:${p.color}"></div>
        <span class="fb-val">${p.value.toFixed(1)} %</span>
      </div>
    </div>`).join("");
  const div = document.createElement("div");
  div.className = "fallback-bars";
  div.innerHTML = rows;
  return div;
}
