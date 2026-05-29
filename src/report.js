import { SERVICES, CATEGORIES } from "../services.js";

const WALDFUNK_SVCS = SERVICES.filter(s => s.category === "waldfunktionen");
const FERN_SVCS     = SERVICES.filter(s => s.category === "fernerkundung");
const BIOTOPE_SVC   = SERVICES.find(s => s.id === "waldbiotope");
const STANDORT_SVC  = SERVICES.find(s => s.id === "standortskarte");

// ── Entry point ───────────────────────────────────────────────────────────────

export async function generateReport(parcelResult, w, onStatus = () => {}, selection = null) {
  const ring = parcelResult.geometry?.coordinates?.[0];
  if (!ring) return;

  const lngs = ring.map(c => c[0]);
  const lats  = ring.map(c => c[1]);
  const west  = Math.min(...lngs);
  const east  = Math.max(...lngs);
  const south = Math.min(...lats);
  const north = Math.max(...lats);
  const bbox  = `${west},${south},${east},${north}`;
  const gridPts = buildGrid(ring, west, east, south, north, 15);

  // selection is a Set<serviceId>
  const sel = (selection instanceof Set)
    ? selection
    : new Set(SERVICES.filter(s => s.category !== "flurstücke" && s.featureInfoType !== "none").map(s => s.id));

  const activeFern     = FERN_SVCS.filter(s => sel.has(s.id));
  const activeWaldfunk = WALDFUNK_SVCS.filter(s => sel.has(s.id));
  const hasBiotope  = !!(BIOTOPE_SVC  && sel.has("waldbiotope"));
  const hasStandort = !!(STANDORT_SVC && sel.has("standortskarte"));

  // Generic sections: all other selected services grouped by category
  const SPECIAL = new Set([
    ...activeFern.map(s => s.id),
    ...activeWaldfunk.map(s => s.id),
    "waldbiotope", "standortskarte",
  ]);
  const catLabel = id => CATEGORIES.find(c => c.id === id)?.label ?? id;
  const genericByCategory = new Map();
  for (const svc of SERVICES) {
    if (!sel.has(svc.id) || SPECIAL.has(svc.id) || svc.category === "flurstücke") continue;
    if (!genericByCategory.has(svc.category)) genericByCategory.set(svc.category, []);
    genericByCategory.get(svc.category).push(svc);
  }

  // Write skeleton immediately
  w.document.open();
  w.document.write(buildSkeletonHtml(parcelResult.properties, activeFern, activeWaldfunk, hasBiotope, hasStandort, genericByCategory, catLabel));
  w.document.close();

  const tasks = [];
  let done = 0;
  const total = [activeFern.length > 0, activeWaldfunk.length > 0, hasBiotope, hasStandort, ...genericByCategory.keys()]
    .filter(Boolean).length;
  const tick = label => { done++; onStatus(`${label} fertig (${done}/${total})`); };

  if (activeFern.length) {
    tasks.push(
      fetchFernStack(activeFern, bbox, ring, west, east, south, north)
        .then(rows => { updateSection(w, "sec-fern", buildFernHtml(stackToFernData(rows, activeFern))); tick("Fernerkundung"); })
        .catch(() => { updateSection(w, "sec-fern", sectionFallback("sec-fern", "Fernerkundung")); tick("Fernerkundung"); })
    );
  }

  if (activeWaldfunk.length) {
    const { mask: wfMask, total: wfTotal } = buildParcelMask(ring, west, east, south, north, 512);
    tasks.push(
      Promise.all(activeWaldfunk.map(svc =>
        (svc.wfsUrl
          ? fetchWaldfunkWfs(svc, bbox, gridPts)
          : gfiCoverage(svc.wmsUrl, svc.layers[0].name, gridPts)
        ).then(pct => ({ label: svc.label, pct }))
      ))
      .then(data => { updateSection(w, "sec-waldfunk", buildWaldfunkHtml(data)); tick("Waldfunktionen"); })
      .catch(() => { updateSection(w, "sec-waldfunk", sectionFallback("sec-waldfunk", "Waldfunktionen")); tick("Waldfunktionen"); })
    );
  }

  if (hasBiotope) {
    tasks.push(
      gfiFromGetMap(BIOTOPE_SVC, bbox, ring, west, east, south, north, { dedup: "OBJECTID" })
        .then(raw => { updateSection(w, "sec-biotope", buildBiotopeHtml(raw)); tick("Waldbiotope"); })
        .catch(() => { updateSection(w, "sec-biotope", sectionFallback("sec-biotope", "Waldbiotope")); tick("Waldbiotope"); })
    );
  }

  if (hasStandort) {
    tasks.push(
      gridGfi(STANDORT_SVC.wmsUrl, STANDORT_SVC.layers[0].name, gridPts)
        .then(raw => { updateSection(w, "sec-standort", buildStandortHtml(raw)); tick("Standortskarte"); })
        .catch(() => { updateSection(w, "sec-standort", sectionFallback("sec-standort", "Forstliche Standortskarte")); tick("Standortskarte"); })
    );
  }

  for (const [catId, svcs] of genericByCategory) {
    const label = catLabel(catId);
    const secId = `sec-cat-${catId}`;
    tasks.push(
      Promise.all(svcs.map(svc => fetchGenericSvc(svc, bbox, ring, west, east, south, north, gridPts)))
        .then(results => { updateSection(w, secId, buildGenericCatHtml(secId, label, svcs, results)); tick(label); })
        .catch(() => { updateSection(w, secId, sectionFallback(secId, label)); tick(label); })
    );
  }

  await Promise.all(tasks);
  onStatus("");
}

