import { render as RasterValue }      from "./charts/RasterValue.js";
import { render as FeatureTable }     from "./charts/FeatureTable.js";
import { render as ScenarioBar }      from "./charts/ScenarioBar.js";
import { render as BuchdruckerChart } from "./charts/BuchdruckerChart.js";
import { render as BodenfeuchteChart} from "./charts/BodenfeuchteChart.js";
import { getFilter } from "./state.js";
import { SERVICES, CATEGORIES } from "../services.js";

// All reportable services (exclude the parcel layer itself)
const REPORT_SVCS = SERVICES.filter(s => s.category !== "flurstücke" && (s.featureInfoType !== "none" || s.wfsUrl));

const reportSelected = new Set(["laub-nadelwaldkarte", "waldhoehen"]);
import { setHighlight, setHighlightFeatures, clearHighlight } from "./highlight.js";

// Map query function — registered by map.js after load
let _mapQueryFn = null;
export function setMapQuery(fn) { _mapQueryFn = fn; }

const ChartRegistry = {
  RasterValue,
  FeatureTable,
  ScenarioBar,
  BuchdruckerChart,
  BodenfeuchteChart,
};

let panelEl, contentEl, closeBtn;

export function initPopup() {
  panelEl  = document.getElementById("popup-panel");
  contentEl = document.getElementById("popup-content");
  closeBtn  = document.getElementById("popup-close");

  closeBtn.addEventListener("click", () => {
    panelEl.classList.remove("open");
    clearHighlight();
  });
}

export function showLoading(latlng) {
  contentEl.innerHTML = `
    <div class="popup-coords">${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}</div>
    <div class="popup-loading">Wird abgefragt…</div>
  `;
  panelEl.classList.add("open");
}

export function showResults(entries) {
  clearHighlight();

  if (!entries.length) {
    contentEl.innerHTML = `
      <p class="popup-empty">Kein aktiver Layer an dieser Stelle.</p>
      <p class="popup-hint">Layer in der Seitenleiste aktivieren.</p>
    `;
    return;
  }

  const existing = contentEl.querySelector(".popup-coords");
  const coordsHtml = existing ? existing.outerHTML : "";

  const frags = entries.map(entry => renderEntry(entry)).filter(Boolean);
  contentEl.innerHTML = coordsHtml;
  for (const f of frags) contentEl.append(f);

  if (!frags.length) {
    contentEl.insertAdjacentHTML("beforeend",
      `<p class="popup-empty">Kein Treffer für aktive Filter.</p>`);
  }
}

function renderEntry(entry) {
  if (entry.kind === "fernerkundung") return renderFernEntry(entry);

  const service = entry.service;
  let results = entry.results ?? [];

  // Apply sidebar filter if set for any layer in this service
  const filteredResults = results.filter(r => {
    const f = r.layer?.sidebarFilter;
    if (!f) return true;
    const active = getFilter(service.id, r.layer.name);
    if (!active) return true;
    const val = r.properties?.[f.field] ?? r.value;
    return String(val ?? "").toLowerCase().includes(active.toLowerCase());
  });

  if (filteredResults.length === 0 && results.some(r => r.layer?.sidebarFilter)) {
    return null;
  }

  const displayResults = filteredResults.length > 0 ? filteredResults : results;
  const firstResult = displayResults[0] ?? {};

  if (firstResult.geometry) setHighlight(firstResult.geometry);

  const context = {
    rawValue:     firstResult.value ?? null,
    featureProps: firstResult.properties ?? null,
    results: displayResults,
    serviceConfig: service,
  };

  const ChartFn = ChartRegistry[service.chartComponent] ?? defaultChart(service);

  const section = document.createElement("div");
  section.className = "popup-entry";

  const header = document.createElement("div");
  header.className = "popup-entry-header";
  header.textContent = service.label;

  const body = document.createElement("div");
  body.className = "popup-entry-body";
  let chartEl;
  try {
    chartEl = ChartFn(context);
  } catch (err) {
    console.error(`Chart render error [${service.id}]:`, err);
    const errDiv = document.createElement("p");
    errDiv.className = "chart-empty";
    errDiv.textContent = "Darstellung nicht verfügbar.";
    chartEl = errDiv;
  }
  // For basemap services: add expand buttons to property table
  if (service.fetchPoint === "basemap" && firstResult.properties && firstResult.basemapLayerIds) {
    const expandTable = buildExpandTable(firstResult.properties, firstResult.basemapLayerIds, body, service);
    if (expandTable) body.append(expandTable);
  } else {
    body.append(chartEl);
  }

  // Buffer container — can be updated by expand action
  const bufferContainer = document.createElement("div");
  bufferContainer.dataset.bufferContainer = "1";
  body.append(bufferContainer);

  const geom = firstResult.geometry;
  if (geom && (geom.type === "Polygon" || geom.type === "MultiPolygon")) {
    const statusEl = document.createElement("p");
    statusEl.className = "report-status";
    const btn = document.createElement("button");
    btn.className = "report-btn";
    btn.textContent = "Report erstellen";
    btn.addEventListener("click", () => triggerReport(firstResult, service, btn, statusEl));
    bufferContainer.append(btn, buildReportDropdown(), statusEl);
  } else if (geom && (geom.type === "LineString" || geom.type === "MultiLineString" || geom.type === "Point")) {
    renderBufferInto(bufferContainer, [geom], service);
  }

  section.append(header, body);
  return section;
}

