export function render({ rawValue, serviceConfig }) {
  const div = document.createElement("div");
  div.className = "chart-raster";

  if (rawValue === null || rawValue === undefined) {
    div.innerHTML = `<p class="chart-empty">Kein Wert an dieser Stelle.</p>`;
    return div;
  }

  const val = typeof rawValue === "number" ? rawValue.toFixed(2) : rawValue;

  const legendUrl = serviceConfig.legendUrl
    ?? `${serviceConfig.wmsUrl}?SERVICE=WMS&VERSION=${serviceConfig.wmsVersion ?? "1.3.0"}&REQUEST=GetLegendGraphic&FORMAT=image/png&LAYER=${encodeURIComponent(serviceConfig.layers[0]?.name ?? "")}`;

  div.innerHTML = `
    <div class="raster-value-row">
      <span class="raster-value">${val}</span>
    </div>
    <img class="raster-legend" src="${legendUrl}" alt="Legende" loading="lazy"
         onerror="this.style.display='none'">
  `;
  return div;
}
