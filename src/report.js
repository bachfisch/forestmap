import { SERVICES } from "../services.js";

const WALDFUNK_SVCS = SERVICES.filter(s => s.category === "waldfunktionen");
const BIOTOPE_SVC   = SERVICES.find(s => s.id === "waldbiotope");
const STANDORT_SVC  = SERVICES.find(s => s.id === "standortskarte");

export async function generateReport(parcelResult, w) {
  const ring = parcelResult.geometry?.coordinates?.[0];
  if (!ring) return;

  const lngs  = ring.map(c => c[0]);
  const lats   = ring.map(c => c[1]);
  const west   = Math.min(...lngs);
  const east   = Math.max(...lngs);
  const south  = Math.min(...lats);
  const north  = Math.max(...lats);
  const bbox   = `${west},${south},${east},${north}`;

  // Build grid points once, reuse across all GFI queries
  const gridPts = buildGrid(ring, west, east, south, north, 15);

  const [waldfunk, biotopeRaw, standortRaw] = await Promise.all([
    Promise.all(WALDFUNK_SVCS.map(svc =>
      gfiCoverage(svc.wmsUrl, svc.layers[0].name, gridPts)
        .then(pct => ({ label: svc.label, pct }))
    )),
    gridGfi(BIOTOPE_SVC.wmsUrl,  BIOTOPE_SVC.layers[0].name,  gridPts),
    gridGfi(STANDORT_SVC.wmsUrl, STANDORT_SVC.layers[0].name, gridPts),
  ]);

  const html = buildHtml(parcelResult.properties, waldfunk, biotopeRaw, standortRaw);
  w.document.open();
  w.document.write(html);
  w.document.close();
}

// ── Grid building ─────────────────────────────────────────────────────────────

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

// ── GFI coverage (hit ratio across grid points) ───────────────────────────────

async function gfiCoverage(wmsUrl, layerName, gridPts) {
  if (!gridPts.length) return null;
  const hits = await Promise.all(gridPts.map(p => pointGfi(wmsUrl, layerName, p.lng, p.lat)));
  const count = hits.filter(Boolean).length;
  return Math.round(count / gridPts.length * 100);
}

// ── Grid GFI sampling (returns attribute objects) ─────────────────────────────

async function gridGfi(wmsUrl, layerName, gridPts) {
  const results = await Promise.all(gridPts.map(p => pointGfi(wmsUrl, layerName, p.lng, p.lat)));
  return results.filter(Boolean);
}

async function pointGfi(wmsUrl, layerName, lng, lat) {
  const d = 0.0005;
  const url =
    `${wmsUrl}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo` +
    `&FORMAT=image/png&TRANSPARENT=true` +
    `&SRS=EPSG:4326&BBOX=${lng - d},${lat - d},${lng + d},${lat + d}` +
    `&WIDTH=11&HEIGHT=11&X=5&Y=5` +
    `&LAYERS=${encodeURIComponent(layerName)}&QUERY_LAYERS=${encodeURIComponent(layerName)}` +
    `&INFO_FORMAT=application/json&FEATURE_COUNT=1`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text.includes("FIELDS")) return null;
    const doc = new DOMParser().parseFromString(text, "text/xml");
    const fields = doc.getElementsByTagName("FIELDS")[0];
    if (!fields) return null;
    const attrs = {};
    for (const a of fields.attributes) attrs[a.name] = a.value;
    return attrs;
  } catch {
    return null;
  }
}

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

// ── HTML report ───────────────────────────────────────────────────────────────

