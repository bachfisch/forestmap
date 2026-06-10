let _setData = null;

export function registerHighlight(setDataFn) {
  _setData = setDataFn;
}

export function setHighlight(geometry) {
  _setData?.({
    type: "FeatureCollection",
    features: geometry ? [{ type: "Feature", geometry, properties: {} }] : [],
  });
}

export function setHighlightFeatures(geometries) {
  _setData?.({
    type: "FeatureCollection",
    features: (geometries ?? []).map(g => ({ type: "Feature", geometry: g, properties: {} })),
  });
}

export function clearHighlight() {
  _setData?.({ type: "FeatureCollection", features: [] });
}
