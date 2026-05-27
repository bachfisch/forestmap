import { parseLayerName } from "../chartTheme.js";

export function render({ results, serviceConfig }) {
  const wrapper = document.createElement("div");
  wrapper.className = "chart-scenario";

  const valueMap = new Map(results.map(r => [r.layer.name, r.value]));

  const points = serviceConfig.layers.map(layer => {
    const { speciesKey, speciesLabel, meta, color } = parseLayerName(layer.name);
    return {
      speciesKey,
      speciesLabel,
      barLabel: meta?.label ?? layer.label,
      timePeriod: meta?.timePeriod ?? layer.label,
      group: meta?.group ?? "Andere",
      groupOrder: meta?.groupOrder ?? 99,
      order: meta?.order ?? 99,
      color,
      value: valueMap.get(layer.name) ?? null,
      layer,
    };
  });

  const anyValue = points.some(p => p.value !== null);
  if (!anyValue) {
    wrapper.innerHTML = `<p class="chart-empty">Kein Wert an dieser Stelle.</p>`;
    return wrapper;
  }

  // scenarioRelative: RCP layers carry fractional change relative to Heute base
  // Convert: absolute = base * (1 + relChange)
  if (serviceConfig.scenarioRelative) {
    const bySpecies = new Map();
    for (const p of points) {
      const key = p.speciesKey ?? "__all__";
      if (!bySpecies.has(key)) bySpecies.set(key, []);
      bySpecies.get(key).push(p);
    }
    for (const pts of bySpecies.values()) {
      const base = pts.find(p => p.groupOrder === 0)?.value ?? null;
      if (base === null) continue;
      for (const p of pts) {
        if (p.value !== null && p.groupOrder !== 0)
          p.value = base * (1 + p.value);
      }
    }
  }

  // Shared y-domain across all species charts for comparability
  const allVals = points.map(p => p.value).filter(v => v !== null);
  const yDomain = allVals.length
    ? [Math.min(0, ...allVals), Math.max(...allVals)]
    : undefined;

  const bySpecies = new Map();
  for (const p of points) {
    const key = p.speciesKey ?? "__all__";
    if (!bySpecies.has(key)) bySpecies.set(key, { label: p.speciesLabel, points: [] });
    bySpecies.get(key).points.push(p);
  }

  for (const [, { label, points: pts }] of bySpecies) {
    const sorted = [...pts].sort((a, b) =>
      a.groupOrder !== b.groupOrder ? a.groupOrder - b.groupOrder : a.order - b.order
    );

    const deduped = [];
    const seen = new Set();
    for (const p of sorted) {
      if (!seen.has(p.barLabel)) { seen.add(p.barLabel); deduped.push(p); }
    }

    if (label) {
      const title = document.createElement("div");
      title.className = "species-title";
      title.textContent = label;
      wrapper.append(title);
    }

    wrapper.append(renderGroupAxis(deduped));
    wrapper.append(renderBars(deduped, yDomain));
  }

  return wrapper;
}

function renderGroupAxis(points) {
  const groups = [];
  let last = null;
  for (const p of points) {
    if (p.group !== last) { groups.push({ label: p.group, count: 0 }); last = p.group; }
    groups[groups.length - 1].count++;
  }

  const axis = document.createElement("div");
  axis.className = "group-axis";
  axis.style.paddingLeft = "44px";
  axis.style.paddingRight = "12px";

  const inner = document.createElement("div");
  inner.className = "group-axis-inner";
  inner.style.display = "flex";
  inner.style.borderBottom = "1px solid var(--border)";

  for (const g of groups) {
    const el = document.createElement("div");
    el.className = "group-label";
    el.style.flex = String(g.count);
    el.style.fontSize = "9px";
    el.style.color = "var(--text-muted)";
    el.style.textAlign = "center";
    el.style.overflow = "hidden";
    el.style.textOverflow = "ellipsis";
    el.style.whiteSpace = "nowrap";
    el.style.paddingBottom = "2px";
    el.textContent = g.label;
    inner.append(el);
  }
  axis.append(inner);
  return axis;
}

function renderBars(points, yDomain) {
  const Plot = window.Plot;
  if (!Plot) return fallbackBars(points);

  const timePeriodMap = new Map(points.map(p => [p.barLabel, p.timePeriod]));

  const chart = Plot.plot({
    width: 272,
    height: 140,
    marginBottom: 40,
    marginLeft: 44,
    marginTop: 8,
    marginRight: 12,
    x: {
      domain: points.map(p => p.barLabel),
      tickFormat: d => timePeriodMap.get(d) ?? d,
      tickRotate: -35,
      label: null,
      tickSize: 0,
    },
    y: { label: null, grid: true, tickCount: 4, domain: yDomain },
    marks: [
      Plot.barY(points.filter(p => p.value !== null), {
        x: "barLabel",
        y: "value",
        fill: d => d.color,
        title: d => `${d.timePeriod}: ${d.value?.toFixed(2)}`,
      }),
      Plot.ruleY([0], { stroke: "var(--border)" }),
    ],
    style: {
      fontFamily: "system-ui, -apple-system, sans-serif",
      fontSize: "10px",
      background: "transparent",
      color: "var(--text)",
    },
  });

  const container = document.createElement("div");
  container.append(chart);
  return container;
}

function fallbackBars(points) {
  const max = Math.max(...points.map(p => Math.abs(p.value ?? 0))) || 1;
  const rows = points.filter(p => p.value !== null).map(p => `
    <div class="fb-row">
      <span class="fb-label">${p.timePeriod}</span>
      <div class="fb-bar-wrap">
        <div class="fb-bar" style="width:${(Math.abs(p.value) / max * 100).toFixed(1)}%;background:${p.color}"></div>
        <span class="fb-val">${p.value?.toFixed(1)}</span>
      </div>
    </div>`).join("");

  const div = document.createElement("div");
  div.className = "fallback-bars";
  div.innerHTML = rows;
  return div;
}
