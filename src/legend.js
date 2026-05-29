import { SERVICES } from "../services.js";
import { getVisible, onChange } from "./state.js";

let boxEl, titleEl, entriesEl, prevBtn, nextBtn, dotsEl;
let activeIndex = 0;
let activeLegends = [];

function getActiveLegends() {
  const visible = getVisible();
  const result = [];
  for (const svc of SERVICES) {
    if (svc.featureInfoType === "none") continue;
    const visibleLayers = svc.layers.filter(l => visible.has(`${svc.id}::${l.name}`));
    if (!visibleLayers.length) continue;

    if (svc.colorLegend) {
      result.push({ label: svc.label, type: "color", legend: svc.colorLegend });
    } else if (svc.featureInfoType === "value-only" && svc.wmsUrl) {
      const firstLayer = visibleLayers[0].name.split(",")[0];
      const version = svc.wmsVersion ?? "1.3.0";
      const url = `${svc.wmsUrl}?SERVICE=WMS&VERSION=${version}&REQUEST=GetLegendGraphic&FORMAT=image/png&LAYER=${encodeURIComponent(firstLayer)}`;
      result.push({ label: svc.label, type: "wms", url });
    }
  }
  return result;
}

function renderEntries(entry) {
  entriesEl.innerHTML = "";
  if (entry.type === "color") {
    for (const e of entry.legend.entries) {
      const row = document.createElement("div");
      row.className = "legend-row";
      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.background = e.hex;
      const label = document.createElement("span");
      label.textContent = e.label;
      row.append(swatch, label);
      entriesEl.append(row);
    }
  } else {
    const img = document.createElement("img");
    img.src = entry.url;
    img.className = "legend-wms-img";
    img.alt = entry.label;
    entriesEl.append(img);
  }
}

function update() {
  activeLegends = getActiveLegends();
  if (!activeLegends.length) {
    boxEl.hidden = true;
    return;
  }
  boxEl.hidden = false;
  activeIndex = Math.min(activeIndex, activeLegends.length - 1);

  const entry = activeLegends[activeIndex];
  titleEl.textContent = entry.label;
  renderEntries(entry);

  const multi = activeLegends.length > 1;
  prevBtn.hidden = !multi;
  nextBtn.hidden = !multi;
  dotsEl.hidden = !multi;

  if (multi) {
    dotsEl.innerHTML = activeLegends
      .map((_, i) => `<span class="legend-dot${i === activeIndex ? " active" : ""}"></span>`)
      .join("");
  }
}

export function initLegend() {
  boxEl     = document.getElementById("legend-box");
  titleEl   = document.getElementById("legend-title");
  entriesEl = document.getElementById("legend-entries");
  prevBtn   = document.getElementById("legend-prev");
  nextBtn   = document.getElementById("legend-next");
  dotsEl    = document.getElementById("legend-dots");

  prevBtn.addEventListener("click", () => {
    activeIndex = (activeIndex - 1 + activeLegends.length) % activeLegends.length;
    update();
  });
  nextBtn.addEventListener("click", () => {
    activeIndex = (activeIndex + 1) % activeLegends.length;
    update();
  });

  onChange(update);
  update();
}