function updateSection(w, id, html) {
  try {
    const el = w.document.getElementById(id);
    if (el) el.outerHTML = html;
  } catch {}
}

// ── Section builders ──────────────────────────────────────────────────────────

function buildSkeletonHtml(props, activeFern, activeWaldfunk, hasBiotope, hasStandort, genericByCategory, catLabel) {
  const sections = [
    activeFern.length     ? `<div id="sec-fern"><h2>Fernerkundung</h2><p class="loading-hint">Pixelanalyse läuft…</p></div>` : "",
    activeWaldfunk.length ? `<div id="sec-waldfunk"><h2>Waldfunktionen</h2><p class="loading-hint">GFI-Abfragen laufen…</p></div>` : "",
    hasBiotope  ? `<div id="sec-biotope"><h2>Waldbiotope</h2><p class="loading-hint">Wird abgefragt…</p></div>` : "",
    hasStandort ? `<div id="sec-standort"><h2>Forstliche Standortskarte – RZST</h2><p class="loading-hint">Wird abgefragt…</p></div>` : "",
    ...[...genericByCategory.keys()].map(catId =>
      `<div id="sec-cat-${catId}"><h2>${esc(catLabel(catId))}</h2><p class="loading-hint">Wird abgefragt…</p></div>`
    ),
  ].filter(Boolean).join("\n");

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>Flurstück-Report – ${esc(props?.["Flurstücknummer"] ?? "")}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<h1>Flurstück ${esc(props?.["Flurstücknummer"] ?? "–")}</h1>
<p class="meta">
  Fläche: ${esc(props?.["Fläche"] ?? "–")} &nbsp;·&nbsp;
  Katasterreferenz: ${esc(props?.["Katasterreferenz"] ?? "–")} &nbsp;·&nbsp;
  Abgefragt: ${new Date().toLocaleDateString("de-DE")}
</p>
${sections}
<footer>
  Datenquelle: FVA Baden-Württemberg via OWS-Proxy LGL BW &nbsp;·&nbsp;
  Fernerkundung: Pixelanalyse WMS GetMap &nbsp;·&nbsp;
  Waldfunktionen/Standort: GFI-Stichprobenraster 15×15
</footer>
</body>
</html>`;
}

function sectionFallback(id, title) {
  return `<section id="${id}"><h2>${esc(title)}</h2><p class="none">Abfrage fehlgeschlagen.</p></section>`;
}

function buildFernHtml(fernData) {
  const cards = fernData.filter(f => f.segments?.length > 0).map(f => {
    const legendRows = f.segments.map(s =>
      `<tr>
        <td><span class="swatch" style="background:${s.hex};${s.hex==='#FFFFFF'?'border:1px solid #ccc;':''}"></span></td>
        <td>${esc(s.label ?? s.hex)}</td>
        <td>${s.pct} %</td>
      </tr>`
    ).join("");
    const chart = f.type === "histogram"
      ? `<div class="hist-wrap">${htmlHistogram(f.segments)}</div>`
      : `<div class="fern-inner">${svgPie(f.segments)}<table class="fern-legend"><tbody>${legendRows}</tbody></table></div>`;
    return `<div class="fern-card ${f.type === "histogram" ? "fern-wide" : ""}">
      <div class="fern-title">${esc(f.label)}</div>${chart}</div>`;
  }).join("");

  return `<section id="sec-fern"><h2>Fernerkundung</h2>${
    cards ? `<div class="fern-grid">${cards}</div>` : `<p class="none">Keine Fernerkundungsdaten im Flurstück.</p>`
  }</section>`;
}

function buildWaldfunkHtml(waldfunk) {
  const rows = waldfunk
    .filter(w => w.pct !== null && w.pct > 0)
    .sort((a, b) => b.pct - a.pct)
    .map(w => `<tr><td>${esc(w.label)}</td><td>${w.pct} %</td></tr>`)
    .join("");
  return `<section id="sec-waldfunk"><h2>Waldfunktionen</h2>${rows
    ? `<table><thead><tr><th>Waldfunktion</th><th>Bedeckung</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p class="none">Keine Waldfunktionen im Flurstück.</p>`
  }</section>`;
}

function buildBiotopeHtml(biotopeRaw) {
  const seen = new Set();
  const rows = biotopeRaw.filter(b => {
    const key = b.OBJECTID ?? b.WBK_NAME ?? JSON.stringify(b);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).map(b => `<tr>
    <td>${esc(b.BiotopName ?? "–")}</td>
    <td>${esc(b.WBK_NAME ?? "–")}</td>
    <td>${esc(b.BT_MorphstruBem ?? "–")}</td>
    <td>${b.URL_INTERNET ? `<a href="${esc(b.URL_INTERNET)}" target="_blank">↗</a>` : "–"}</td>
  </tr>`).join("");
  return `<section id="sec-biotope"><h2>Waldbiotope</h2>${rows
    ? `<table><thead><tr><th>BiotopName</th><th>WBK_NAME</th><th>Strukturbemerkung</th><th>Info</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p class="none">Keine Waldbiotope im Flurstück gefunden.</p>`
  }</section>`;
}

function buildStandortHtml(standortRaw) {
  const counts = {};
  let total = 0;
  for (const s of standortRaw) {
    if (s.RZST) { counts[s.RZST] = (counts[s.RZST] ?? 0) + 1; total++; }
  }
  const rows = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => `<tr><td>${esc(name)}</td><td>${Math.round(n / total * 100)} %</td></tr>`)
    .join("");
  return `<section id="sec-standort"><h2>Forstliche Standortskarte – RZST</h2>${rows
    ? `<table><thead><tr><th>Regionalzonaler Standorttyp</th><th>Flächenanteil (Stichprobe)</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p class="none">Keine Standortdaten im Flurstück gefunden.</p>`
  }</section>`;
}

async function fetchGenericSvc(svc, bbox, ring, west, east, south, north, gridPts) {
  if (svc.featureInfoType === "geojson") {
    return { type: "geojson", data: await gfiFromGetMap(svc, bbox, ring, west, east, south, north, {}).catch(() => []) };
  }
  // value-only: coverage % for each layer (first layer only to avoid request overload)
  const layer = svc.layers[0];
  const pct = await gfiCoverage(svc.wmsUrl, layer.name.split(",")[0], gridPts).catch(() => null);
  return { type: "value", label: svc.label, pct };
}

function buildGenericCatHtml(secId, catLabel, svcs, results) {
  const SKIP_KEYS = new Set(["OBJECTID", "Shape", "geometry", "bbox", "type", "SHAPE_Length", "SHAPE_Area", "BetriebsID", "Schluessel"]);

  const parts = svcs.map((svc, i) => {
    const result = results[i];
    if (!result) return "";

    if (result.type === "geojson") {
      if (!result.data?.length) return `<p class="none" style="font-size:12px">${esc(svc.label)}: Keine Daten.</p>`;
      const tables = result.data.slice(0, 3).map(props => {
        const rows = Object.entries(props)
          .filter(([k]) => !SKIP_KEYS.has(k))
          .slice(0, 10)
          .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(String(v ?? "–"))}</td></tr>`)
          .join("");
        return rows ? `<table class="attr-table"><tbody>${rows}</tbody></table>` : "";
      }).filter(Boolean).join(`<div style="height:6px"></div>`);
      return `<p class="svc-sublabel">${esc(svc.label)}</p>${tables}`;
    }

    if (result.pct === null || result.pct === 0) return `<tr><td>${esc(result.label ?? svc.label)}</td><td class="muted">Nicht im Flurstück</td></tr>`;
    return `<tr><td>${esc(result.label ?? svc.label)}</td><td>${result.pct} %</td></tr>`;
  });

  const valueParts = parts.filter((p, i) => results[i]?.type === "value" && p);
  const geojsonParts = parts.filter((p, i) => results[i]?.type === "geojson" && p);

  const inner = [
    valueParts.length ? `<table><thead><tr><th>Layer</th><th>Bedeckung</th></tr></thead><tbody>${valueParts.join("")}</tbody></table>` : "",
    ...geojsonParts,
  ].filter(Boolean).join("") || `<p class="none">Keine Daten gefunden.</p>`;

  return `<section id="${secId}"><h2>${esc(catLabel)}</h2>${inner}</section>`;
}

