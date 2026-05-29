import { render as RasterValue }      from "./charts/RasterValue.js";
import { render as FeatureTable }     from "./charts/FeatureTable.js";
import { render as ScenarioBar }      from "./charts/ScenarioBar.js";
import { render as BuchdruckerChart } from "./charts/BuchdruckerChart.js";
import { render as BodenfeuchteChart} from "./charts/BodenfeuchteChart.js";
import { getFilter, getReportMode } from "./state.js";
import { SERVICES, CATEGORIES } from "../services.js";

// All reportable services (exclude the parcel layer itself)
const REPORT_SVCS = SERVICES.filter(s => s.category !== "flurstücke" && (s.featureInfoType !== "none" || s.wfsUrl));

const reportSelected = new Set(["laub-nadelwaldkarte", "waldhoehen"]);
import { setHighlight, clearHighlight } from "./highlight.js";

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
  body.append(chartEl);

  if ((service.category === "flurstücke" || service.category === "osm") && firstResult.geometry) {
    const btn = document.createElement("button");
    btn.className = "report-btn";
    btn.textContent = "Report erstellen";

    const statusEl = document.createElement("p");
    statusEl.className = "report-status";

    btn.addEventListener("click", () => triggerReport(firstResult, btn, statusEl));
    body.append(btn, buildReportDropdown(), statusEl);
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

async function triggerReport(parcelResult, btn, statusEl) {
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
  await generateReport(parcelResult, w, msg => { statusEl.textContent = msg; }, new Set(reportSelected));

  statusEl.textContent = "";
  btn.textContent = "Report erstellen";
  btn.disabled = false;
}
