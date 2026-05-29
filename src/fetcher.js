import { SERVICES } from "../services.js";
import { getVisible } from "./state.js";
import { fetchWfsPoint, fetchBiotopeAtPoint } from "./wfs.js";

async function fetchGfi(service, layer, lng, lat) {
  const d = service.gfiBboxDeg ?? 0.0005;
  const version = "1.1.1";
  const url =
    `${service.wmsUrl}` +
    `?SERVICE=WMS&VERSION=${version}&REQUEST=GetFeatureInfo` +
    `&FORMAT=image/png&TRANSPARENT=true` +
    `&SRS=EPSG:4326&BBOX=${lng-d},${lat-d},${lng+d},${lat+d}` +
    `&WIDTH=256&HEIGHT=256&X=128&Y=128` +
    `&LAYERS=${encodeURIComponent(layer.name)}` +
    `&QUERY_LAYERS=${encodeURIComponent(layer.name)}` +
    `&INFO_FORMAT=application/json&FEATURE_COUNT=1`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { layer, value: null, properties: null };
    const text = await res.text();

    if (text.trimStart().startsWith("{")) {
      return parseJsonGfi(service, layer, text);
    }
    return parseXmlGfi(layer, text);
  } catch {
    return { layer, value: null, properties: null };
  }
}

function parseXmlGfi(layer, xml) {
  try {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const fields = doc.getElementsByTagName("FIELDS")[0];
    if (!fields) return { layer, value: null, properties: null };

    const pv = fields.getAttribute("PixelValue");
    if (pv !== null) {
      if (pv === "NoData" || pv === "") return { layer, value: null, properties: null };
      const n = parseFloat(pv);
      return { layer, value: isNaN(n) ? null : n, properties: null };
    }

    const attrs = {};
    for (const attr of Array.from(fields.attributes)) {
      const num = parseFloat(attr.value);
      attrs[attr.name] = isNaN(num) ? attr.value : num;
    }
    if (!Object.keys(attrs).length) return { layer, value: null, properties: null };

    const firstNum = Object.values(attrs).find(v => typeof v === "number" && isFinite(v));
    return { layer, value: firstNum ?? null, properties: attrs };
  } catch {
    return { layer, value: null, properties: null };
  }
}

function parseJsonGfi(service, layer, text) {
  try {
    const json = JSON.parse(text);
    const features = json.features ?? [];
    if (!features.length) return { layer, value: null, properties: null, geometry: null };
    const feat = features[0];
    const props = feat.properties ?? {};
    let value =
      props.GRAY_INDEX ??
      props.value ??
      Object.values(props).find(v => typeof v === "number" && isFinite(v)) ??
      null;
    if (typeof value === "number" && service.valueScale) value *= service.valueScale;
    return { layer, value: typeof value === "number" ? value : null, properties: props, geometry: feat.geometry ?? null };
  } catch {
    return { layer, value: null, properties: null, geometry: null };
  }
}

async function fetchWfs(service, lng, lat) {
  const d = 0.0001;
  const url =
    `${service.wfsUrl}` +
    `?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature` +
    `&TYPENAMES=cp:CadastralParcel&COUNT=10&SRSNAME=EPSG:4326` +
    `&BBOX=${lng - d},${lat - d},${lng + d},${lat + d},EPSG:4326`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return parseGmlParcels(await res.text(), lng, lat);
  } catch {
    return null;
  }
}

function parseGmlParcels(gml, lng, lat) {
  try {
    const doc = new DOMParser().parseFromString(gml, "text/xml");
    const parcelEls = Array.from(doc.getElementsByTagName("cp:CadastralParcel"));
    if (!parcelEls.length) return null;

    for (const parcel of parcelEls) {
      const parsed = parseOneParcel(parcel);
      if (!parsed?.geometry) continue;
      const ring = parsed.geometry.coordinates[0];
      if (pointInRing(lng, lat, ring)) return parsed;
    }
    // Fallback: return first if none matched (e.g. click on boundary)
    return parseOneParcel(parcelEls[0]);
  } catch {
    return null;
  }
}

function parseOneParcel(parcel) {
  const label = parcel.getElementsByTagName("cp:label")[0]?.textContent?.trim() ?? null;
  const areaEl = parcel.getElementsByTagName("cp:areaValue")[0];
  const areaValue = areaEl ? parseFloat(areaEl.textContent) : null;
  const refEl = parcel.getElementsByTagName("cp:nationalCadastralReference")[0];
  const nationalRef = refEl?.textContent?.trim() ?? null;

  let geometry = null;
  const posListEl = parcel.getElementsByTagName("gml:posList")[0];
  if (posListEl) {
    const nums = posListEl.textContent.trim().split(/\s+/).map(Number);
    const coords = [];
    for (let i = 0; i + 1 < nums.length; i += 2) coords.push([nums[i], nums[i + 1]]);
    if (coords.length >= 3) geometry = { type: "Polygon", coordinates: [coords] };
  }

  return { label, areaValue, nationalRef, geometry };
}

function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

async function fetchPixelColor(service, layer, lng, lat) {
  const d = 0.0001;
  const url =
    `${service.wmsUrl}` +
    `?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap` +
    `&FORMAT=image/png&TRANSPARENT=true` +
    `&SRS=EPSG:4326&BBOX=${lng - d},${lat - d},${lng + d},${lat + d}` +
    `&WIDTH=3&HEIGHT=3` +
    `&LAYERS=${encodeURIComponent(layer.name)}&STYLES=`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = 3; canvas.height = 3;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    const [r, g, b, a] = ctx.getImageData(1, 1, 1, 1).data;
    if (a < 128) return null;
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  } catch {
    return null;
  }
}