// ── Waldfunktionen WFS coverage ──────────────────────────────────────────────

async function fetchWaldfunkWfs(svc, bbox, gridPts) {
  const url =
    `${svc.wfsUrl}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature` +
    `&TYPENAMES=elu:ExistingLandUseObject&SRSNAME=EPSG:4326` +
    `&BBOX=${bbox},EPSG:4326&COUNT=200`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const text = await res.text();
    const polygons = parseGmlPolygons(text);
    if (!polygons.length) return 0;
    let hit = 0;
    for (const { lng, lat } of gridPts) {
      if (polygons.some(ring => pointInPolygon(lng, lat, ring))) hit++;
    }
    return gridPts.length > 0 ? Math.round(hit / gridPts.length * 100) : null;
  } catch { return null; }
}

function parseGmlPolygons(gml) {
  const doc = new DOMParser().parseFromString(gml, "text/xml");
  const rings = [];
  for (const el of doc.getElementsByTagName("gml:posList")) {
    const nums = el.textContent.trim().split(/\s+/).map(Number);
    if (nums.length < 6) continue;
    const coords = [];
    for (let i = 0; i + 1 < nums.length; i += 2) coords.push([nums[i], nums[i + 1]]);
    if (coords.length >= 3) rings.push(coords);
  }
  return rings;
}

