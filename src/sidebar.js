import { CATEGORIES, SERVICES } from "../services.js";
import { isVisible, toggle, setFilter, getFilter, getReportMode, setReportMode } from "./state.js";

export function initSidebar() {
  const nav = document.getElementById("sidebar-nav");
  nav.innerHTML = "";

  for (const cat of CATEGORIES) {
    const services = SERVICES.filter(s => s.category === cat.id);
    if (!services.length) continue;

    const details = document.createElement("details");
    details.className = "cat-group";

    const summary = document.createElement("summary");
    summary.className = "cat-header";
    summary.innerHTML = `<span class="cat-icon">${cat.icon}</span><span class="cat-label">${cat.label}</span>`;
    details.append(summary);

    for (const svc of services) {
      details.append(renderService(svc));
    }

    nav.append(details);
  }
}

function renderService(svc) {
  const section = document.createElement("div");
  section.className = "svc-section";
  section.dataset.serviceId = svc.id;

  if (svc.layers.length === 1) {
    const layer = svc.layers[0];
    section.append(renderToggle(svc, layer, svc.label));
  } else {
    const svcHeader = document.createElement("div");
    svcHeader.className = "svc-header";
    svcHeader.textContent = svc.label;
    section.append(svcHeader);

    for (const layer of svc.layers) {
      section.append(renderToggle(svc, layer, layer.label));
    }
  }

  if (svc.category === "flurstücke") {
    section.append(renderReportToggle());
  }

  return section;
}

function renderReportToggle() {
  const wrap = document.createElement("label");
  wrap.className = "layer-toggle report-toggle";

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = getReportMode();
  cb.addEventListener("change", () => setReportMode(cb.checked));

  const span = document.createElement("span");
  span.className = "layer-label";
  span.textContent = "Report erstellen";

  wrap.append(cb, span);
  return wrap;
}

function renderToggle(svc, layer, label) {
  const wrap = document.createElement("div");

  const row = document.createElement("label");
  row.className = "layer-toggle";

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = isVisible(svc.id, layer.name);
  cb.addEventListener("change", () => toggle(svc.id, layer.name));

  const span = document.createElement("span");
  span.className = "layer-label";
  span.textContent = label;

  row.append(cb, span);
  wrap.append(row);

  if (layer.sidebarFilter) {
    const filterWrap = document.createElement("div");
    filterWrap.className = "layer-filter";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = layer.sidebarFilter.placeholder;
    const current = getFilter(svc.id, layer.name);
    if (current) { input.value = current; input.classList.add("active"); }

    input.addEventListener("input", () => {
      setFilter(svc.id, layer.name, input.value);
      input.classList.toggle("active", input.value.length > 0);
    });

    filterWrap.append(input);
    wrap.append(filterWrap);
  }

  return wrap;
}

export function updateCheckboxes() {
  for (const cb of document.querySelectorAll(".layer-toggle input")) {
    const row = cb.closest("[data-service-id]");
    if (!row) continue;
    const serviceId = row.dataset.serviceId;
    const label = cb.nextElementSibling?.textContent ?? "";
    const svc = SERVICES.find(s => s.id === serviceId);
    if (!svc) continue;
    const layer = svc.layers.find(l => l.label === label || svc.label === label);
    if (layer) cb.checked = isVisible(serviceId, layer.name);
  }
}
