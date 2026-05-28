// ── Scenario metadata ────────────────────────────────────────────────────────

const SCENARIO_COLORS = {
  current:           "#888780",
  heute:             "#888780",
  "1981_2010":       "#888780",
  rcp45_2021_2050:   "#9DC5E8",
  rcp45_2041_2060:   "#6AAAD4",
  rcp45_2061_2080:   "#378ADD",
  "rcp45_2061-2080": "#378ADD",
  rcp45_2071_2100:   "#1D5FA0",
  rcp85_2021_2050:   "#F5C98A",
  rcp85_2041_2060:   "#EF9F27",
  rcp85_2061_2080:   "#E07020",
  "rcp85_2061-2080": "#E07020",
  rcp85_2071_2100:   "#D85A30",
};

const SCENARIO_META = {
  current:           { timePeriod: "Heute",     group: "Heute",    groupOrder: 0, order: 0 },
  heute:             { timePeriod: "Heute",     group: "Heute",    groupOrder: 0, order: 0 },
  "1981_2010":       { timePeriod: "1981–2010", group: "Referenz", groupOrder: 0, order: 0 },
  rcp45_2021_2050:   { timePeriod: "2021–50",   group: "RCP 4.5",  groupOrder: 1, order: 1 },
  rcp45_2041_2060:   { timePeriod: "2041–60",   group: "RCP 4.5",  groupOrder: 1, order: 2 },
  rcp45_2061_2080:   { timePeriod: "2061–80",   group: "RCP 4.5",  groupOrder: 1, order: 3 },
  "rcp45_2061-2080": { timePeriod: "2061–80",   group: "RCP 4.5",  groupOrder: 1, order: 3 },
  rcp45_2071_2100:   { timePeriod: "2071–100",  group: "RCP 4.5",  groupOrder: 1, order: 4 },
  rcp85_2021_2050:   { timePeriod: "2021–50",   group: "RCP 8.5",  groupOrder: 2, order: 1 },
  rcp85_2041_2060:   { timePeriod: "2041–60",   group: "RCP 8.5",  groupOrder: 2, order: 2 },
  rcp85_2061_2080:   { timePeriod: "2061–80",   group: "RCP 8.5",  groupOrder: 2, order: 3 },
  "rcp85_2061-2080": { timePeriod: "2061–80",   group: "RCP 8.5",  groupOrder: 2, order: 3 },
  rcp85_2071_2100:   { timePeriod: "2071–100",  group: "RCP 8.5",  groupOrder: 2, order: 4 },
};

const SPECIES_LABELS = {
  buche_eiche:      "Buche / Eiche",
  tanne_douglasie:  "Tanne / Douglasie",
  kiefer_laerche:   "Kiefer / Lärche",
  andere_baumarten: "Andere",
  bergahorn:        "Bergahorn",
  douglasie:        "Douglasie",
  waldkiefer:       "Waldkiefer",
  gesamt:           "Gesamt",
  buche:            "Buche",
  eiche:            "Eiche",
  fichte:           "Fichte",
  tanne:            "Tanne",
};

// Sorted longest-first so "buche_eiche" matches before "buche"
const SPECIES_KEYS = Object.keys(SPECIES_LABELS).sort((a, b) => b.length - a.length);

function parseLayerName(layerName) {
  const name = layerName.toLowerCase();

  const speciesKey = SPECIES_KEYS.find(s =>
    name.includes(`_${s}_`) || name.endsWith(`_${s}`)
  ) ?? null;

  const scenarioKey = Object.keys(SCENARIO_META).find(sk =>
    name.endsWith(`_${sk.toLowerCase()}`) || name.includes(`_${sk.toLowerCase()}_`)
  ) ?? null;

  return {
    speciesKey,
    speciesLabel: speciesKey ? (SPECIES_LABELS[speciesKey] ?? null) : null,
    meta: scenarioKey ? SCENARIO_META[scenarioKey] : null,
    color: scenarioKey ? (SCENARIO_COLORS[scenarioKey] ?? "#888780") : "#888780",
  };
}

// ── Render ───────────────────────────────────────────────────────────────────

export function render({ results, serviceConfig }) {
  const wrapper = document.createElement("div");
  wrapper.className = "chart-scenario";

  const valueMap = new Map(results.map(r => [r.layer.name, r.value]));

  const points = serviceConfig.layers.map(layer => {
    const { speciesKey, speciesLabel, meta, color } = parseLayerName(layer.name);
    return {
      speciesKey,
      speciesLabel,
      barLabel: meta ? `${speciesKey ?? ""}|${meta.group}|${meta.order}` : layer.name,
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
  // Convert to absolute: absolute = base * (1 + relChange)
  if (serviceConfig.scenarioRelative) {
    const bySpecies = groupBySpecies(points);
    for (const { points: pts } of bySpecies.values()) {
      const base = pts.find(p => p.groupOrder === 0)?.value ?? null;
      if (base === null) continue;
      for (const p of pts) {
        if (p.value !== null && p.groupOrder !== 0)
          p.value = base * (1 + p.value);
      }
    }
  }

  // Shared y-domain across all species charts for comparability
  const allVals = points.map(p => p.value).filter(Number.isFinite);
  const yMin = allVals.length ? Math.min(0, ...allVals) : 0;
  const yMax = allVals.length ? Math.max(...allVals) : 1;
  const yDomain = allVals.length && yMax > yMin ? [yMin, yMax] : undefined;

  for (const [, { label, points: pts }] of groupBySpecies(points)) {
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

function groupBySpecies(points) {
  const map = new Map();
  for (const p of points) {
    const key = p.speciesKey ?? "__all__";
    if (!map.has(key)) map.set(key, { label: p.speciesLabel, points: [] });
    map.get(key).points.push(p);
  }
  return map;
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
  axis.style.cssText = "padding-left:44px;padding-right:12px";

  const inner = document.createElement("div");
  inner.style.cssText = "display:flex;border-bottom:1px solid var(--border)";

  for (const g of groups) {
    const el = document.createElement("div");
    el.style.cssText = `flex:${g.count};font-size:9px;color:var(--text-muted);text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-bottom:2px`;
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

  let chart;
  try {
    chart = Plot.plot({
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
        Plot.barY(points.filter(p => Number.isFinite(p.value)), {
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
  } catch (err) {
    console.error("ScenarioBar Plot.plot error:", err);
    return fallbackBars(points);
  }

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