// ── Waldfunktionen pixel coverage ────────────────────────────────────────────

function buildParcelMask(ring, west, east, south, north, res) {
  const mc = document.createElement("canvas");
  mc.width = mc.height = res;
  const ctx = mc.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  for (let i = 0; i < ring.length; i++) {
    const x = (ring[i][0] - west) / (east - west) * res;
    const y = (north - ring[i][1]) / (north - south) * res;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  const data = ctx.getImageData(0, 0, res, res).data;
  let total = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] >= 128) total++;
  return { mask: data, total };
}

async function fetchWaldfunkPixel(svc, bbox, mask, maskedTotal, res = 512) {
  const url =
    `${svc.wmsUrl}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap` +
    `&FORMAT=image/png&TRANSPARENT=true` +
    `&LAYERS=${encodeURIComponent(svc.layers[0].name)}&STYLES=` +
    `&SRS=EPSG:4326&BBOX=${bbox}&WIDTH=${res}&HEIGHT=${res}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const blob = await r.blob();
    const objUrl = URL.createObjectURL(blob);
    const img = await new Promise((resolve, reject) => {
      const el = new Image(); el.onload = () => resolve(el); el.onerror = reject; el.src = objUrl;
    }).finally(() => URL.revokeObjectURL(objUrl));
    const c = document.createElement("canvas");
    c.width = c.height = res;
    c.getContext("2d").drawImage(img, 0, 0);
    const pix = c.getContext("2d").getImageData(0, 0, res, res).data;
    let hit = 0;
    for (let i = 3; i < mask.length; i += 4) {
      if (mask[i] >= 128 && pix[i] >= 128) hit++;
    }
    return maskedTotal > 0 ? Math.round(hit / maskedTotal * 100) : null;
  } catch { return null; }
}

// ── Grid ──────────────────────────────────────────────────────────────────────

function buildGrid(ring, west, east, south, north, gridSize = 15) {
  const pts = [];
  for (let xi = 0; xi < gridSize; xi++) {
    for (let yi = 0; yi < gridSize; yi++) {
      const lng = west + (xi + 0.5) / gridSize * (east - west);
      const lat = south + (yi + 0.5) / gridSize * (north - south);
      if (pointInPolygon(lng, lat, ring)) pts.push({ lng, lat });
    }
  }
  return pts;
}

// ── GFI ───────────────────────────────────────────────────────────────────────

async function gfiCoverage(wmsUrl, layerName, gridPts) {
  if (!gridPts.length) return null;
  const hits = await Promise.all(gridPts.map(p => pointGfi(wmsUrl, layerName, p.lng, p.lat)));
  return Math.round(hits.filter(Boolean).length / gridPts.length * 100);
}

async function gridGfi(wmsUrl, layerName, gridPts) {
  const results = await Promise.all(gridPts.map(p => pointGfi(wmsUrl, layerName, p.lng, p.lat)));
  return results.filter(Boolean);
}

async function gfiFromGetMap(svc, bbox, ring, west, east, south, north, { dedup, maxQueries = 25, res = 256 } = {}) {
  const mapUrl =
    `${svc.wmsUrl}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap` +
    `&FORMAT=image/png&TRANSPARENT=true` +
    `&LAYERS=${encodeURIComponent(svc.layers[0].name)}&STYLES=` +
    `&SRS=EPSG:4326&BBOX=${bbox}&WIDTH=${res}&HEIGHT=${res}`;

  let pixData;
  try {
    const r = await fetch(mapUrl, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return [];
    const blob = await r.blob();
    const objUrl = URL.createObjectURL(blob);
    const img = await new Promise((resolve, reject) => {
      const el = new Image(); el.onload = () => resolve(el); el.onerror = reject; el.src = objUrl;
    }).finally(() => URL.revokeObjectURL(objUrl));
    const c = document.createElement("canvas"); c.width = c.height = res;
    c.getContext("2d").drawImage(img, 0, 0);
    pixData = c.getContext("2d").getImageData(0, 0, res, res).data;
  } catch { return []; }

  const mc = document.createElement("canvas"); mc.width = mc.height = res;
  const mCtx = mc.getContext("2d"); mCtx.fillStyle = "#fff"; mCtx.beginPath();
  for (let i = 0; i < ring.length; i++) {
    const x = (ring[i][0] - west) / (east - west) * res;
    const y = (north - ring[i][1]) / (north - south) * res;
    i === 0 ? mCtx.moveTo(x, y) : mCtx.lineTo(x, y);
  }
  mCtx.closePath(); mCtx.fill();
  const mask = mc.getContext("2d").getImageData(0, 0, res, res).data;

  const candidates = [];
  for (let i = 0; i < mask.length; i += 4) {
    if (mask[i + 3] < 128 || pixData[i + 3] < 128) continue;
    const px = (i / 4) % res, py = Math.floor((i / 4) / res);
    candidates.push({
      lon: west  + (px + 0.5) / res * (east - west),
      lat: north - (py + 0.5) / res * (north - south),
    });
  }
  if (!candidates.length) return [];

  const step = Math.max(1, Math.floor(candidates.length / maxQueries));
  const sample = candidates.filter((_, i) => i % step === 0).slice(0, maxQueries);

  const results = await Promise.all(
    sample.map(({ lon, lat }) => pointGfi(svc.wmsUrl, svc.layers[0].name, lon, lat))
  );

  const seen = new Set();
  return results.filter(r => {
    if (!r) return false;
    const key = dedup ? (r[dedup] ?? JSON.stringify(r)) : JSON.stringify(r);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

async function pointGfi(wmsUrl, layerName, lng, lat) {
  const d = 0.0005;
  const url =
    `${wmsUrl}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo` +
    `&FORMAT=image/png&TRANSPARENT=true` +
    `&SRS=EPSG:4326&BBOX=${lng-d},${lat-d},${lng+d},${lat+d}` +
    `&WIDTH=256&HEIGHT=256&X=128&Y=128` +
    `&LAYERS=${encodeURIComponent(layerName)}&QUERY_LAYERS=${encodeURIComponent(layerName)}` +
    `&INFO_FORMAT=application/json&FEATURE_COUNT=1`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.trimStart().startsWith("{") || text.trimStart().startsWith("[")) {
      try {
        const json = JSON.parse(text);
        const props = json?.features?.[0]?.properties;
        return (props && Object.keys(props).length > 0) ? props : null;
      } catch { /* fall through */ }
    }
    if (text.includes("FIELDS")) {
      const doc = new DOMParser().parseFromString(text, "text/xml");
      const fields = doc.getElementsByTagName("FIELDS")[0];
      if (!fields) return null;
      const attrs = {};
      for (const a of fields.attributes) attrs[a.name] = a.value;
      return Object.keys(attrs).length > 0 ? attrs : null;
    }
    return null;
  } catch { return null; }
}

// ── Fernerkundung pixel stack ─────────────────────────────────────────────────

async function fetchFernStack(svcs, bbox, ring, west, east, south, north, res = 256) {
  const mc = document.createElement("canvas");
  mc.width = mc.height = res;
  const mCtx = mc.getContext("2d");
  mCtx.fillStyle = "#fff";
  mCtx.beginPath();
  for (let i = 0; i < ring.length; i++) {
    const x = (ring[i][0] - west) / (east - west) * res;
    const y = (north - ring[i][1]) / (north - south) * res;
    i === 0 ? mCtx.moveTo(x, y) : mCtx.lineTo(x, y);
  }
  mCtx.closePath();
  mCtx.fill();
  const mask = mCtx.getImageData(0, 0, res, res).data;

  const pixArrays = await Promise.all(svcs.map(async svc => {
    const url =
      `${svc.wmsUrl}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap` +
      `&FORMAT=image/png&TRANSPARENT=true` +
      `&LAYERS=${encodeURIComponent(svc.layers[0].name)}&STYLES=` +
      `&SRS=EPSG:4326&BBOX=${bbox}&WIDTH=${res}&HEIGHT=${res}`;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return null;
      const blob = await r.blob();
      const objUrl = URL.createObjectURL(blob);
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = objUrl;
      }).finally(() => URL.revokeObjectURL(objUrl));
      const c = document.createElement("canvas");
      c.width = c.height = res;
      c.getContext("2d").drawImage(img, 0, 0);
      return c.getContext("2d").getImageData(0, 0, res, res).data;
    } catch { return null; }
  }));

  const rows = [];
  let maskedTotal = 0;
  for (let i = 0; i < mask.length; i += 4) {
    if (mask[i + 3] < 128) continue;
    maskedTotal++;
    const row = { _index: maskedTotal - 1 };
    for (let si = 0; si < svcs.length; si++) {
      const px = pixArrays[si];
      if (!px || px[i + 3] < 128) { row[svcs[si].id] = null; continue; }
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const rr = Math.min(240, (r + 8) >> 4 << 4);
      const gg = Math.min(240, (g + 8) >> 4 << 4);
      const bb = Math.min(240, (b + 8) >> 4 << 4);
      row[svcs[si].id] = `#${rr.toString(16).padStart(2,"0")}${gg.toString(16).padStart(2,"0")}${bb.toString(16).padStart(2,"0")}`;
    }
    rows.push(row);
  }
  rows._total = maskedTotal;
  return rows;
}