function matchColorToLegend(hex, legend) {
  if (!legend?.entries?.length) return null;
  const rgb = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
  const dist = ([r1,g1,b1],[r2,g2,b2]) => Math.sqrt((r1-r2)**2+(g1-g2)**2+(b1-b2)**2);
  const pixRgb = rgb(hex);
  let best = null, bestDist = Infinity;
  for (const e of legend.entries) {
    const d = dist(pixRgb, rgb(e.hex));
    if (d < bestDist) { bestDist = d; best = e; }
  }
  return bestDist < 100 ? best : null;
}

function renderFernEntry({ rows }) {
  const withValues = rows.filter(r => r.value !== null);
  if (!withValues.length) return document.createDocumentFragment();

  const section = document.createElement("div");
  section.className = "popup-entry";

  const header = document.createElement("div");
  header.className = "popup-entry-header";
  header.textContent = "Fernerkundung";

  const table = document.createElement("table");
  table.className = "attr-table";
  const tbody = document.createElement("tbody");

  for (const r of withValues) {
    const tr = document.createElement("tr");
    const isHex = typeof r.value === "string" && r.value.startsWith("#");
    let valCell;
    if (isHex) {
      const swatch = `<span style="display:inline-block;width:12px;height:12px;background:${r.value};border-radius:3px;vertical-align:middle;border:1px solid var(--border);margin-right:5px"></span>`;
      const matched = matchColorToLegend(r.value, r.service.colorLegend);
      valCell = matched ? `${swatch}${matched.label}` : swatch;
    } else {
      valCell = r.value?.toFixed?.(2) ?? r.value;
    }
    tr.innerHTML = `<th>${r.service.label}</th><td>${valCell}</td>`;
    tbody.append(tr);
  }
  table.append(tbody);

  const body = document.createElement("div");
  body.className = "popup-entry-body";
  body.append(table);

  section.append(header, body);
  return section;
}

function defaultChart(service) {
  if (service.dataSource?.type === "wms-multi") return ScenarioBar;
  if (service.featureInfoType === "geojson")    return FeatureTable;
  return RasterValue;
}

function buildReportDropdown() {
  const details = document.createElement("details");
  details.className = "report-options";

  const summary = document.createElement("summary");
  summary.className = "report-options-summary";
  summary.textContent = "Layer-Auswahl";
  details.append(summary);

  const body = document.createElement("div");
  body.className = "report-options-body";

  for (const cat of CATEGORIES) {
    if (cat.id === "flurstücke") continue;
    const svcs = REPORT_SVCS.filter(s => s.category === cat.id);
    if (!svcs.length) continue;
    if (svcs.length === 1) {
      body.append(buildReportItem(cat.label, svcs[0].id));
    } else {
      body.append(buildReportGroup(cat.label, svcs));
    }
  }

  details.append(body);
  return details;
}

