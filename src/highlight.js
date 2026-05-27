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

export function clearHighlight() {
  _setData?.({ type: "FeatureCollection", features: [] });
}
