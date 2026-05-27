import { SERVICES } from "../services.js";

const visibleLayers = new Set();
const listeners = new Set();

for (const s of SERVICES) {
  for (const l of s.layers) {
    if (l.defaultVisible) visibleLayers.add(`${s.id}::${l.name}`);
  }
}

export function isVisible(serviceId, layerName) {
  return visibleLayers.has(`${serviceId}::${layerName}`);
}

export function toggle(serviceId, layerName) {
  const key = `${serviceId}::${layerName}`;
  if (visibleLayers.has(key)) visibleLayers.delete(key);
  else visibleLayers.add(key);
  for (const fn of listeners) fn(visibleLayers);
}

export function getVisible() {
  return visibleLayers;
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const layerFilters = new Map();

export function setFilter(serviceId, layerName, value) {
  const key = `${serviceId}::${layerName}`;
  if (value) layerFilters.set(key, value.trim());
  else layerFilters.delete(key);
}

export function getFilter(serviceId, layerName) {
  return layerFilters.get(`${serviceId}::${layerName}`) ?? null;
}

let _reportMode = false;
export function getReportMode() { return _reportMode; }
export function setReportMode(v) { _reportMode = v; }
