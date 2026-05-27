export const chartTheme = {
  style: {
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontSize: 11,
    background: "transparent",
  },
  color: {
    primary: "#1D9E75",
    warning: "#EF9F27",
    danger:  "#D85A30",
    neutral: "#888780",
  },
  marginLeft: 44,
  marginBottom: 36,
  marginTop: 8,
  marginRight: 12,
};

export const SCENARIO_COLORS = {
  current:         "#888780",
  heute:           "#888780",
  "1981_2010":     "#888780",
  rcp45_2021_2050: "#9DC5E8",
  rcp45_2041_2060: "#6AAAD4",
  rcp45_2061_2080: "#378ADD",
  "rcp45_2061-2080": "#378ADD",
  rcp45_2071_2100: "#1D5FA0",
  rcp85_2021_2050: "#F5C98A",
  rcp85_2041_2060: "#EF9F27",
  rcp85_2061_2080: "#E07020",
  "rcp85_2061-2080": "#E07020",
  rcp85_2071_2100: "#D85A30",
};

export const SCENARIO_META = {
  current:         { label: "Heute",           timePeriod: "Heute",     group: "Heute",    groupOrder: 0, order: 0 },
  heute:           { label: "Heute",           timePeriod: "Heute",     group: "Heute",    groupOrder: 0, order: 0 },
  "1981_2010":     { label: "Ref. 1981–2010",  timePeriod: "1981–2010", group: "Referenz", groupOrder: 0, order: 0 },
  rcp45_2021_2050: { label: "RCP 4.5 2021–50", timePeriod: "2021–50",   group: "RCP 4.5",  groupOrder: 1, order: 1 },
  rcp45_2041_2060: { label: "RCP 4.5 2041–60", timePeriod: "2041–60",   group: "RCP 4.5",  groupOrder: 1, order: 2 },
  rcp45_2061_2080: { label: "RCP 4.5 2061–80", timePeriod: "2061–80",   group: "RCP 4.5",  groupOrder: 1, order: 3 },
  "rcp45_2061-2080":{ label: "RCP 4.5 2061–80", timePeriod: "2061–80",  group: "RCP 4.5",  groupOrder: 1, order: 3 },
  rcp45_2071_2100: { label: "RCP 4.5 2071–100","timePeriod": "2071–100", group: "RCP 4.5", groupOrder: 1, order: 4 },
  rcp85_2021_2050: { label: "RCP 8.5 2021–50", timePeriod: "2021–50",   group: "RCP 8.5",  groupOrder: 2, order: 1 },
  rcp85_2041_2060: { label: "RCP 8.5 2041–60", timePeriod: "2041–60",   group: "RCP 8.5",  groupOrder: 2, order: 2 },
  rcp85_2061_2080: { label: "RCP 8.5 2061–80", timePeriod: "2061–80",   group: "RCP 8.5",  groupOrder: 2, order: 3 },
  "rcp85_2061-2080":{ label: "RCP 8.5 2061–80", timePeriod: "2061–80",  group: "RCP 8.5",  groupOrder: 2, order: 3 },
  rcp85_2071_2100: { label: "RCP 8.5 2071–100","timePeriod": "2071–100", group: "RCP 8.5", groupOrder: 2, order: 4 },
};

const SPECIES_KEYS = [
  "buche_eiche", "tanne_douglasie", "kiefer_laerche", "andere_baumarten",
  "bergahorn", "douglasie", "waldkiefer", "gesamt",
  "buche", "eiche", "fichte", "tanne",
].sort((a, b) => b.length - a.length);

export const SPECIES_LABELS = {
  buche_eiche:      "Buche / Eiche",
  tanne_douglasie:  "Tanne / Douglasie",
  kiefer_laerche:   "Kiefer / Lärche",
  andere_baumarten: "Andere",
  bergahorn:        "Bergahorn",
  douglasie:        "Douglasie",
  waldkiefer:       "Waldkiefer",
  gesamt:           "Gesamt",
  buche:            "Buche",
  eiche:            "Eiche",
  fichte:           "Fichte",
  tanne:            "Tanne",
};

export function parseLayerName(layerName) {
  const name = layerName.toLowerCase();

  const speciesKey = SPECIES_KEYS.find(s => name.includes(`_${s}_`) || name.endsWith(`_${s}`)) ?? null;

  const scenarioKey = Object.keys(SCENARIO_META).find(sk => {
    const sk2 = sk.toLowerCase();
    return name.endsWith(`_${sk2}`) || name.includes(`_${sk2}_`);
  }) ?? null;

  const meta = scenarioKey ? SCENARIO_META[scenarioKey] : null;
  const color = scenarioKey ? SCENARIO_COLORS[scenarioKey] : "#888780";

  return { speciesKey, speciesLabel: speciesKey ? SPECIES_LABELS[speciesKey] : null, meta, color };
}