function stackToFernData(rows, svcs) {
  const total = rows._total ?? rows.length;
  if (!total) return svcs.map(svc => ({ label: svc.label, id: svc.id, type: "pie", segments: [] }));

  return svcs.map(svc => {
    const counts = {};
    let coloredTotal = 0;
    for (const row of rows) {
      const hex = row[svc.id];
      if (hex) { counts[hex] = (counts[hex] ?? 0) + 1; coloredTotal++; }
    }
    const denom = svc.colorLegend?.countParcel ? total : coloredTotal;
    if (!denom) return { label: svc.label, id: svc.id, type: "pie", segments: [] };

    const rawColors = Object.entries(counts)
      .map(([hex, n]) => ({ hex, pct: Math.round(n / denom * 100) }))
      .filter(s => s.pct >= 1);

    const matched = svc.colorLegend
      ? matchToLegend(rawColors, svc.colorLegend)
      : { type: "pie", segments: rawColors.sort((a, b) => b.pct - a.pct) };

    return { label: svc.label, id: svc.id, ...matched };
  });
}

// ── Legend color matching ─────────────────────────────────────────────────────

function hexToRgb(hex) {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
}

function colorDist([r1,g1,b1], [r2,g2,b2]) {
  return Math.sqrt((r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2);
}

function matchToLegend(rawColors, legend) {
  const matched = new Map(legend.entries.map(e => [e.label, { hex: e.hex, label: e.label, pct: 0 }]));
  for (const { hex, pct } of rawColors) {
    const rgb = hexToRgb(hex);
    let best = null, bestDist = Infinity;
    for (const entry of legend.entries) {
      const d = colorDist(rgb, hexToRgb(entry.hex));
      if (d < bestDist) { bestDist = d; best = entry; }
    }
    if (best && bestDist < 100) matched.get(best.label).pct += pct;
  }
  const segments = [...matched.values()].filter(s => s.pct >= 1);
  if (legend.type === "histogram") return { type: "histogram", segments };
  return { type: "pie", segments: segments.sort((a, b) => b.pct - a.pct) };
}

// ── Geometry ──────────────────────────────────────────────────────────────────

function pointInPolygon(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

// ── SVG pie chart ─────────────────────────────────────────────────────────────

function svgPie(segments, size = 110) {
  if (!segments.length) return "";
  if (segments.length === 1) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size/2}" cy="${size/2}" r="${size/2-2}" fill="${segments[0].hex}"/>
    </svg>`;
  }
  const r = size / 2 - 2, cx = size / 2, cy = size / 2;
  let angle = -Math.PI / 2, paths = "";
  for (const seg of segments) {
    const a = (seg.pct / 100) * 2 * Math.PI;
    const x1 = cx + r * Math.cos(angle),     y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(angle + a), y2 = cy + r * Math.sin(angle + a);
    paths += `<path d="M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r},0,${a > Math.PI ? 1 : 0},1,${x2.toFixed(2)},${y2.toFixed(2)} Z" fill="${seg.hex}" stroke="#fff" stroke-width="1"/>`;
    angle += a;
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${paths}</svg>`;
}

// ── HTML histogram bars ───────────────────────────────────────────────────────

function htmlHistogram(segments) {
  return segments.map(s => `
    <div class="hist-row">
      <span class="hist-label">${esc(s.label)}</span>
      <div class="hist-bar-wrap">
        <div class="hist-bar" style="width:${s.pct}%;background:${s.hex};${s.hex === '#FFFFFF' ? 'border:1px solid #ddd;' : ''}"></div>
        <span class="hist-pct">${s.pct} %</span>
      </div>
    </div>`).join("");
}

// ── Report CSS ────────────────────────────────────────────────────────────────

const REPORT_CSS = `
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 960px; margin: 40px auto; padding: 0 24px; color: #2a2722; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  .meta { color: #888780; font-size: 13px; margin-bottom: 32px; }
  h2 { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
       color: #1D9E75; border-bottom: 2px solid #1D9E75; padding-bottom: 5px; margin: 32px 0 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; padding: 6px 10px; background: #f5f4f0; font-weight: 600; border-bottom: 2px solid #e0ddd8; }
  td { padding: 5px 10px; border-bottom: 1px solid #e0ddd8; vertical-align: middle; }
  .muted { color: #aaa; }
  .none { color: #888780; font-size: 12px; font-style: italic; margin: 0; }
  .svc-sublabel { font-size: 11px; font-weight: 600; color: #888780; margin: 10px 0 4px; }
  .loading-hint { color: #888780; font-size: 12px; font-style: italic; margin: 0;
                  animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }
  a { color: #1D9E75; }
  .fern-grid { display: flex; flex-wrap: wrap; gap: 16px; }
  .fern-card { border: 1px solid #e0ddd8; border-radius: 6px; padding: 12px 14px; min-width: 160px; }
  .fern-wide { flex: 1 1 100%; }
  .fern-title { font-size: 11px; font-weight: 600; color: #888780; text-transform: uppercase;
                letter-spacing: .04em; margin-bottom: 10px; }
  .fern-inner { display: flex; align-items: center; gap: 14px; }
  .fern-legend { width: auto; }
  .fern-legend td { padding: 2px 6px; border: none; font-size: 11px; }
  .swatch { display: inline-block; width: 12px; height: 12px; border-radius: 2px; vertical-align: middle; }
  .hist-wrap { display: flex; flex-direction: column; gap: 3px; }
  .hist-row { display: flex; align-items: center; gap: 8px; font-size: 11px; }
  .hist-label { width: 72px; flex-shrink: 0; color: #888780; text-align: right; }
  .hist-bar-wrap { flex: 1; display: flex; align-items: center; gap: 6px; }
  .hist-bar { height: 14px; min-width: 2px; border-radius: 2px; }
  .hist-pct { font-size: 10px; color: #888780; white-space: nowrap; }
  footer { margin-top: 48px; font-size: 11px; color: #aaa; border-top: 1px solid #e0ddd8; padding-top: 12px; }
  @media print { body { max-width: 100%; margin: 16px; } }
`;

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