function buildHtml(props, waldfunk, biotopeRaw, standortRaw) {
  const waldfunkRows = waldfunk
    .filter(w => w.pct !== null && w.pct > 0)
    .sort((a, b) => b.pct - a.pct)
    .map(w => `<tr><td>${esc(w.label)}</td><td>${w.pct} %</td></tr>`)
    .join("");

  const seenBiotope = new Set();
  const biotopeRows = biotopeRaw
    .filter(b => {
      const key = b.OBJECTID ?? b.WBK_NAME ?? JSON.stringify(b);
      if (seenBiotope.has(key)) return false;
      seenBiotope.add(key);
      return true;
    })
    .map(b => `<tr>
      <td>${esc(b.BiotopName ?? "–")}</td>
      <td>${esc(b.WBK_NAME ?? "–")}</td>
      <td>${esc(b.BT_MorphstruBem ?? "–")}</td>
      <td>${b.URL_INTERNET ? `<a href="${esc(b.URL_INTERNET)}" target="_blank">↗</a>` : "–"}</td>
    </tr>`)
    .join("");

  const rzstCounts = {};
  let rzstTotal = 0;
  for (const s of standortRaw) {
    if (s.RZST) { rzstCounts[s.RZST] = (rzstCounts[s.RZST] ?? 0) + 1; rzstTotal++; }
  }
  const rzstRows = Object.entries(rzstCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => `<tr><td>${esc(name)}</td><td>${Math.round(n / rzstTotal * 100)} %</td></tr>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>Flurstück-Report – ${esc(props?.["Flurstücknummer"] ?? "")}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 24px; color: #2a2722; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  .meta { color: #888780; font-size: 13px; margin-bottom: 32px; }
  h2 { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
       color: #1D9E75; border-bottom: 2px solid #1D9E75; padding-bottom: 5px; margin: 32px 0 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; padding: 6px 10px; background: #f5f4f0; font-weight: 600; border-bottom: 2px solid #e0ddd8; }
  td { padding: 6px 10px; border-bottom: 1px solid #e0ddd8; vertical-align: top; }
  .none { color: #888780; font-size: 12px; font-style: italic; margin: 0; }
  a { color: #1D9E75; }
  footer { margin-top: 48px; font-size: 11px; color: #aaa; border-top: 1px solid #e0ddd8; padding-top: 12px; }
  @media print { body { max-width: 100%; margin: 16px; } }
</style>
</head>
<body>
<h1>Flurstück ${esc(props?.["Flurstücknummer"] ?? "–")}</h1>
<p class="meta">
  Fläche: ${esc(props?.["Fläche"] ?? "–")} &nbsp;·&nbsp;
  Katasterreferenz: ${esc(props?.["Katasterreferenz"] ?? "–")} &nbsp;·&nbsp;
  Abgefragt: ${new Date().toLocaleDateString("de-DE")}
</p>

<h2>Waldfunktionen</h2>
${waldfunkRows
  ? `<table><thead><tr><th>Waldfunktion</th><th>Bedeckung</th></tr></thead><tbody>${waldfunkRows}</tbody></table>`
  : `<p class="none">Keine Waldfunktionen im Flurstück.</p>`}

<h2>Waldbiotope</h2>
${biotopeRows
  ? `<table><thead><tr><th>BiotopName</th><th>WBK_NAME</th><th>Strukturbemerkung</th><th>Info</th></tr></thead><tbody>${biotopeRows}</tbody></table>`
  : `<p class="none">Keine Waldbiotope im Flurstück gefunden.</p>`}

<h2>Forstliche Standortskarte – Regionalzonaler Standorttyp (RZST)</h2>
${rzstRows
  ? `<table><thead><tr><th>RZST</th><th>Flächenanteil (Stichprobe)</th></tr></thead><tbody>${rzstRows}</tbody></table>`
  : `<p class="none">Keine Standortdaten im Flurstück gefunden.</p>`}

<footer>
  Datenquelle: FVA Baden-Württemberg via OWS-Proxy LGL BW &nbsp;·&nbsp;
  Waldfunktionen: Pixelanalyse WMS GetMap &nbsp;·&nbsp;
  Waldbiotope/Standort: GFI-Stichprobenraster (7×7)
</footer>
</body>
</html>`;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