function buildReportGroup(label, svcs) {
  const wrap = document.createElement("div");
  wrap.className = "report-options-group";

  const parentLabel = document.createElement("label");
  parentLabel.className = "report-options-parent";
  const parentCb = document.createElement("input");
  parentCb.type = "checkbox";
  const allChecked = svcs.every(s => reportSelected.has(s.id));
  const someChecked = svcs.some(s => reportSelected.has(s.id));
  parentCb.checked = allChecked;
  parentCb.indeterminate = !allChecked && someChecked;
  parentLabel.append(parentCb, document.createTextNode(" " + label));
  wrap.append(parentLabel);

  const children = document.createElement("div");
  children.className = "report-options-children";
  for (const svc of svcs) {
    children.append(buildReportItem(svc.label, svc.id, true, parentCb, children));
  }
  wrap.append(children);

  parentCb.addEventListener("change", () => {
    for (const cb of children.querySelectorAll("input[type=checkbox]")) {
      cb.checked = parentCb.checked;
      if (parentCb.checked) reportSelected.add(cb.dataset.id);
      else reportSelected.delete(cb.dataset.id);
    }
    parentCb.indeterminate = false;
  });

  return wrap;
}

function buildReportItem(label, id, isChild = false, parentCb = null, siblings = null) {
  const l = document.createElement("label");
  l.className = isChild ? "report-options-child" : "report-options-item";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.dataset.id = id;
  cb.checked = reportSelected.has(id);
  cb.addEventListener("change", () => {
    if (cb.checked) reportSelected.add(id);
    else reportSelected.delete(id);
    if (parentCb && siblings) {
      const all = [...siblings.querySelectorAll("input[type=checkbox]")];
      const c = all.filter(x => x.checked).length;
      parentCb.checked = c === all.length;
      parentCb.indeterminate = c > 0 && c < all.length;
    }
  });
  l.append(cb, document.createTextNode(" " + label));
  return l;
}

// ── Basemap expand table ──────────────────────────────────────────────────────

function buildExpandTable(props, layerIds, body, service) {
  const SKIP = new Set(["@ns:com:here:xyz", "bbox", "type"]);
  const entries = Object.entries(props).filter(([k, v]) =>
    !SKIP.has(k) && v !== null && v !== undefined && v !== ""
  );
  if (!entries.length) return null;

  const table = document.createElement("table");
  table.className = "attr-table";
  const tbody = document.createElement("tbody");

  for (const [key, value] of entries) {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.textContent = key;
    const td = document.createElement("td");

    const valSpan = document.createElement("span");
    valSpan.textContent = String(value);
    td.append(valSpan);

    // Expand button for string/number values
    if ((typeof value === "string" || typeof value === "number") && _mapQueryFn) {
      const btn = document.createElement("button");
      btn.className = "expand-btn";
      btn.title = `Alle sichtbaren Features mit ${key} = "${value}" auswählen`;
      btn.textContent = "⊕";
      btn.addEventListener("click", () => {
        const all = _mapQueryFn(layerIds);
        const matching = all.filter(f => f.properties?.[key] === value);
        if (!matching.length) return;
        const geometries = matching.map(f => f.geometry).filter(Boolean);
        setHighlightFeatures(geometries);
        // Update buffer container
        const container = body.querySelector("[data-buffer-container]");
        if (container) renderBufferInto(container, geometries, service);
        btn.classList.add("active");
        btn.title = `${matching.length} Feature(s) ausgewählt`;
      });
      td.append(btn);
    }

    tr.append(th, td);
    tbody.append(tr);
  }

  table.append(tbody);
  return table;
}

