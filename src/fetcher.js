import { SERVICES } from "../services.js";
import { getVisible } from "./state.js";

async function fetchGfi(service, layer, viewport) {
  const version = "1.1.1";
  const url =
    `${service.wmsUrl}` +
    `?SERVICE=WMS&VERSION=${version}&REQUEST=GetFeatureInfo` +
    `&FORMAT=image/png&TRANSPARENT=true` +
    `&SRS=EPSG:4326&BBOX=${viewport.bbox}` +
    `&WIDTH=${viewport.width}&HEIGHT=${viewport.height}` +
    `&X=${viewport.x}&Y=${viewport.y}` +
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

async function fetchPixelColor(service, layer, lng, lat) {
  const d = 0.0001;
  const version = service.wmsVersion ?? "1.3.0";
  const crsParam = version === "1.3.0" ? "CRS" : "SRS";
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

export async function queryAtPoint(lng, lat, viewport) {
  const visible = getVisible();

  const activeServices = SERVICES.filter(s =>
    s.featureInfoType !== "none" &&
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
    } else {
      for (const l of svc.layers.filter(l => visible.has(`${svc.id}::${l.name}`)))
        tasks.push({ kind: "standard", service: svc, layer: l });
    }
  }

  const settled = await Promise.all(
    tasks.map(async t => {
      if (t.kind === "fern") {
        const color = await fetchPixelColor(t.service, t.layer, lng, lat);
        return { ...t, result: { layer: t.layer, value: color, properties: null, pixelColor: null } };
      }
      const result = await fetchGfi(t.service, t.layer, viewport);
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

  return entries;
}
