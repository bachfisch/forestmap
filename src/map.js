import { SERVICES }      from "../services.js";
import { BASEMAP_STYLE } from "../config.js";
import { isVisible, onChange } from "./state.js";
import { initSidebar }  from "./sidebar.js";
import { initPopup, showLoading, showResults } from "./popup.js";
import { queryAtPoint } from "./fetcher.js";
import { registerHighlight } from "./highlight.js";
import { initLegend } from "./legend.js";
import { fetchWfsGeoJson } from "./wfs.js";

const WFS_SVCS = SERVICES.filter(s => s.wfsUrl && !s.wmsUrl);

const maplibregl = window.maplibregl;

function srcId(serviceId, layerName) {
  return `src-${serviceId}-${layerName}`;
}
function lyrId(serviceId, layerName) {
  return `lyr-${serviceId}-${layerName}`;
}

function buildTileUrl(svc, layer) {
  const version = svc.wmsVersion ?? "1.3.0";
  const crsParam = version === "1.3.0" ? "CRS" : "SRS";
  return (
    `${svc.wmsUrl}` +
    `?SERVICE=WMS&VERSION=${version}&REQUEST=GetMap` +
    `&FORMAT=image/png&TRANSPARENT=true` +
    `&LAYERS=${encodeURIComponent(layer.name)}&STYLES=` +
    `&${crsParam}=EPSG:3857&WIDTH=256&HEIGHT=256` +
    `&BBOX={bbox-epsg-3857}`
  );
}

function addWfsLayer(map, svc) {
  const srcId = `wfs-src-${svc.id}`;
  const fillId = `wfs-fill-${svc.id}`;
  const lineId = `wfs-line-${svc.id}`;
  const visible = isVisible(svc.id, svc.layers[0].name);

  if (!map.getSource(srcId)) {
    map.addSource(srcId, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: fillId, type: "fill", source: srcId,
      layout: { visibility: visible ? "visible" : "none" },
      paint: { "fill-color": "#1D9E75", "fill-opacity": 0.22 } });
    map.addLayer({ id: lineId, type: "line", source: srcId,
      layout: { visibility: visible ? "visible" : "none" },
      paint: { "line-color": "#1D9E75", "line-width": 1.5 } });
  }
}

async function refreshWfsLayer(map, svc) {
  if (!isVisible(svc.id, svc.layers[0].name)) return;
  const b = map.getBounds();
  const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
  const geoJson = await fetchWfsGeoJson(svc.wfsUrl, bbox);
  map.getSource(`wfs-src-${svc.id}`)?.setData(geoJson);
}

function syncWfsVisibility(map) {
  for (const svc of WFS_SVCS) {
    const vis = isVisible(svc.id, svc.layers[0].name) ? "visible" : "none";
    if (map.getLayer(`wfs-fill-${svc.id}`)) map.setLayoutProperty(`wfs-fill-${svc.id}`, "visibility", vis);
    if (map.getLayer(`wfs-line-${svc.id}`)) map.setLayoutProperty(`wfs-line-${svc.id}`, "visibility", vis);
  }
}

function addLayer(map, svc, layer) {
  const sid = srcId(svc.id, layer.name);
  const lid = lyrId(svc.id, layer.name);
  const visible = isVisible(svc.id, layer.name);

  if (!map.getSource(sid)) {
    map.addSource(sid, {
      type: "raster",
      tiles: [buildTileUrl(svc, layer)],
      tileSize: 256,
      attribution: svc.license === "open-data"
        ? "Datenquelle: FVA, www.fva-bw.de"
        : "© FVA BW – Nutzungsbedingungen beachten",
    });
  }

  if (!map.getLayer(lid)) {
    const spec = {
      id: lid,
      type: "raster",
      source: sid,
      layout: { visibility: visible ? "visible" : "none" },
      paint: { "raster-opacity": 0.85 },
    };
    if (svc.minZoom !== undefined) spec.minzoom = svc.minZoom;
    if (svc.maxZoom !== undefined) spec.maxzoom = svc.maxZoom;
    map.addLayer(spec);
  }
}

function syncVisibility(map) {
  for (const svc of SERVICES) {
    for (const layer of svc.layers) {
      const lid = lyrId(svc.id, layer.name);
      if (map.getLayer(lid)) {
        map.setLayoutProperty(lid, "visibility", isVisible(svc.id, layer.name) ? "visible" : "none");
      }
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initSidebar();
  initPopup();
  initLegend();

  const map = new maplibregl.Map({
    container: "map",
    style: BASEMAP_STYLE,
    center: [8.5, 48.4],
    zoom: 8,
  });

  map.addControl(new maplibregl.NavigationControl(), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
  map.getCanvas().style.cursor = "crosshair";

  map.on("load", () => {
    for (const svc of SERVICES) {
      if (!svc.wmsUrl) continue;
      for (const layer of svc.layers) {
        addLayer(map, svc, layer);
      }
    }

    for (const svc of WFS_SVCS) {
      addWfsLayer(map, svc);
    }

    map.addSource("highlight", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: "highlight-fill",
      type: "fill",
      source: "highlight",
      paint: { "fill-color": "#1D9E75", "fill-opacity": 0.25 },
    });
    map.addLayer({
      id: "highlight-line",
      type: "line",
      source: "highlight",
      paint: { "line-color": "#1D9E75", "line-width": 2 },
    });

    registerHighlight(data => map.getSource("highlight").setData(data));

    let wfsTimer;
    const refreshAllWfs = () => {
      clearTimeout(wfsTimer);
      wfsTimer = setTimeout(() => WFS_SVCS.forEach(s => refreshWfsLayer(map, s)), 300);
    };

    onChange(() => { syncVisibility(map); syncWfsVisibility(map); refreshAllWfs(); });
    map.on("moveend", refreshAllWfs);
    refreshAllWfs();
  });

  map.on("click", async e => {
    const { lng, lat } = e.lngLat;

    showLoading({ lat, lng });
    try {
      const entries = await queryAtPoint(lng, lat);
      showResults(entries);
    } catch (err) {
      console.error("queryAtPoint failed:", err);
      showResults([]);
    }
  });
});