function renderBufferInto(container, geometries, service) {
  container.innerHTML = "";
  container.dataset.bufferContainer = "1";
  if (!geometries.length) return;
  const hasLines = geometries.some(g =>
    g.type === "LineString" || g.type === "MultiLineString"
  );
  const hasPolygons = geometries.some(g =>
    g.type === "Polygon" || g.type === "MultiPolygon"
  );
  if (hasLines || (!hasPolygons && geometries.length)) {
    container.append(buildBufferSection(geometries, service));
  } else if (hasPolygons) {
    const statusEl = document.createElement("p");
    statusEl.className = "report-status";
    const btn = document.createElement("button");
    btn.className = "report-btn";
    btn.textContent = "Report erstellen";
    const mergedGeom = geometries.length === 1 ? geometries[0]
      : { type: "MultiPolygon", coordinates: geometries.map(g =>
          g.type === "Polygon" ? g.coordinates : g.coordinates).flat()
        };
    btn.addEventListener("click", () => triggerReport(
      { geometry: mergedGeom, properties: {} }, service, btn, statusEl
    ));
    container.append(btn, buildReportDropdown(), statusEl);
  }
}

// ── Buffer section ────────────────────────────────────────────────────────────

function buildBufferSection(geometries, service) {
  const wrap = document.createElement("div");
  wrap.className = "buffer-section";

  const row = document.createElement("div");
  row.className = "buffer-row";

  const label = document.createElement("span");
  label.className = "buffer-unit";
  label.textContent = "Radius:";

  const input = document.createElement("input");
  input.type = "number";
  input.className = "buffer-input";
  input.min = "1";
  input.max = "10000";
  input.value = "100";

  const unit = document.createElement("span");
  unit.className = "buffer-unit";
  unit.textContent = "m";

  const applyBtn = document.createElement("button");
  applyBtn.className = "buffer-apply-btn";
  applyBtn.textContent = "Puffer anwenden";

  row.append(label, input, unit, applyBtn);
  wrap.append(row);

  // Report section — revealed after buffer is applied
  const reportWrap = document.createElement("div");
  reportWrap.hidden = true;

  const statusEl = document.createElement("p");
  statusEl.className = "report-status";

  const reportBtn = document.createElement("button");
  reportBtn.className = "report-btn";
  reportBtn.textContent = "Report erstellen";

  reportWrap.append(reportBtn, buildReportDropdown(), statusEl);
  wrap.append(reportWrap);

  let bufferGeometry = null;

  applyBtn.addEventListener("click", () => {
    const distance = parseFloat(input.value);
    if (!distance || distance <= 0) return;
    const turf = window.turf;
    if (!turf) { console.error("Turf.js nicht geladen"); return; }
    try {
      const features = geometries.map(g => ({ type: "Feature", geometry: g, properties: {} }));
      const collection = turf.featureCollection(features);
      const buffered = turf.buffer(collection, distance, { units: "meters" });
      // Union all individual buffers into one polygon
      let merged = buffered.features[0];
      for (let i = 1; i < buffered.features.length; i++) {
        merged = turf.union(merged, buffered.features[i]);
      }
      bufferGeometry = merged.geometry;
      setHighlight(bufferGeometry);
      reportWrap.hidden = false;
      applyBtn.textContent = `Puffer aktualisieren (${geometries.length} Features)`;
    } catch (err) {
      console.error("Buffer-Berechnung fehlgeschlagen:", err);
    }
  });

  reportBtn.addEventListener("click", () => {
    if (!bufferGeometry) return;
    triggerReport(
      { geometry: bufferGeometry, properties: {} },
      service, reportBtn, statusEl
    );
  });

  return wrap;
}

async function triggerReport(parcelResult, service, btn, statusEl) {
  btn.textContent = "Wird erstellt…";
  btn.disabled = true;

  // Open window immediately — before any async work
  const w = window.open("", "_blank");
  if (!w) {
    btn.textContent = "Report erstellen";
    btn.disabled = false;
    return;
  }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>Report wird erstellt…</title>
    <style>body{font-family:system-ui;padding:40px;color:#888780;}
    .dot{animation:pulse 1.2s ease-in-out infinite;}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}</style></head>
    <body><p>Report wird erstellt<span class="dot">…</span></p></body></html>`);
  w.document.close();
  window.blur();
  w.focus();

  const { generateReport } = await import("./report.js");
  await generateReport(
    { ...parcelResult, serviceLabel: service?.label },
    w,
    msg => { statusEl.textContent = msg; },
    new Set(reportSelected)
  );

  statusEl.textContent = "";
  btn.textContent = "Report erstellen";
  btn.disabled = false;
}
