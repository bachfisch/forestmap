const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

export async function queryOverpass(query, bbox) {
  const body = `data=${encodeURIComponent(`[out:json][timeout:25][bbox:${bbox}];${query}`)}`;
  for (const url of MIRRORS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) return await res.json();
    } catch { /* try next mirror */ }
  }
  throw new Error("All Overpass mirrors failed");
}

export function osmToGeoJson(elements) {
  const features = [];
  for (const el of elements) {
    if (el.type === "way" && el.geometry?.length >= 4) {
      const coords = closeRing(el.geometry.map(p => [p.lon, p.lat]));
      features.push(makeFeature(el, { type: "Polygon", coordinates: [coords] }));
    }
    if (el.type === "relation" && el.members) {
      const outer = el.members
        .filter(m => m.type === "way" && m.geometry && (m.role === "outer" || m.role === ""))
        .map(m => closeRing(m.geometry.map(p => [p.lon, p.lat])))
        .filter(r => r.length >= 4);
      const inner = el.members
        .filter(m => m.type === "way" && m.geometry && m.role === "inner")
        .map(m => closeRing(m.geometry.map(p => [p.lon, p.lat])))
        .filter(r => r.length >= 4);
      if (!outer.length) continue;
      if (outer.length === 1) {
        features.push(makeFeature(el, { type: "Polygon", coordinates: [outer[0], ...inner] }));
      } else {
        features.push(makeFeature(el, { type: "MultiPolygon", coordinates: outer.map(r => [r]) }));
      }
    }
  }
  return { type: "FeatureCollection", features };
}

function closeRing(coords) {
  if (!coords.length) return coords;
  const [fx, fy] = coords[0], [lx, ly] = coords[coords.length - 1];
  if (fx !== lx || fy !== ly) coords.push(coords[0]);
  return coords;
}

function makeFeature(el, geometry) {
  return {
    type: "Feature",
    properties: { name: el.tags?.name ?? "", osm_id: el.id },
    geometry,
  };
}
