const WFS_FEATURE_TYPE = "elu:ExistingLandUseObject";

export async function fetchWfsGeoJson(wfsUrl, bbox) {
  const url = `${wfsUrl}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature` +
    `&TYPENAMES=${WFS_FEATURE_TYPE}&SRSNAME=EPSG:4326` +
    `&BBOX=${bbox},EPSG:4326&COUNT=500`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return emptyCollection();
    return gmlToGeoJson(await res.text());
  } catch { return emptyCollection(); }
}

export async function fetchWfsPoint(wfsUrl, lng, lat) {
  const d = 0.005;
  const url = `${wfsUrl}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature` +
    `&TYPENAMES=${WFS_FEATURE_TYPE}&SRSNAME=EPSG:4326` +
    `&BBOX=${lng-d},${lat-d},${lng+d},${lat+d},EPSG:4326&COUNT=50`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return false;
    const doc = new DOMParser().parseFromString(await res.text(), "text/xml");
    for (const el of doc.getElementsByTagName("gml:posList")) {
      if (ringContainsPoint(el.textContent, lng, lat)) return true;
    }
    return false;
  } catch { return false; }
}

export function gmlToGeoJson(gml) {
  const doc = new DOMParser().parseFromString(gml, "text/xml");
  const features = [];
  for (const obj of doc.getElementsByTagName("elu:ExistingLandUseObject")) {
    const posLists = obj.getElementsByTagName("gml:posList");
    if (!posLists.length) continue;
    const rings = Array.from(posLists).map(parsePosList).filter(Boolean);
    if (!rings.length) continue;
    const geometry = rings.length === 1
      ? { type: "Polygon", coordinates: [rings[0]] }
      : { type: "MultiPolygon", coordinates: rings.map(r => [r]) };
    features.push({ type: "Feature", geometry, properties: {} });
  }
  return { type: "FeatureCollection", features };
}

function parsePosList(el) {
  const nums = el.textContent.trim().split(/\s+/).map(Number);
  const coords = [];
  for (let i = 0; i + 1 < nums.length; i += 2) coords.push([nums[i], nums[i + 1]]);
  return coords.length >= 3 ? coords : null;
}

function ringContainsPoint(text, lng, lat) {
  const nums = text.trim().split(/\s+/).map(Number);
  let inside = false;
  let i = 0, j = nums.length - 2;
  while (i < nums.length - 1) {
    const xi = nums[i], yi = nums[i + 1];
    const xj = nums[j], yj = nums[j + 1];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)
      inside = !inside;
    j = i; i += 2;
  }
  return inside;
}

function emptyCollection() {
  return { type: "FeatureCollection", features: [] };
}