export async function queryAtPoint(lng, lat) {
  const visible = getVisible();

  const activeServices = SERVICES.filter(s =>
    (s.featureInfoType !== "none" || s.wfsUrl) &&
    s.layers.some(l => visible.has(`${s.id}::${l.name}`))
  );

  if (!activeServices.length) return [];

  const tasks = [];

  for (const svc of activeServices) {
    const cat = svc.category;
    if (cat === "fernerkundung") {
      for (const l of svc.layers.filter(l => visible.has(`${svc.id}::${l.name}`)))
        tasks.push({ kind: "fern", service: svc, layer: l });
    } else if (cat === "klima" || cat === "dwd") {
      for (const l of svc.layers)
        tasks.push({ kind: "klima", service: svc, layer: l });
    } else if (cat === "waldbiotope" && svc.wfsUrl) {
      if (svc.layers.some(l => visible.has(`${svc.id}::${l.name}`)))
        tasks.push({ kind: "biotope-wfs", service: svc, layer: svc.layers[0] });
    } else if (cat === "waldfunktionen" && svc.wfsUrl && !svc.wmsUrl) {
      if (svc.layers.some(l => visible.has(`${svc.id}::${l.name}`)))
        tasks.push({ kind: "waldfunk-wfs", service: svc, layer: svc.layers[0] });
    } else if (cat === "flurstücke" && svc.wfsUrl) {
      if (svc.layers.some(l => visible.has(`${svc.id}::${l.name}`)))
        tasks.push({ kind: "wfs", service: svc, layer: svc.layers[0] });
    } else {
      for (const l of svc.layers.filter(l => visible.has(`${svc.id}::${l.name}`)))
        tasks.push({ kind: "standard", service: svc, layer: l });
    }
  }

  const settled = await Promise.all(
    tasks.map(async t => {
      if (t.kind === "biotope-wfs") {
        try {
          const features = await fetchBiotopeAtPoint(lng, lat);
          return { ...t, features };
        } catch {
          return { ...t, features: [] };
        }
      }
      if (t.kind === "fern") {
        const color = await fetchPixelColor(t.service, t.layer, lng, lat);
        return { ...t, result: { layer: t.layer, value: color, properties: null, pixelColor: null } };
      }
      if (t.kind === "waldfunk-wfs") {
        const hit = await fetchWfsPoint(t.service.wfsUrl, lng, lat);
        return { ...t, result: { layer: t.layer, value: hit ? "Vorhanden" : null, properties: hit ? { Waldfunktion: t.service.label } : null } };
      }
      if (t.kind === "wfs") {
        const parsed = await fetchWfs(t.service, lng, lat);
        return {
          ...t,
          result: {
            layer: t.layer,
            value: parsed?.label ?? null,
            properties: parsed ? {
              "Flurstücknummer": parsed.label,
              "Fläche": parsed.areaValue != null ? `${Math.round(parsed.areaValue).toLocaleString("de-DE")} m²` : null,
              "Katasterreferenz": parsed.nationalRef,
            } : null,
            geometry: parsed?.geometry ?? null,
          },
        };
      }
      const result = await fetchGfi(t.service, t.layer, lng, lat);
      return { ...t, result: { ...result, pixelColor: null } };
    })
  );

  const entries = [];

  const fernRows = settled
    .filter(r => r.kind === "fern")
    .map(r => ({ service: r.service, layer: r.layer, value: r.result.value }));
  if (fernRows.length) entries.push({ kind: "fernerkundung", rows: fernRows });

  const klimaMap = new Map();
  for (const r of settled.filter(r => r.kind === "klima")) {
    if (!klimaMap.has(r.service.id))
      klimaMap.set(r.service.id, { kind: "klima", service: r.service, results: [] });
    klimaMap.get(r.service.id).results.push(r.result);
  }
  entries.push(...klimaMap.values());

  const stdMap = new Map();
  for (const r of settled.filter(r => r.kind === "standard")) {
    if (!stdMap.has(r.service.id))
      stdMap.set(r.service.id, { kind: "standard", service: r.service, results: [] });
    stdMap.get(r.service.id).results.push(r.result);
  }
  entries.push(...stdMap.values());

  // Waldbiotope WFS — one entry per matched biotope polygon
  for (const r of settled.filter(r => r.kind === "biotope-wfs")) {
    const features = r.features ?? [];
    if (!features.length) continue;
    const results = features.map((f, i) => ({
      layer: { ...r.layer, label: f.name || `Biotop ${i + 1}` },
      value: f.name,
      properties: {
        "Typ": f.localName,
        "INSPIRE-Typ": f.refTypeName,
      },
    }));
    entries.push({ kind: "standard", service: r.service, results });
  }

  // Waldfunktionen WFS — one popup entry per service that has a polygon hit
  for (const r of settled.filter(r => r.kind === "waldfunk-wfs" && r.result.value !== null)) {
    entries.push({ kind: "standard", service: r.service, results: [r.result] });
  }

  const wfsMap = new Map();
  for (const r of settled.filter(r => r.kind === "wfs")) {
    if (!wfsMap.has(r.service.id))
      wfsMap.set(r.service.id, { kind: "standard", service: r.service, results: [] });
    wfsMap.get(r.service.id).results.push(r.result);
  }
  entries.push(...wfsMap.values());

  return entries;
}
