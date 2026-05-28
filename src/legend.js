import { SERVICES } from "../services.js";
import { getVisible, onChange } from "./state.js";

let boxEl, titleEl, entriesEl, prevBtn, nextBtn, dotsEl;
let activeIndex = 0;
let activeLegends = [];

function getActiveLegends() {
  const visible = getVisible();
  const result = [];
  for (const svc of SERVICES) {
    if (!svc.colorLegend) continue;
    if (svc.layers.some(l => visible.has(`${svc.id}::${l.name}`)))
      result.push({ label: svc.label, legend: svc.colorLegend });
  }
  return result;
}

function renderEntries(legend) {
  entriesEl.innerHTML = "";
  for (const e of legend.entries) {
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
}

function update() {
  activeLegends = getActiveLegends();
  if (!activeLegends.length) {
    boxEl.hidden = true;
    return;
  }
  boxEl.hidden = false;
  activeIndex = Math.min(activeIndex, activeLegends.length - 1);

  const { label, legend } = activeLegends[activeIndex];
  titleEl.textContent = label;
  renderEntries(legend);

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
